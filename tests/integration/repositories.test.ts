import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { createDb, type Db } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { sessionsRepo } from "@/server/db/repositories/sessions";
import { usersRepo } from "@/server/db/repositories/users";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;

interface SeededUser {
  id: string;
}

async function seedUser(email: string): Promise<SeededUser> {
  const user = await usersRepo.create(db, {
    id: uuidv7(),
    email,
    passwordHash: "argon2id$fake-hash",
  });
  await preferencesRepo.createDefaults(db, user.id);
  return { id: user.id };
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
});

afterAll(async () => {
  await testDb.drop();
});

describe("usersRepo", () => {
  test("creates and finds users by email case-insensitively", async () => {
    const created = await seedUser("Lookup@Example.com");
    const found = await usersRepo.findByEmail(db, "lookup@example.com");
    expect(found?.id).toBe(created.id);
  });

  test("returns null for unknown emails", async () => {
    expect(await usersRepo.findByEmail(db, "nobody@example.com")).toBeNull();
  });
});

describe("preferencesRepo", () => {
  test("creates Malaysian defaults", async () => {
    const { id } = await seedUser("defaults@example.com");
    const prefs = await preferencesRepo.get(db, id);
    expect(prefs).toMatchObject({
      locale: "en-MY",
      currency: "MYR",
      timezone: "Asia/Kuala_Lumpur",
      theme: "system",
      privacyMode: false,
    });
  });

  test("updates only the caller's row — user B is untouched", async () => {
    const a = await seedUser("prefs-a@example.com");
    const b = await seedUser("prefs-b@example.com");

    await preferencesRepo.update(db, a.id, { theme: "dark", safetyBufferMinor: 30000 });

    const aPrefs = await preferencesRepo.get(db, a.id);
    const bPrefs = await preferencesRepo.get(db, b.id);
    expect(aPrefs?.theme).toBe("dark");
    expect(aPrefs?.safetyBufferMinor).toBe(30000);
    expect(bPrefs?.theme).toBe("system");
    expect(bPrefs?.safetyBufferMinor).toBe(0);
  });
});

describe("sessionsRepo", () => {
  const HOUR = 60 * 60 * 1000;

  test("creates a session findable by token hash while valid", async () => {
    const { id: userId } = await seedUser("session@example.com");
    const created = await sessionsRepo.create(db, {
      id: uuidv7(),
      userId,
      tokenHash: "hash-valid",
      expiresAt: new Date(Date.now() + HOUR),
    });
    const found = await sessionsRepo.findValidByTokenHash(db, "hash-valid");
    expect(found?.id).toBe(created.id);
    expect(found?.userId).toBe(userId);
  });

  test("expired sessions are not valid", async () => {
    const { id: userId } = await seedUser("expired@example.com");
    // Insert with a future expiry (schema forbids past), then age it below the floor.
    await sessionsRepo.create(db, {
      id: uuidv7(),
      userId,
      tokenHash: "hash-expired",
      expiresAt: new Date(Date.now() + HOUR),
    });
    await testDb.pool.query(
      `update sessions set expires_at = created_at + interval '1 millisecond' where token_hash = 'hash-expired'`,
    );
    expect(await sessionsRepo.findValidByTokenHash(db, "hash-expired")).toBeNull();
  });

  test("revoked sessions are not valid", async () => {
    const { id: userId } = await seedUser("revoked@example.com");
    const s = await sessionsRepo.create(db, {
      id: uuidv7(),
      userId,
      tokenHash: "hash-revoked",
      expiresAt: new Date(Date.now() + HOUR),
    });
    const revoked = await sessionsRepo.revokeById(db, { userId, sessionId: s.id });
    expect(revoked).toBe(true);
    expect(await sessionsRepo.findValidByTokenHash(db, "hash-revoked")).toBeNull();
  });

  test("ISOLATION: user A cannot revoke user B's session (tampered id)", async () => {
    const a = await seedUser("tamper-a@example.com");
    const b = await seedUser("tamper-b@example.com");
    const bSession = await sessionsRepo.create(db, {
      id: uuidv7(),
      userId: b.id,
      tokenHash: "hash-b-session",
      expiresAt: new Date(Date.now() + HOUR),
    });

    const result = await sessionsRepo.revokeById(db, { userId: a.id, sessionId: bSession.id });

    expect(result).toBe(false);
    expect(await sessionsRepo.findValidByTokenHash(db, "hash-b-session")).not.toBeNull();
  });

  test("ISOLATION: listing sessions never crosses users", async () => {
    const a = await seedUser("list-a@example.com");
    const b = await seedUser("list-b@example.com");
    await sessionsRepo.create(db, {
      id: uuidv7(),
      userId: a.id,
      tokenHash: "hash-list-a",
      expiresAt: new Date(Date.now() + HOUR),
    });
    await sessionsRepo.create(db, {
      id: uuidv7(),
      userId: b.id,
      tokenHash: "hash-list-b",
      expiresAt: new Date(Date.now() + HOUR),
    });

    const aSessions = await sessionsRepo.listActiveForUser(db, a.id);
    expect(aSessions.length).toBe(1);
    expect(aSessions.every((s) => s.userId === a.id)).toBe(true);
  });

  test("revokeAllForUser can keep the current session", async () => {
    const { id: userId } = await seedUser("revoke-all@example.com");
    const keep = await sessionsRepo.create(db, {
      id: uuidv7(),
      userId,
      tokenHash: "hash-keep",
      expiresAt: new Date(Date.now() + HOUR),
    });
    await sessionsRepo.create(db, {
      id: uuidv7(),
      userId,
      tokenHash: "hash-drop",
      expiresAt: new Date(Date.now() + HOUR),
    });

    await sessionsRepo.revokeAllForUser(db, userId, { exceptSessionId: keep.id });

    expect(await sessionsRepo.findValidByTokenHash(db, "hash-keep")).not.toBeNull();
    expect(await sessionsRepo.findValidByTokenHash(db, "hash-drop")).toBeNull();
  });
});

describe("auditRepo", () => {
  test("records events and counts recent failures by subject", async () => {
    const subjectHash = "subject-abc";
    for (let i = 0; i < 3; i += 1) {
      await auditRepo.record(db, {
        id: uuidv7(),
        actor: "user",
        eventType: "auth.sign_in_failed",
        subjectHash,
      });
    }
    await auditRepo.record(db, {
      id: uuidv7(),
      actor: "user",
      eventType: "auth.sign_in_failed",
      subjectHash: "someone-else",
    });

    const count = await auditRepo.countRecentEvents(db, {
      eventType: "auth.sign_in_failed",
      subjectHash,
      since: new Date(Date.now() - 60_000),
    });
    expect(count).toBe(3);
  });

  test("counts by ip hash independently of subject", async () => {
    const ipHash = "ip-xyz";
    await auditRepo.record(db, {
      id: uuidv7(),
      actor: "user",
      eventType: "auth.sign_up_failed",
      ipHash,
    });
    const count = await auditRepo.countRecentEvents(db, {
      eventType: "auth.sign_up_failed",
      ipHash,
      since: new Date(Date.now() - 60_000),
    });
    expect(count).toBe(1);
  });
});
