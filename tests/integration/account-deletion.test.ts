import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { isOk, type Result } from "@/lib/result";
import { createAuthService, type AuthService } from "@/server/auth/service";
import { createDb, type Db } from "@/server/db/client";
import { accountsService } from "@/server/services/accounts";
import { runAccountPurge } from "@/server/services/account-purge";
import { transactionsService } from "@/server/services/transactions";

import { createTestDatabase, type TestDatabase } from "./harness";

/**
 * Staged account deletion end to end (Phase 10, spec V4): request -> revoked
 * sessions -> recovery window sign-in -> restore -> purge that provably
 * leaves zero owned rows in EVERY user_id-bearing table.
 */

let testDb: TestDatabase;
let db: Db;
let auth: AuthService;

const SECRET = "integration-test-secret";
const CTX = { ip: "203.0.113.44", userAgent: "vitest" };
const EMAIL = "delete-me@example.com";
const PASSWORD = "a strong passphrase 1";
const CONTROL_EMAIL = "control@example.com";

let userId: string;
let controlId: string;

function unwrap<T>(result: Result<T>, label: string): T {
  if (!isOk(result)) throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  return result.data;
}

async function seedLedger(ownerId: string, label: string): Promise<void> {
  const account = unwrap(
    await accountsService.create(db, ownerId, {
      name: `${label} account`,
      type: "current",
      openingBalanceMinor: 100000,
      openingBalanceDate: "2026-01-01",
    }),
    `${label} account`,
  );
  unwrap(
    await transactionsService.create(db, ownerId, {
      accountId: account.id,
      type: "expense",
      amountMinor: -1600,
      txnDate: "2026-06-03",
      description: `${label} mamak`,
      merchantName: `${label} Mamak Corner`,
    }),
    `${label} txn`,
  );
  await testDb.pool.query(`insert into tags (id, user_id, name) values ($1, $2, $3)`, [
    uuidv7(),
    ownerId,
    `${label}-tag`,
  ]);
  await testDb.pool.query(
    `insert into journal_entries (id, user_id, kind, title, starts_on)
     values ($1, $2, 'decision', $3, '2026-06-01')`,
    [uuidv7(), ownerId, `${label} decision`],
  );
}

async function userIdTables(): Promise<string[]> {
  const result = await testDb.pool.query<{ table_name: string }>(
    `select distinct table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'user_id' order by table_name`,
  );
  return result.rows.map((r) => r.table_name);
}

async function ownedRowCounts(ownerId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of await userIdTables()) {
    const result = await testDb.pool.query(
      `select count(*)::int as n from "${table}" where user_id = $1`,
      [ownerId],
    );
    counts[table] = result.rows[0].n as number;
  }
  return counts;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  auth = createAuthService({
    db,
    secret: SECRET,
    mailer: { send: async () => undefined },
  });

  userId = unwrap(await auth.signUp({ email: EMAIL, password: PASSWORD }, CTX), "sign-up").userId;
  controlId = unwrap(
    await auth.signUp({ email: CONTROL_EMAIL, password: PASSWORD }, CTX),
    "control sign-up",
  ).userId;
  await seedLedger(userId, "doomed");
  await seedLedger(controlId, "control");
});

afterAll(async () => {
  await testDb.drop();
});

describe("deletion request", () => {
  test("wrong password refuses, audits, and changes nothing", async () => {
    const result = await auth.requestAccountDeletion(userId, { password: "wrong" }, CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.fieldErrors?.password).toBeDefined();

    const status = await testDb.pool.query(`select status from users where id = $1`, [userId]);
    expect(status.rows[0].status).toBe("active");
    const audit = await testDb.pool.query(
      `select 1 from audit_logs where event_type = 'account.deletion_request_failed' and user_id = $1`,
      [userId],
    );
    expect(audit.rowCount).toBe(1);
  });

  test("correct password schedules the purge ~30 days out and revokes every session", async () => {
    const before = await auth.signIn({ email: EMAIL, password: PASSWORD }, CTX);
    const token = unwrap(before, "pre-deletion sign-in").sessionToken;

    const result = unwrap(
      await auth.requestAccountDeletion(userId, { password: PASSWORD }, CTX),
      "request",
    );
    const days = (result.purgeAfter.getTime() - Date.now()) / (24 * 60 * 60_000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    const row = await testDb.pool.query(`select status, purge_after from users where id = $1`, [
      userId,
    ]);
    expect(row.rows[0].status).toBe("pending_purge");
    expect(row.rows[0].purge_after).not.toBeNull();

    expect(await auth.validateSession(token)).toBeNull();
    expect(await auth.listSessions(userId)).toHaveLength(0);

    const audit = await testDb.pool.query(
      `select 1 from audit_logs where event_type = 'account.deletion_requested' and user_id = $1`,
      [userId],
    );
    expect(audit.rowCount).toBe(1);
  });

  test("inside the window the user can sign in and the session resolves to pending_purge", async () => {
    const signIn = unwrap(await auth.signIn({ email: EMAIL, password: PASSWORD }, CTX), "sign-in");
    const current = await auth.validateSession(signIn.sessionToken);
    expect(current?.user.status).toBe("pending_purge");
  });

  test("restore flips back to active and clears purge_after, audited", async () => {
    unwrap(await auth.cancelAccountDeletion(userId, CTX), "restore");
    const row = await testDb.pool.query(`select status, purge_after from users where id = $1`, [
      userId,
    ]);
    expect(row.rows[0].status).toBe("active");
    expect(row.rows[0].purge_after).toBeNull();
    const audit = await testDb.pool.query(
      `select 1 from audit_logs where event_type = 'account.deletion_cancelled' and user_id = $1`,
      [userId],
    );
    expect(audit.rowCount).toBe(1);

    // Restoring an active account is a no-op error, not a state change.
    expect((await auth.cancelAccountDeletion(userId, CTX)).ok).toBe(false);
  });
});

describe("purge job", () => {
  test("does nothing while the recovery window is open", async () => {
    unwrap(await auth.requestAccountDeletion(userId, { password: PASSWORD }, CTX), "re-request");
    const result = await runAccountPurge(db, { secret: SECRET });
    expect(result.purged).toBe(0);
    const row = await testDb.pool.query(`select 1 from users where id = $1`, [userId]);
    expect(row.rowCount).toBe(1);
  });

  test("after the window: hard-deletes every owned row in every user_id table, audited without PII", async () => {
    const controlBefore = await ownedRowCounts(controlId);
    expect(controlBefore.transactions).toBeGreaterThan(0);

    const doomedBefore = await ownedRowCounts(userId);
    expect(doomedBefore.transactions).toBeGreaterThan(0);
    expect(doomedBefore.journal_entries).toBeGreaterThan(0);

    await testDb.pool.query(
      `update users set purge_after = now() - interval '1 hour' where id = $1`,
      [userId],
    );
    const result = await runAccountPurge(db, { secret: SECRET });
    expect(result.purged).toBe(1);

    const userRow = await testDb.pool.query(`select 1 from users where id = $1`, [userId]);
    expect(userRow.rowCount).toBe(0);

    // The sweep: zero rows for the purged user in EVERY user_id-bearing table.
    const after = await ownedRowCounts(userId);
    for (const [table, count] of Object.entries(after)) {
      expect(count, `${table} still has rows for the purged user`).toBe(0);
    }

    // The control user's data is untouched.
    expect(await ownedRowCounts(controlId)).toEqual(controlBefore);

    // Purge audit record: system actor, no user_id link, salted subject hash only.
    const audit = await testDb.pool.query(
      `select user_id, actor, subject_hash, diff from audit_logs
       where event_type = 'account.purged' and entity_id = $1`,
      [userId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].user_id).toBeNull();
    expect(audit.rows[0].actor).toBe("system");
    expect(audit.rows[0].subject_hash).toMatch(/^[0-9a-f]{16,}$/i);
    const diff = audit.rows[0].diff as { rowCounts: Record<string, number> };
    expect(diff.rowCounts.transactions).toBeGreaterThan(0);
    const auditText = JSON.stringify(audit.rows[0]);
    expect(auditText).not.toContain(EMAIL);
    expect(auditText).not.toContain("mamak");

    // Idempotent: nothing left to purge.
    expect((await runAccountPurge(db, { secret: SECRET })).purged).toBe(0);
  });

  test("after the purge the email behaves like any unknown account and can sign up fresh", async () => {
    const signIn = await auth.signIn({ email: EMAIL, password: PASSWORD }, CTX);
    expect(signIn.ok).toBe(false);
    if (!signIn.ok) expect(signIn.error.code).toBe("unauthorized");

    expect(isOk(await auth.signUp({ email: EMAIL, password: PASSWORD }, CTX))).toBe(true);
  });
});
