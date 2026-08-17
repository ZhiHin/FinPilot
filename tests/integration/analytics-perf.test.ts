import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { isOk, type Result } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { accountsService, type AccountRow } from "@/server/services/accounts";
import { analyticsService } from "@/server/services/analytics";
import { categoriesService } from "@/server/services/categories";
import { exportsService } from "@/server/services/exports";

import { createTestDatabase, type TestDatabase } from "./harness";

/**
 * Phase 4 performance gate: analytics stays responsive with ≥10,000
 * transactions. Aggregation happens in PostgreSQL — assertions check both
 * latency and that result sets stay summary-sized (never the full ledger).
 * Budgets are deliberately loose (CI machines vary); measured times are
 * logged and documented in docs/progress/phase-4.md.
 */

const ROWS = 10_000;
const BUDGET_MS = 1_500;

let testDb: TestDatabase;
let db: Db;
let userId: string;
let account: AccountRow;

function unwrap<T>(result: Result<T>, label: string): T {
  if (!isOk(result)) throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  return result.data;
}

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const value = await run();
  const ms = Math.round(performance.now() - start);
  process.stdout.write(`[perf] ${label}: ${ms}ms over ${ROWS} transactions\n`);
  expect(ms, `${label} exceeded ${BUDGET_MS}ms`).toBeLessThan(BUDGET_MS);
  return value;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  userId = uuidv7();
  await testDb.pool.query(
    `insert into users (id, email, password_hash) values ($1, 'perf@example.com', 'x')`,
    [userId],
  );
  account = unwrap(
    await accountsService.create(db, userId, {
      name: "Perf account",
      type: "current",
      openingBalanceMinor: 1_000_000,
      openingBalanceDate: "2024-09-01",
    }),
    "account",
  );
  const group = unwrap(
    await categoriesService.createGroup(db, userId, { name: "Perf spending", kind: "expense" }),
    "group",
  );
  const categoryIds: string[] = [];
  for (let i = 0; i < 8; i++) {
    categoryIds.push(
      unwrap(
        await categoriesService.createCategory(db, userId, {
          groupId: group.id,
          name: `Category ${i}`,
        }),
        `cat ${i}`,
      ).id,
    );
  }
  await testDb.pool.query(
    `insert into merchants (id, user_id, canonical_name, normalized_key)
     select gen_random_uuid(), $1, 'Merchant ' || i, 'merchant-' || i from generate_series(0, 19) i`,
    [userId],
  );

  // 10,000 transactions across 24 months: ~1 income per 30 rows, rest expenses
  // cycling through 8 categories and 20 merchants. All constraints satisfied.
  await testDb.pool.query(
    `with cats as (
       select id, row_number() over (order by id) - 1 as idx from categories where user_id = $1
     ),
     mers as (
       select id, row_number() over (order by id) - 1 as idx from merchants where user_id = $1
     )
     insert into transactions
       (id, user_id, account_id, type, status, is_excluded, amount_minor, currency, txn_date,
        description_original, category_id, merchant_id, version)
     select gen_random_uuid(), $1, $2,
            case when i % 30 = 0 then 'income'::txn_type else 'expense'::txn_type end,
            'posted'::txn_status,
            i % 97 = 0,
            case when i % 30 = 0 then 520000 else -(500 + (i % 9000)) end,
            'MYR',
            ('2024-09-01'::date + (i % 730)),
            'Perf txn ' || i,
            case when i % 30 = 0 then null else (select id from cats where idx = i % 8) end,
            case when i % 30 = 0 then null else (select id from mers where idx = i % 20) end,
            1
     from generate_series(1, ${ROWS}) i`,
    [userId, account.id],
  );
  const [{ n }] = (
    await testDb.pool.query(`select count(*)::int as n from transactions where user_id = $1`, [
      userId,
    ])
  ).rows;
  expect(Number(n)).toBeGreaterThanOrEqual(ROWS);
}, 120_000);

afterAll(async () => {
  await testDb.drop();
});

const YEAR = { dateFrom: "2025-01-01", dateTo: "2025-12-31" };

describe(`analytics with ${ROWS} transactions`, () => {
  test("periodTotals aggregates in the database within budget", async () => {
    const totals = unwrap(
      await timed("periodTotals (12-month range)", () =>
        analyticsService.periodTotals(db, userId, YEAR),
      ),
      "totals",
    );
    expect(totals.MYR.incomeMinor).toBeGreaterThan(0);
  });

  test("monthlyFlows returns summary-sized results, never the ledger", async () => {
    const flows = unwrap(
      await timed("monthlyFlows (12 months)", () =>
        analyticsService.monthlyFlows(db, userId, YEAR),
      ),
      "flows",
    );
    expect(flows.length).toBe(12); // 12 months × 1 currency — not 10,000 rows
  });

  test("categoryBreakdown and topMerchants stay within budget", async () => {
    const breakdown = unwrap(
      await timed("categoryBreakdown", () =>
        analyticsService.categoryBreakdown(db, userId, { ...YEAR, kind: "expense" }),
      ),
      "breakdown",
    );
    expect(breakdown.length).toBeLessThanOrEqual(9); // 8 categories + uncategorized
    const merchants = unwrap(
      await timed("topMerchants", () =>
        analyticsService.topMerchants(db, userId, { ...YEAR, limit: 10 }),
      ),
      "merchants",
    );
    expect(merchants.length).toBeLessThanOrEqual(10);
  });

  test("netPositionTrend computes 12 month-ends within budget", async () => {
    const trend = unwrap(
      await timed("netPositionTrend (12 months)", () =>
        analyticsService.netPositionTrend(db, userId, YEAR),
      ),
      "trend",
    );
    expect(trend.length).toBe(12);
  });

  test("CSV export of a filtered month stays within budget and row caps", async () => {
    const out = unwrap(
      await timed("exportTransactionsCsv (1 month)", () =>
        exportsService.exportTransactionsCsv(db, userId, {
          dateFrom: "2025-06-01",
          dateTo: "2025-06-30",
        }),
      ),
      "export",
    );
    expect(out.rowCount).toBeGreaterThan(0);
    expect(out.truncated).toBe(false);
  });
});
