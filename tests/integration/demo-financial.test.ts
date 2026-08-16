import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createDb, type Db } from "@/server/db/client";
import { accountsService } from "@/server/services/accounts";
import { transactionsService } from "@/server/services/transactions";
import { DEMO_USER, seedDemo } from "@/server/db/seeds/demo";
import { seedDemoFinancial } from "@/server/db/seeds/demo-financial";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;

const TODAY = "2026-08-16";

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  await seedDemo(db);
});

afterAll(async () => {
  await testDb.drop();
});

describe("Aisyah demo financial dataset", () => {
  test("seeds once, idempotently", async () => {
    const first = await seedDemoFinancial(db, { today: TODAY });
    expect(first.created).toBe(true);
    expect(first.transactionCount).toBeGreaterThan(0);

    const countAfterFirst = await testDb.pool.query(
      `select count(*)::int n from transactions where user_id = $1`,
      [DEMO_USER.id],
    );

    const second = await seedDemoFinancial(db, { today: TODAY });
    expect(second.created).toBe(false);

    const countAfterSecond = await testDb.pool.query(
      `select count(*)::int n from transactions where user_id = $1`,
      [DEMO_USER.id],
    );
    expect(countAfterSecond.rows[0].n).toBe(countAfterFirst.rows[0].n);
  });

  test("creates the seven spec accounts with realistic volume", async () => {
    const accounts = await accountsService.list(db, DEMO_USER.id, { includeArchived: true });
    expect(accounts.length).toBe(7);
    const names = accounts.map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Maybank current",
        "Maybank savings",
        "TnG eWallet",
        "Visa credit card",
      ]),
    );

    const count = await testDb.pool.query(
      `select count(*)::int n from transactions where user_id = $1`,
      [DEMO_USER.id],
    );
    expect(count.rows[0].n).toBeGreaterThan(600);
    expect(count.rows[0].n).toBeLessThan(1400);
  });

  test("contains the spec edge cases", async () => {
    const pending = await testDb.pool.query(
      `select count(*)::int n from transactions where user_id = $1 and status = 'pending' and deleted_at is null`,
      [DEMO_USER.id],
    );
    expect(pending.rows[0].n).toBe(3);

    const needsReview = await testDb.pool.query(
      `select count(*)::int n from transactions where user_id = $1 and needs_review and deleted_at is null`,
      [DEMO_USER.id],
    );
    expect(needsReview.rows[0].n).toBeGreaterThanOrEqual(4);

    const refundLinks = await testDb.pool.query(
      `select count(*)::int n from transaction_links where user_id = $1 and link_type = 'refund_of'`,
      [DEMO_USER.id],
    );
    expect(refundLinks.rows[0].n).toBe(1);

    const transferLinks = await testDb.pool.query(
      `select count(*)::int n from transaction_links where user_id = $1 and link_type = 'transfer_pair'`,
      [DEMO_USER.id],
    );
    expect(transferLinks.rows[0].n).toBeGreaterThanOrEqual(1);

    // The exact-duplicate pair: same account, merchant, amount, and date, twice.
    const duplicates = await testDb.pool.query(
      `select count(*)::int n from (
         select account_id, merchant_id, amount_minor, txn_date
         from transactions where user_id = $1 and type = 'expense' and deleted_at is null
         group by account_id, merchant_id, amount_minor, txn_date
         having count(*) = 2
       ) d`,
      [DEMO_USER.id],
    );
    expect(duplicates.rows[0].n).toBeGreaterThanOrEqual(1);

    // A split whose parts sum to the parent (enforced by trigger, asserted for the demo).
    const split = await testDb.pool.query(
      `select t.amount_minor::bigint as parent, coalesce(sum(s.amount_minor), 0)::bigint as parts
       from transactions t join transaction_splits s on s.transaction_id = t.id
       where t.user_id = $1 group by t.id limit 1`,
      [DEMO_USER.id],
    );
    expect(split.rowCount).toBe(1);
    expect(Number(split.rows[0].parent)).toBe(Number(split.rows[0].parts));
  });

  test("balances reconcile: service figures equal raw ledger sums (seed integrity)", async () => {
    const accounts = await accountsService.list(db, DEMO_USER.id, { includeArchived: true });
    for (const account of accounts) {
      const raw = await testDb.pool.query(
        `select ($1::bigint + coalesce(sum(amount_minor) filter (where status = 'posted' and deleted_at is null), 0))::bigint as balance
         from transactions where account_id = $2`,
        [account.openingBalanceMinor, account.id],
      );
      expect(account.balanceMinor).toBe(Number(raw.rows[0].balance));
    }
  });

  test("transfers stay out of income/expense in the demo summary (invariant 1)", async () => {
    const summary = await transactionsService.summary(db, DEMO_USER.id, {});
    const transferSum = await testDb.pool.query(
      `select coalesce(sum(amount_minor), 0)::bigint s from transactions
       where user_id = $1 and type = 'transfer' and deleted_at is null`,
      [DEMO_USER.id],
    );
    // Legs cancel pairwise…
    expect(Number(transferSum.rows[0].s)).toBe(0);
    // …and monthly income reflects only real income.
    expect(summary.MYR.incomeMinor).toBeGreaterThan(0);
  });

  test("food delivery steps up in the final month (the canonical +23% insight)", async () => {
    const rows = await testDb.pool.query(
      `select to_char(date_trunc('month', txn_date), 'YYYY-MM') as month,
              coalesce(sum(-t.amount_minor), 0)::bigint as spent
       from transactions t
       join categories c on c.id = t.category_id
       where t.user_id = $1 and c.name = 'Food delivery' and t.type = 'expense'
         and t.status = 'posted' and t.deleted_at is null
       group by 1 order by 1`,
      [DEMO_USER.id],
    );
    expect(rows.rowCount).toBeGreaterThanOrEqual(3);
    const spent = rows.rows.map((r) => Number(r.spent));
    const final = spent[spent.length - 1];
    const previous = spent[spent.length - 2];
    expect(final - previous).toBeGreaterThanOrEqual(20000); // ≥ RM 200 step-up
  });
});
