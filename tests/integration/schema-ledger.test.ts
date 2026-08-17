import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "./harness";

/**
 * Phase 2 ledger schema: tables, checks, and the database-level invariant
 * triggers (currency match, deferred split-sum, link validation). Everything
 * here goes through raw SQL on purpose — these guarantees must hold even if
 * the service layer is bypassed.
 */

let db: TestDatabase;

const USER_A = "018f0000-0000-7000-8000-0000000000a1";
const USER_B = "018f0000-0000-7000-8000-0000000000b1";
const ACC_A1 = "018f0000-0000-7000-8000-00000000ac01"; // MYR, user A
const ACC_A2 = "018f0000-0000-7000-8000-00000000ac02"; // MYR, user A
const ACC_A3 = "018f0000-0000-7000-8000-00000000ac03"; // SGD, user A
const ACC_B1 = "018f0000-0000-7000-8000-00000000acb1"; // MYR, user B
const GROUP_A = "018f0000-0000-7000-8000-0000000000f1";
const CAT_A = "018f0000-0000-7000-8000-0000000000c1";

let txnCounter = 0;
function txnId(): string {
  txnCounter += 1;
  return `018f0000-0000-7000-8000-00000000${(0x1000 + txnCounter).toString(16)}`;
}

async function insertTxn(
  id: string,
  opts: {
    userId?: string;
    accountId?: string;
    type?: string;
    amount: number;
    currency?: string;
    status?: string;
  },
): Promise<void> {
  await db.pool.query(
    `insert into transactions (id, user_id, account_id, type, status, amount_minor, currency, txn_date, description_original)
     values ($1, $2, $3, $4, $5, $6, $7, '2026-08-01', 'schema test')`,
    [
      id,
      opts.userId ?? USER_A,
      opts.accountId ?? ACC_A1,
      opts.type ?? "expense",
      opts.status ?? "posted",
      opts.amount,
      opts.currency ?? "MYR",
    ],
  );
}

beforeAll(async () => {
  db = await createTestDatabase();
  for (const [id, email] of [
    [USER_A, "ledger-a@example.com"],
    [USER_B, "ledger-b@example.com"],
  ]) {
    await db.pool.query(`insert into users (id, email, password_hash) values ($1, $2, 'x')`, [
      id,
      email,
    ]);
  }
  for (const [id, userId, name, currency, type] of [
    [ACC_A1, USER_A, "Maybank", "MYR", "current"],
    [ACC_A2, USER_A, "TnG eWallet", "MYR", "ewallet"],
    [ACC_A3, USER_A, "SGD Wallet", "SGD", "ewallet"],
    [ACC_B1, USER_B, "B Bank", "MYR", "current"],
  ]) {
    await db.pool.query(
      `insert into accounts (id, user_id, name, type, currency, opening_balance_minor, opening_balance_date, is_liquid)
       values ($1, $2, $3, $4, $5, 0, '2026-01-01', true)`,
      [id, userId, name, type, currency],
    );
  }
  await db.pool.query(
    `insert into category_groups (id, user_id, name, kind) values ($1, $2, 'Food', 'expense')`,
    [GROUP_A, USER_A],
  );
  await db.pool.query(
    `insert into categories (id, user_id, group_id, name) values ($1, $2, $3, 'Groceries')`,
    [CAT_A, USER_A, GROUP_A],
  );
});

afterAll(async () => {
  await db.drop();
});

describe("Phase 2 tables", () => {
  test("migrations create exactly the Phase 1–8 tables", async () => {
    const { rows } = await db.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    );
    const tables = rows.map((r) => r.table_name).filter((n) => !n.startsWith("__drizzle"));
    expect(tables).toEqual([
      "account_balance_snapshots",
      "accounts",
      "ai_feedback",
      "ai_requests",
      "ai_suggestions",
      "attachments",
      "audit_logs",
      "budget_allocations",
      "budget_periods",
      "budgets",
      "categories",
      "categorization_rules",
      "category_groups",
      "forecasts",
      "goal_contributions",
      "import_jobs",
      "import_profiles",
      "import_rows",
      "insight_evidence",
      "insights",
      "merchants",
      "notifications",
      "password_reset_tokens",
      "recurring_patterns",
      "savings_goals",
      "sessions",
      "subscriptions",
      "tags",
      "transaction_links",
      "transaction_splits",
      "transaction_tags",
      "transactions",
      "user_preferences",
      "users",
    ]);
  });
});

describe("account constraints", () => {
  test("account names are unique per user, case-insensitively, among live accounts", async () => {
    await expect(
      db.pool.query(
        `insert into accounts (id, user_id, name, type, currency, opening_balance_minor, opening_balance_date, is_liquid)
         values ('018f0000-0000-7000-8000-00000000acff', $1, 'MAYBANK', 'savings', 'MYR', 0, '2026-01-01', true)`,
        [USER_A],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  test("credit limits are only allowed on credit cards", async () => {
    await expect(
      db.pool.query(
        `insert into accounts (id, user_id, name, type, currency, opening_balance_minor, opening_balance_date, is_liquid, credit_limit_minor)
         values ('018f0000-0000-7000-8000-00000000acfe', $1, 'Limit on cash', 'cash', 'MYR', 0, '2026-01-01', true, 100000)`,
        [USER_A],
      ),
    ).rejects.toThrow(/check/i);
  });
});

describe("transaction sign and status checks (invariant 7 shape)", () => {
  test("expenses must be negative", async () => {
    await expect(insertTxn(txnId(), { type: "expense", amount: 500 })).rejects.toThrow(/check/i);
  });

  test("income must be positive", async () => {
    await expect(insertTxn(txnId(), { type: "income", amount: -500 })).rejects.toThrow(/check/i);
  });

  test("refunds must be positive", async () => {
    await expect(insertTxn(txnId(), { type: "refund", amount: -500 })).rejects.toThrow(/check/i);
  });

  test("non-adjustment transactions cannot be zero", async () => {
    await expect(insertTxn(txnId(), { type: "transfer", amount: 0 })).rejects.toThrow(/check/i);
  });

  test("valid rows insert", async () => {
    await insertTxn(txnId(), { type: "expense", amount: -3250 });
    await insertTxn(txnId(), { type: "income", amount: 520000 });
    await insertTxn(txnId(), { type: "adjustment", amount: 0 });
  });
});

describe("currency-match trigger (invariant 8 at the row level)", () => {
  test("a transaction's currency must equal its account's currency", async () => {
    await expect(
      insertTxn(txnId(), { accountId: ACC_A3, type: "expense", amount: -100, currency: "MYR" }),
    ).rejects.toThrow(/currency/i);
  });

  test("matching currency inserts fine", async () => {
    await insertTxn(txnId(), { accountId: ACC_A3, type: "expense", amount: -100, currency: "SGD" });
  });
});

describe("split-sum deferred trigger (invariant 3)", () => {
  test("splits that do not sum to the parent amount fail at commit", async () => {
    const parent = txnId();
    await insertTxn(parent, { type: "expense", amount: -10000 });
    const client = await db.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into transaction_splits (id, transaction_id, user_id, category_id, amount_minor)
         values ('018f0000-0000-7000-8000-00000000e001', $1, $2, $3, -4000)`,
        [parent, USER_A, CAT_A],
      );
      await expect(client.query("commit")).rejects.toThrow(/split/i);
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  });

  test("splits summing exactly to the parent commit fine", async () => {
    const parent = txnId();
    await insertTxn(parent, { type: "expense", amount: -10000 });
    const client = await db.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into transaction_splits (id, transaction_id, user_id, category_id, amount_minor)
         values ('018f0000-0000-7000-8000-00000000e002', $1, $2, $3, -6000),
                ('018f0000-0000-7000-8000-00000000e003', $1, $2, $3, -4000)`,
        [parent, USER_A, CAT_A],
      );
      await client.query("commit");
    } finally {
      client.release();
    }
    const { rows } = await db.pool.query(
      `select coalesce(sum(amount_minor), 0)::bigint as total from transaction_splits where transaction_id = $1`,
      [parent],
    );
    expect(Number(rows[0].total)).toBe(-10000);
  });

  test("changing the parent amount while splits exist fails unless splits follow", async () => {
    const parent = txnId();
    await insertTxn(parent, { type: "expense", amount: -10000 });
    await db.pool.query(
      `begin; insert into transaction_splits (id, transaction_id, user_id, category_id, amount_minor)
       values ('018f0000-0000-7000-8000-00000000e004', '${parent}', '${USER_A}', '${CAT_A}', -10000); commit`,
    );
    await expect(
      db.pool.query(`update transactions set amount_minor = -9000 where id = $1`, [parent]),
    ).rejects.toThrow(/split/i);
  });
});

describe("transaction link trigger (invariant 2 + cross-user)", () => {
  test("transfer pairs must be equal and opposite, same currency, both transfer-typed", async () => {
    const from = txnId();
    const to = txnId();
    await insertTxn(from, { type: "transfer", amount: -10000 });
    await insertTxn(to, { accountId: ACC_A2, type: "transfer", amount: 9000 });
    await expect(
      db.pool.query(
        `insert into transaction_links (id, user_id, link_type, from_transaction_id, to_transaction_id)
         values ('018f0000-0000-7000-8000-00000000f001', $1, 'transfer_pair', $2, $3)`,
        [USER_A, from, to],
      ),
    ).rejects.toThrow(/transfer/i);
  });

  test("balanced transfer pairs link fine", async () => {
    const from = txnId();
    const to = txnId();
    await insertTxn(from, { type: "transfer", amount: -10000 });
    await insertTxn(to, { accountId: ACC_A2, type: "transfer", amount: 10000 });
    await expect(
      db.pool.query(
        `insert into transaction_links (id, user_id, link_type, from_transaction_id, to_transaction_id)
         values ('018f0000-0000-7000-8000-00000000f002', $1, 'transfer_pair', $2, $3)`,
        [USER_A, from, to],
      ),
    ).resolves.toBeDefined();
  });

  test("links can never join transactions of different users", async () => {
    const a = txnId();
    const b = txnId();
    await insertTxn(a, { type: "expense", amount: -500 });
    await insertTxn(b, { userId: USER_B, accountId: ACC_B1, type: "refund", amount: 500 });
    await expect(
      db.pool.query(
        `insert into transaction_links (id, user_id, link_type, from_transaction_id, to_transaction_id)
         values ('018f0000-0000-7000-8000-00000000f003', $1, 'refund_of', $2, $3)`,
        [USER_A, b, a],
      ),
    ).rejects.toThrow(/user/i);
  });

  test("a transaction cannot link to itself", async () => {
    const a = txnId();
    await insertTxn(a, { type: "expense", amount: -500 });
    await expect(
      db.pool.query(
        `insert into transaction_links (id, user_id, link_type, from_transaction_id, to_transaction_id)
         values ('018f0000-0000-7000-8000-00000000f004', $1, 'duplicate_of', $2, $2)`,
        [USER_A, a],
      ),
    ).rejects.toThrow(/check|self/i);
  });
});

describe("category constraints", () => {
  test("category names unique per group, case-insensitively", async () => {
    await expect(
      db.pool.query(
        `insert into categories (id, user_id, group_id, name)
         values ('018f0000-0000-7000-8000-0000000000c2', $1, $2, 'GROCERIES')`,
        [USER_A, GROUP_A],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
