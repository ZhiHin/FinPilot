import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "./harness";

/** Phase 3 import schema: staging tables and the import idempotency index. */

let db: TestDatabase;

const USER = "018f0000-0000-7000-8000-0000000000d1";
const ACC_1 = "018f0000-0000-7000-8000-00000000ad01";
const ACC_2 = "018f0000-0000-7000-8000-00000000ad02";
const JOB = "018f0000-0000-7000-8000-00000000bb01";

beforeAll(async () => {
  db = await createTestDatabase();
  await db.pool.query(
    `insert into users (id, email, password_hash) values ($1, 'imp@example.com', 'x')`,
    [USER],
  );
  for (const [id, name] of [
    [ACC_1, "Import acct 1"],
    [ACC_2, "Import acct 2"],
  ]) {
    await db.pool.query(
      `insert into accounts (id, user_id, name, type, currency, opening_balance_minor, opening_balance_date, is_liquid)
       values ($1, $2, $3, 'current', 'MYR', 0, '2026-01-01', true)`,
      [id, USER, name],
    );
  }
  await db.pool.query(
    `insert into import_jobs (id, user_id, account_id, filename, idempotency_key, status)
     values ($1, $2, $3, 'statement.csv', 'idem-1', 'mapping')`,
    [JOB, USER, ACC_1],
  );
});

afterAll(async () => {
  await db.drop();
});

describe("import staging constraints", () => {
  test("row numbers are unique within a job", async () => {
    await db.pool.query(
      `insert into import_rows (id, import_job_id, user_id, row_number, raw)
       values ('018f0000-0000-7000-8000-00000000bc01', $1, $2, 1, '["a"]'::jsonb)`,
      [JOB, USER],
    );
    await expect(
      db.pool.query(
        `insert into import_rows (id, import_job_id, user_id, row_number, raw)
         values ('018f0000-0000-7000-8000-00000000bc02', $1, $2, 1, '["b"]'::jsonb)`,
        [JOB, USER],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  test("job idempotency keys are globally unique", async () => {
    await expect(
      db.pool.query(
        `insert into import_jobs (id, user_id, account_id, filename, idempotency_key, status)
         values ('018f0000-0000-7000-8000-00000000bb02', $1, $2, 'other.csv', 'idem-1', 'mapping')`,
        [USER, ACC_1],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe("transaction import-hash idempotency (invariant: retries never duplicate)", () => {
  const insertTxn = (id: string, accountId: string, hash: string | null) =>
    db.pool.query(
      `insert into transactions (id, user_id, account_id, type, status, amount_minor, currency, txn_date, description_original, import_content_hash)
       values ($1, $2, $3, 'expense', 'posted', -100, 'MYR', '2026-08-01', 'import test', $4)`,
      [id, USER, accountId, hash],
    );

  test("the same hash cannot land twice in one account", async () => {
    await insertTxn("018f0000-0000-7000-8000-00000000bd01", ACC_1, "hash-a:0");
    await expect(
      insertTxn("018f0000-0000-7000-8000-00000000bd02", ACC_1, "hash-a:0"),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  test("the same hash in a different account is fine; null hashes are unconstrained", async () => {
    await insertTxn("018f0000-0000-7000-8000-00000000bd03", ACC_2, "hash-a:0");
    await insertTxn("018f0000-0000-7000-8000-00000000bd04", ACC_1, null);
    await insertTxn("018f0000-0000-7000-8000-00000000bd05", ACC_1, null);
  });
});
