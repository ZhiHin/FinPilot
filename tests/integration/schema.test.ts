import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "./harness";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.drop();
});

const U1 = "018f0000-0000-7000-8000-000000000001";
const U2 = "018f0000-0000-7000-8000-000000000002";

describe("Phase 1 schema", () => {
  test("the five Phase 1 identity/security tables exist", async () => {
    // The exhaustive whole-schema assertion lives in schema-ledger.test.ts and
    // grows with each phase (ADR-017 incremental migrations).
    const { rows } = await db.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`,
    );
    const tables = rows.map((r) => r.table_name);
    for (const required of [
      "audit_logs",
      "password_reset_tokens",
      "sessions",
      "user_preferences",
      "users",
    ]) {
      expect(tables).toContain(required);
    }
  });

  test("email uniqueness is case-insensitive (citext)", async () => {
    await db.pool.query(
      `insert into users (id, email, password_hash) values ($1, 'Aisyah@Example.com', 'x')`,
      [U1],
    );
    await expect(
      db.pool.query(
        `insert into users (id, email, password_hash) values ($1, 'aisyah@example.com', 'x')`,
        [U2],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  test("audit_logs is append-only: UPDATE and DELETE are rejected", async () => {
    const id = "018f0000-0000-7000-8000-00000000000a";
    await db.pool.query(`insert into audit_logs (id, event_type) values ($1, 'auth.test')`, [id]);
    await expect(
      db.pool.query(`update audit_logs set event_type = 'tampered' where id = $1`, [id]),
    ).rejects.toThrow(/append-only/i);
    await expect(db.pool.query(`delete from audit_logs where id = $1`, [id])).rejects.toThrow(
      /append-only/i,
    );
  });

  test("sessions must expire after they are created", async () => {
    await expect(
      db.pool.query(
        `insert into sessions (id, user_id, token_hash, expires_at)
         values ('018f0000-0000-7000-8000-00000000000b', $1, 'hash-x', now() - interval '1 hour')`,
        [U1],
      ),
    ).rejects.toThrow(/check/i);
  });

  test("safety buffer cannot be negative", async () => {
    await expect(
      db.pool.query(
        `insert into user_preferences (user_id, safety_buffer_minor) values ($1, -100)`,
        [U1],
      ),
    ).rejects.toThrow(/check/i);
  });

  test("pending_purge users must carry a purge_after date", async () => {
    await expect(
      db.pool.query(
        `insert into users (id, email, password_hash, status)
         values ('018f0000-0000-7000-8000-00000000000c', 'purge@example.com', 'x', 'pending_purge')`,
      ),
    ).rejects.toThrow(/check/i);
  });

  test("deleting a user cascades sessions but preserves audit rows", async () => {
    const uid = "018f0000-0000-7000-8000-00000000000d";
    await db.pool.query(
      `insert into users (id, email, password_hash) values ($1, 'cascade@example.com', 'x')`,
      [uid],
    );
    await db.pool.query(
      `insert into sessions (id, user_id, token_hash, expires_at)
       values ('018f0000-0000-7000-8000-00000000000e', $1, 'hash-cascade', now() + interval '1 day')`,
      [uid],
    );
    await db.pool.query(
      `insert into audit_logs (id, user_id, event_type)
       values ('018f0000-0000-7000-8000-00000000000f', $1, 'auth.sign_in')`,
      [uid],
    );

    await db.pool.query(`delete from users where id = $1`, [uid]);

    const sessions = await db.pool.query(`select 1 from sessions where user_id = $1`, [uid]);
    expect(sessions.rowCount).toBe(0);
    const audit = await db.pool.query(
      `select user_id from audit_logs where id = '018f0000-0000-7000-8000-00000000000f'`,
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].user_id).toBeNull();
  });
});
