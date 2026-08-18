import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { isOk, type Result } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { accountsService, type AccountRow } from "@/server/services/accounts";
import { categoriesService } from "@/server/services/categories";
import { exportsService } from "@/server/services/exports";
import { intelService } from "@/server/services/intel";
import { transactionsService } from "@/server/services/transactions";

import { createTestDatabase, type TestDatabase } from "./harness";

/**
 * Phase 10 release performance profile (spec C8 / V5). Phase 4 already covers
 * analytics aggregation; this profiles the remaining release-critical server
 * paths at the 10k-transaction scale: the Transactions workspace list
 * (first page, deep keyset page, text search), the Overview's intelligence
 * (safe-to-spend, 90-day forecast cold and cached), the net-position roll-up,
 * and the new full-account export.
 *
 * Budgets are deliberately loose — these run on shared CI hardware and the
 * point is to catch order-of-magnitude regressions (missing index, N+1,
 * whole-ledger materialization), not to benchmark. Measured numbers are
 * printed and recorded in docs/progress/phase-10.md.
 */

const ROWS = 10_000;
const PAGE_BUDGET_MS = 1_500;
const HEAVY_BUDGET_MS = 4_000;

let testDb: TestDatabase;
let db: Db;
let userId: string;
let account: AccountRow;

const measurements: Array<{ label: string; ms: number }> = [];

function unwrap<T>(result: Result<T>, label: string): T {
  if (!isOk(result)) throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  return result.data;
}

async function timed<T>(label: string, budgetMs: number, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const value = await run();
  const ms = Math.round(performance.now() - start);
  measurements.push({ label, ms });
  process.stdout.write(`[perf] ${label}: ${ms}ms over ${ROWS} transactions\n`);
  expect(ms, `${label} exceeded ${budgetMs}ms`).toBeLessThan(budgetMs);
  return value;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  userId = uuidv7();
  await testDb.pool.query(
    `insert into users (id, email, password_hash) values ($1, 'release-perf@example.com', 'x')`,
    [userId],
  );
  await testDb.pool.query(
    `insert into user_preferences (user_id, safety_buffer_minor) values ($1, 30000)`,
    [userId],
  );
  account = unwrap(
    await accountsService.create(db, userId, {
      name: "Perf current",
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
  for (let i = 0; i < 8; i++) {
    unwrap(
      await categoriesService.createCategory(db, userId, {
        groupId: group.id,
        name: `Category ${i}`,
      }),
      `cat ${i}`,
    );
  }
  await testDb.pool.query(
    `insert into merchants (id, user_id, canonical_name, normalized_key)
     select gen_random_uuid(), $1, 'Merchant ' || i, 'merchant-' || i from generate_series(0, 19) i`,
    [userId],
  );

  // 10,000 transactions ending "today" so forecast/STS windows are populated.
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
            ('2026-08-17'::date - (i % 730)),
            case when i % 500 = 0 then 'ZUS Coffee KLCC ' || i else 'Perf txn ' || i end,
            case when i % 30 = 0 then null else (select id from cats where idx = i % 8) end,
            case when i % 30 = 0 then null else (select id from mers where idx = i % 20) end,
            1
     from generate_series(1, ${ROWS}) i`,
    [userId, account.id],
  );
}, 120_000);

afterAll(async () => {
  process.stdout.write(
    `[perf] release profile summary: ${measurements
      .map((m) => `${m.label}=${m.ms}ms`)
      .join(", ")}\n`,
  );
  await testDb.drop();
});

describe(`release-critical paths with ${ROWS} transactions`, () => {
  test("transactions list: first page is keyset-paged, not a full scan", async () => {
    const page = await timed("transactions.list (first page, 50)", PAGE_BUDGET_MS, () =>
      transactionsService.list(db, userId, { limit: 50 }),
    );
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
  });

  test("transactions list: a deep page costs about the same as the first", async () => {
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page: { items: unknown[]; nextCursor: string | null } = await transactionsService.list(
        db,
        userId,
        { limit: 50, cursor: cursor ?? undefined },
      );
      cursor = page.nextCursor;
      expect(cursor).not.toBeNull();
    }
    const deep = await timed("transactions.list (page 21 via cursor)", PAGE_BUDGET_MS, () =>
      transactionsService.list(db, userId, { limit: 50, cursor: cursor ?? undefined }),
    );
    expect(deep.items.length).toBeGreaterThan(0);
  });

  test("transactions list: text search and filters stay within budget", async () => {
    const found = await timed("transactions.list (search + filter)", PAGE_BUDGET_MS, () =>
      transactionsService.list(db, userId, {
        search: "ZUS Coffee",
        types: ["expense"],
        limit: 50,
      }),
    );
    expect(found.items.length).toBeGreaterThan(0);
  });

  test("overview intelligence: safe-to-spend and forecast (cold, then cached)", async () => {
    unwrap(
      await timed("intel.safeToSpend", HEAVY_BUDGET_MS, () =>
        intelService.safeToSpend(db, userId, "2026-08-17"),
      ),
      "safe-to-spend",
    );

    const cold = unwrap(
      await timed("intel.cashFlowForecast (90d, cold)", HEAVY_BUDGET_MS, () =>
        intelService.cashFlowForecast(db, userId, { horizonDays: 90, today: "2026-08-17" }),
      ),
      "forecast cold",
    );
    expect(cold.cached).toBe(false);

    const warm = unwrap(
      await timed("intel.cashFlowForecast (90d, cached)", PAGE_BUDGET_MS, () =>
        intelService.cashFlowForecast(db, userId, { horizonDays: 90, today: "2026-08-17" }),
      ),
      "forecast cached",
    );
    expect(warm.cached).toBe(true);
  });

  test("net position rolls up per currency without loading the ledger", async () => {
    const position = await timed("accounts.netPosition", PAGE_BUDGET_MS, () =>
      accountsService.netPosition(db, userId),
    );
    expect(Object.keys(position)).toEqual(["MYR"]);
  });

  test("full-account export completes within budget at 10k rows", async () => {
    const archive = unwrap(
      await timed("exports.exportAccountArchive", HEAVY_BUDGET_MS, () =>
        exportsService.exportAccountArchive(db, userId),
      ),
      "archive",
    );
    expect(archive.totalRows).toBeGreaterThan(ROWS);
  });
});
