import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { isErr, isOk } from "@/lib/result";
import { createAuthService, type AuthService, type OutgoingMail } from "@/server/auth/service";
import { createDb, type Db } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { sessionsRepo } from "@/server/db/repositories/sessions";
import { usersRepo } from "@/server/db/repositories/users";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;
let auth: AuthService;
let sentMail: OutgoingMail[];

const CTX = { ip: "203.0.113.10", userAgent: "vitest" };

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  sentMail = [];
  auth = createAuthService({
    db,
    secret: "integration-test-secret",
    mailer: {
      send: async (mail) => {
        sentMail.push(mail);
      },
    },
    limits: {
      signInPerIdentifier: { max: 3, windowMs: 60_000 },
      signInPerIp: { max: 100, windowMs: 60_000 },
      signUpPerIp: { max: 100, windowMs: 60_000 },
      resetPerIdentifier: { max: 2, windowMs: 60_000 },
      resetPerIp: { max: 100, windowMs: 60_000 },
    },
  });
});

afterAll(async () => {
  await testDb.drop();
});

describe("signUp", () => {
  test("creates user, defaults, session, and audit trail", async () => {
    const result = await auth.signUp(
      { email: "signup@example.com", password: "a strong passphrase 1", displayName: "Aisyah" },
      CTX,
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.data.sessionToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    const user = await usersRepo.findByEmail(db, "signup@example.com");
    expect(user?.displayName).toBe("Aisyah");
    expect(user?.passwordHash).not.toContain("passphrase");
    expect(await preferencesRepo.get(db, user!.id)).not.toBeNull();

    const audit = await testDb.pool.query(
      `select 1 from audit_logs where event_type = 'auth.sign_up' and user_id = $1`,
      [user!.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  test("rejects duplicate emails with a field error (rate-limited surface)", async () => {
    await auth.signUp({ email: "dup@example.com", password: "a strong passphrase 1" }, CTX);
    const second = await auth.signUp(
      { email: "DUP@example.com", password: "another passphrase 2" },
      CTX,
    );
    expect(isErr(second)).toBe(true);
    if (isErr(second)) {
      expect(second.error.fieldErrors?.email).toBeDefined();
    }
  });

  test("rejects weak passwords with field errors", async () => {
    const result = await auth.signUp({ email: "weak@example.com", password: "short" }, CTX);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.fieldErrors?.password).toBeDefined();
    }
  });
});

describe("signIn", () => {
  const EMAIL = "signin@example.com";
  const PASSWORD = "a strong passphrase 1";

  beforeAll(async () => {
    await auth.signUp({ email: EMAIL, password: PASSWORD }, CTX);
  });

  test("succeeds with correct credentials", async () => {
    const result = await auth.signIn({ email: EMAIL, password: PASSWORD }, CTX);
    expect(isOk(result)).toBe(true);
  });

  test("wrong password and unknown email return identical generic errors", async () => {
    const wrongPassword = await auth.signIn({ email: EMAIL, password: "wrong password 123" }, CTX);
    const unknownEmail = await auth.signIn(
      { email: "ghost@example.com", password: "whatever password 1" },
      CTX,
    );
    expect(isErr(wrongPassword)).toBe(true);
    expect(isErr(unknownEmail)).toBe(true);
    if (isErr(wrongPassword) && isErr(unknownEmail)) {
      expect(wrongPassword.error.code).toBe(unknownEmail.error.code);
      expect(wrongPassword.error.message).toBe(unknownEmail.error.message);
    }
  });

  test("locks the identifier after repeated failures, even with the right password", async () => {
    const email = "lockout@example.com";
    await auth.signUp({ email, password: PASSWORD }, CTX);
    for (let i = 0; i < 3; i += 1) {
      await auth.signIn({ email, password: "wrong password 123" }, CTX);
    }
    const locked = await auth.signIn({ email, password: PASSWORD }, CTX);
    expect(isErr(locked)).toBe(true);
    if (isErr(locked)) {
      expect(locked.error.code).toBe("rate_limited");
    }
  });
});

describe("sessions", () => {
  test("validateSession resolves the user; sign-out invalidates", async () => {
    const email = "sessions@example.com";
    const signUp = await auth.signUp({ email, password: "a strong passphrase 1" }, CTX);
    if (!isOk(signUp)) throw new Error("setup failed");
    const token = signUp.data.sessionToken;

    const current = await auth.validateSession(token);
    expect(current?.user.email).toBe(email);

    await auth.signOut(token);
    expect(await auth.validateSession(token)).toBeNull();
  });

  test("garbage tokens resolve to null without throwing", async () => {
    expect(await auth.validateSession("not-a-real-token")).toBeNull();
    expect(await auth.validateSession("")).toBeNull();
  });

  test("revokeOtherSessions keeps only the current one", async () => {
    const email = "multi-device@example.com";
    const first = await auth.signUp({ email, password: "a strong passphrase 1" }, CTX);
    const second = await auth.signIn({ email, password: "a strong passphrase 1" }, CTX);
    if (!isOk(first) || !isOk(second)) throw new Error("setup failed");

    const current = await auth.validateSession(second.data.sessionToken);
    await auth.revokeOtherSessions(current!.user.id, current!.session.id);

    expect(await auth.validateSession(first.data.sessionToken)).toBeNull();
    expect(await auth.validateSession(second.data.sessionToken)).not.toBeNull();
  });

  test("ISOLATION: revoking a session by id is scoped to the owner", async () => {
    const a = await auth.signUp(
      { email: "own-a@example.com", password: "a strong passphrase 1" },
      CTX,
    );
    const b = await auth.signUp(
      { email: "own-b@example.com", password: "a strong passphrase 1" },
      CTX,
    );
    if (!isOk(a) || !isOk(b)) throw new Error("setup failed");
    const aSession = await auth.validateSession(a.data.sessionToken);
    const bSession = await auth.validateSession(b.data.sessionToken);

    // A attempts to revoke B's session id (tampered payload).
    const revoked = await sessionsRepo.revokeById(db, {
      userId: aSession!.user.id,
      sessionId: bSession!.session.id,
    });
    expect(revoked).toBe(false);
    expect(await auth.validateSession(b.data.sessionToken)).not.toBeNull();
  });
});

describe("password reset", () => {
  const EMAIL = "reset@example.com";
  const OLD_PASSWORD = "a strong passphrase 1";
  const NEW_PASSWORD = "a brand new passphrase 2";

  beforeAll(async () => {
    await auth.signUp({ email: EMAIL, password: OLD_PASSWORD }, CTX);
  });

  test("unknown emails get the same ok response and no mail", async () => {
    const before = sentMail.length;
    const result = await auth.requestPasswordReset({ email: "ghost-reset@example.com" }, CTX);
    expect(isOk(result)).toBe(true);
    expect(sentMail.length).toBe(before);
  });

  test("full reset flow: mail sent, token single-use, sessions revoked", async () => {
    const session = await auth.signIn({ email: EMAIL, password: OLD_PASSWORD }, CTX);
    if (!isOk(session)) throw new Error("setup failed");

    const requested = await auth.requestPasswordReset({ email: EMAIL }, CTX);
    expect(isOk(requested)).toBe(true);
    const mail = sentMail.at(-1);
    expect(mail?.to).toBe(EMAIL);
    const token = mail?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeDefined();

    const reset = await auth.resetPassword({ token: token!, password: NEW_PASSWORD }, CTX);
    expect(isOk(reset)).toBe(true);

    // Old session gone, old password dead, new password works.
    expect(await auth.validateSession(session.data.sessionToken)).toBeNull();
    expect(isErr(await auth.signIn({ email: EMAIL, password: OLD_PASSWORD }, CTX))).toBe(true);
    expect(isOk(await auth.signIn({ email: EMAIL, password: NEW_PASSWORD }, CTX))).toBe(true);

    // Token is single-use.
    const replay = await auth.resetPassword(
      { token: token!, password: "yet another passphrase 3" },
      CTX,
    );
    expect(isErr(replay)).toBe(true);
  });

  test("invalid tokens fail generically", async () => {
    const result = await auth.resetPassword(
      { token: "forged-token-value", password: "a strong passphrase 9" },
      CTX,
    );
    expect(isErr(result)).toBe(true);
  });

  test("reset requests are rate limited per identifier", async () => {
    const email = "reset-limit@example.com";
    await auth.signUp({ email, password: OLD_PASSWORD }, CTX);
    await auth.requestPasswordReset({ email }, CTX);
    await auth.requestPasswordReset({ email }, CTX);
    const third = await auth.requestPasswordReset({ email }, CTX);
    expect(isErr(third)).toBe(true);
    if (isErr(third)) {
      expect(third.error.code).toBe("rate_limited");
    }
  });
});

describe("changePassword", () => {
  test("requires the current password and keeps only the acting session", async () => {
    const email = "change@example.com";
    const password = "a strong passphrase 1";
    const next = "a replacement passphrase 2";
    const first = await auth.signUp({ email, password }, CTX);
    const second = await auth.signIn({ email, password }, CTX);
    if (!isOk(first) || !isOk(second)) throw new Error("setup failed");
    const acting = await auth.validateSession(second.data.sessionToken);

    const wrong = await auth.changePassword(
      acting!.user.id,
      { currentPassword: "not the password 1", newPassword: next },
      { ...CTX, currentSessionId: acting!.session.id },
    );
    expect(isErr(wrong)).toBe(true);

    const changed = await auth.changePassword(
      acting!.user.id,
      { currentPassword: password, newPassword: next },
      { ...CTX, currentSessionId: acting!.session.id },
    );
    expect(isOk(changed)).toBe(true);

    expect(await auth.validateSession(first.data.sessionToken)).toBeNull();
    expect(await auth.validateSession(second.data.sessionToken)).not.toBeNull();
    expect(isOk(await auth.signIn({ email, password: next }, CTX))).toBe(true);
  });
});
