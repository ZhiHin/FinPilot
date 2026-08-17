import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { isErr, isOk, type Result } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { accountsService, type AccountRow } from "@/server/services/accounts";
import { budgetsService } from "@/server/services/budgets";
import { categoriesService } from "@/server/services/categories";
import { transactionsService } from "@/server/services/transactions";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;
let userA: string;
let userB: string;
let account: AccountRow;
let foodCat: string;
let transportCat: string;
let funCat: string;

const TODAY = "2026-08-17";

function unwrap<T>(result: Result<T>, label: string): T {
  if (!isOk(result)) throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  return result.data;
}

async function seedUser(email: string): Promise<string> {
  const id = uuidv7();
  await testDb.pool.query(`insert into users (id, email, password_hash) values ($1, $2, 'x')`, [
    id,
    email,
  ]);
  return id;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  userA = await seedUser("budget-a@example.com");
  userB = await seedUser("budget-b@example.com");
  account = unwrap(
    await accountsService.create(db, userA, {
      name: "Budget main",
      type: "current",
      openingBalanceMinor: 1000000,
      openingBalanceDate: "2026-01-01",
    }),
    "account",
  );
  const group = unwrap(
    await categoriesService.createGroup(db, userA, { name: "Spending", kind: "expense" }),
    "group",
  );
  foodCat = unwrap(
    await categoriesService.createCategory(db, userA, { groupId: group.id, name: "Food" }),
    "food",
  ).id;
  transportCat = unwrap(
    await categoriesService.createCategory(db, userA, { groupId: group.id, name: "Transport" }),
    "transport",
  ).id;
  funCat = unwrap(
    await categoriesService.createCategory(db, userA, { groupId: group.id, name: "Fun" }),
    "fun",
  ).id;

  const create = async (input: Parameters<typeof transactionsService.create>[2]) =>
    unwrap(await transactionsService.create(db, userA, input), `txn ${input.description}`);

  // ---- July (previous calendar month) ----
  await create({
    accountId: account.id,
    type: "expense",
    amountMinor: -40000,
    txnDate: "2026-07-10",
    description: "July food",
    categoryId: foodCat,
  });

  // ---- August (current month) ----
  await create({
    accountId: account.id,
    type: "expense",
    amountMinor: -30000,
    txnDate: "2026-08-05",
    description: "August groceries",
    categoryId: foodCat,
  });
  // Refund reduces Food spending.
  await create({
    accountId: account.id,
    type: "refund",
    amountMinor: 5000,
    txnDate: "2026-08-06",
    description: "Grocery refund",
    categoryId: foodCat,
  });
  // Split: Food 100.00 + Transport 50.00.
  await create({
    accountId: account.id,
    type: "expense",
    amountMinor: -15000,
    txnDate: "2026-08-08",
    description: "Split ride+meal",
    splits: [
      { categoryId: foodCat, amountMinor: -10000 },
      { categoryId: transportCat, amountMinor: -5000 },
    ],
  });
  // Pending: shown separately, never in posted.
  await create({
    accountId: account.id,
    type: "expense",
    amountMinor: -7000,
    txnDate: "2026-08-10",
    description: "Pending card hold",
    categoryId: foodCat,
    status: "pending",
  });
  // Excluded: out entirely.
  await create({
    accountId: account.id,
    type: "expense",
    amountMinor: -99900,
    txnDate: "2026-08-11",
    description: "Excluded business meal",
    categoryId: foodCat,
    isExcluded: true,
  });
  // Deleted: out entirely.
  const doomed = await create({
    accountId: account.id,
    type: "expense",
    amountMinor: -12300,
    txnDate: "2026-08-12",
    description: "Deleted",
    categoryId: foodCat,
  });
  unwrap(await transactionsService.softDelete(db, userA, doomed.transaction.id), "delete");
  // Uncategorized spending: reported separately.
  await create({
    accountId: account.id,
    type: "expense",
    amountMinor: -8800,
    txnDate: "2026-08-13",
    description: "Mystery spend",
  });
  // Unbudgeted category (Fun): reported separately from allocations.
  await create({
    accountId: account.id,
    type: "expense",
    amountMinor: -6600,
    txnDate: "2026-08-14",
    description: "Cinema",
    categoryId: funCat,
  });
});

afterAll(async () => {
  await testDb.drop();
});

let budgetId: string;
let augustPeriodId: string;

describe("budget lifecycle", () => {
  test("create → current period report with correct inclusion rules", async () => {
    const budget = unwrap(
      await budgetsService.create(db, userA, {
        name: "Household",
        mode: "flexible",
        cycleType: "calendar_month",
      }),
      "create budget",
    );
    budgetId = budget.id;

    // Duplicate active name rejected.
    const dup = await budgetsService.create(db, userA, {
      name: "household",
      mode: "fixed",
      cycleType: "calendar_month",
    });
    expect(isErr(dup)).toBe(true);

    const report = unwrap(
      await budgetsService.periodReport(db, userA, { budgetId, today: TODAY }),
      "report",
    );
    augustPeriodId = report.period.id;
    expect(report.period.periodStart).toBe("2026-08-01");
    expect(report.period.periodEnd).toBe("2026-08-31");
    expect(report.allocations).toEqual([]);
    // Unbudgeted + uncategorized spending are visible, never silently assigned.
    // Food: 300 − 50 refund + 100 split = 350.00 posted; Transport 50.00; Fun 66.00.
    const food = report.unbudgeted.find((r) => r.categoryId === foodCat);
    expect(food?.postedMinor).toBe(35000);
    expect(food?.pendingMinor).toBe(7000);
    expect(report.unbudgeted.find((r) => r.categoryId === transportCat)?.postedMinor).toBe(5000);
    expect(report.uncategorized.postedMinor).toBe(8800);
  });

  test("allocations: create, edit with version guard, duplicate rejected", async () => {
    const set = unwrap(
      await budgetsService.setAllocation(db, userA, {
        periodId: augustPeriodId,
        categoryId: foodCat,
        plannedMinor: 60000,
        rolloverEnabled: true,
      }),
      "allocate food",
    );
    unwrap(
      await budgetsService.setAllocation(db, userA, {
        periodId: augustPeriodId,
        categoryId: transportCat,
        plannedMinor: 20000,
      }),
      "allocate transport",
    );

    // Upsert path: same category updates (with version check), never duplicates.
    const edited = unwrap(
      await budgetsService.setAllocation(db, userA, {
        periodId: augustPeriodId,
        categoryId: foodCat,
        plannedMinor: 65000,
        expectedVersion: 1,
      }),
      "edit food",
    );
    expect(edited.allocationId).toBe(set.allocationId);
    const stale = await budgetsService.setAllocation(db, userA, {
      periodId: augustPeriodId,
      categoryId: foodCat,
      plannedMinor: 70000,
      expectedVersion: 1, // now stale
    });
    expect(isErr(stale)).toBe(true);

    const report = unwrap(
      await budgetsService.periodReport(db, userA, { budgetId, today: TODAY }),
      "report",
    );
    const food = report.allocations.find((a) => a.categoryId === foodCat);
    expect(food).toMatchObject({
      plannedMinor: 65000,
      postedMinor: 35000,
      pendingMinor: 7000,
      availableMinor: 65000,
      remainingMinor: 30000,
    });
    // Usage 35000/65000 ≈ 53.85%, elapsed 17/31 ≈ 54.8% → on pace.
    expect(food?.health).toBe("on_track");
    expect(report.totals.plannedMinor).toBe(85000);
    expect(report.totals.postedMinor).toBe(40000);
    expect(report.unbudgeted.find((r) => r.categoryId === foodCat)).toBeUndefined();
    expect(report.unbudgeted.find((r) => r.categoryId === funCat)?.postedMinor).toBe(6600);
  });

  test("navigating to the previous period creates it as history (no rollover backwards)", async () => {
    const july = unwrap(
      await budgetsService.periodReport(db, userA, {
        budgetId,
        periodStart: "2026-07-01",
        today: TODAY,
      }),
      "july",
    );
    expect(july.period.periodStart).toBe("2026-07-01");
    expect(july.allocations).toEqual([]);
    expect(july.unbudgeted.find((r) => r.categoryId === foodCat)?.postedMinor).toBe(40000);

    // A future period is refused, not created.
    const future = await budgetsService.periodReport(db, userA, {
      budgetId,
      periodStart: "2026-09-01",
      today: TODAY,
    });
    expect(isErr(future)).toBe(true);
    // Misaligned starts are refused.
    const misaligned = await budgetsService.periodReport(db, userA, {
      budgetId,
      periodStart: "2026-08-02",
      today: TODAY,
    });
    expect(isErr(misaligned)).toBe(true);
  });

  test("copy previous period fills only missing categories, computing rollover once", async () => {
    // In July's period, allocate Food 50.00 planned with rollover enabled.
    const julyReport = unwrap(
      await budgetsService.periodReport(db, userA, {
        budgetId,
        periodStart: "2026-07-01",
        today: TODAY,
      }),
      "july report",
    );
    unwrap(
      await budgetsService.setAllocation(db, userA, {
        periodId: julyReport.period.id,
        categoryId: funCat,
        plannedMinor: 10000,
        rolloverEnabled: true,
      }),
      "july fun allocation",
    );

    const copied = unwrap(
      await budgetsService.copyPreviousPeriod(db, userA, augustPeriodId),
      "copy",
    );
    // Food + Transport already exist in August; only Fun copies.
    expect(copied.copied).toBe(1);
    const report = unwrap(
      await budgetsService.periodReport(db, userA, { budgetId, today: TODAY }),
      "after copy",
    );
    const fun = report.allocations.find((a) => a.categoryId === funCat);
    // July Fun: planned 100.00, spent 0 → rollover-in 100.00 (adjacent periods).
    expect(fun).toMatchObject({ plannedMinor: 10000, rolloverInMinor: 10000 });
    expect(fun?.availableMinor).toBe(20000);
    // Fun is no longer "unbudgeted".
    expect(report.unbudgeted.find((r) => r.categoryId === funCat)).toBeUndefined();
  });

  test("zero-based budgets surface unallocated income explicitly", async () => {
    const zb = unwrap(
      await budgetsService.create(db, userA, {
        name: "Zero based",
        mode: "zero_based",
        cycleType: "calendar_month",
      }),
      "zb budget",
    );
    const report = unwrap(
      await budgetsService.periodReport(db, userA, { budgetId: zb.id, today: TODAY }),
      "zb report",
    );
    expect(report.unallocatedIncomeMinor).toBeNull(); // no expected income yet
    unwrap(
      await budgetsService.updatePeriodMeta(db, userA, report.period.id, {
        expectedIncomeMinor: 500000,
        notes: "August plan",
      }),
      "meta",
    );
    unwrap(
      await budgetsService.setAllocation(db, userA, {
        periodId: report.period.id,
        categoryId: foodCat,
        plannedMinor: 520000,
      }),
      "over-allocate",
    );
    const after = unwrap(
      await budgetsService.periodReport(db, userA, { budgetId: zb.id, today: TODAY }),
      "zb after",
    );
    expect(after.unallocatedIncomeMinor).toBe(-20000); // over-allocated, shown as negative
    expect(after.period.notes).toBe("August plan");
    unwrap(await budgetsService.archive(db, userA, zb.id), "archive zb");
  });
});

describe("payday cycles", () => {
  test("payday budget windows follow the weekend-adjusted anchor", async () => {
    const payday = unwrap(
      await budgetsService.create(db, userA, {
        name: "Payday budget",
        mode: "fixed",
        cycleType: "payday",
        cycleAnchor: { day: 25, weekendAdjust: true },
      }),
      "payday budget",
    );
    const report = unwrap(
      await budgetsService.periodReport(db, userA, { budgetId: payday.id, today: TODAY }),
      "payday report",
    );
    // 25 Jul 2026 is a Saturday → window starts Friday 24 Jul, ends 24 Aug.
    expect(report.period.periodStart).toBe("2026-07-24");
    expect(report.period.periodEnd).toBe("2026-08-24");
    // July food expense (10 Jul) is OUTSIDE this window; August spend is inside.
    const food = report.unbudgeted.find((r) => r.categoryId === foodCat);
    expect(food?.postedMinor).toBe(35000);
    unwrap(await budgetsService.archive(db, userA, payday.id), "archive payday");
  });

  test("payday budgets without an anchor are rejected", async () => {
    const bad = await budgetsService.create(db, userA, {
      name: "No anchor",
      mode: "fixed",
      cycleType: "payday",
    });
    expect(isErr(bad)).toBe(true);
  });
});

describe("rollover generation on period boundaries", () => {
  test("a rollover-mode budget carries leftovers once when the next period opens", async () => {
    const roll = unwrap(
      await budgetsService.create(db, userA, {
        name: "Rollover budget",
        mode: "rollover",
        cycleType: "calendar_month",
      }),
      "rollover budget",
    );
    // Build July history: Transport planned 200.00, spent 0 in July? July has
    // no transport spend, so leftover = planned.
    const july = unwrap(
      await budgetsService.periodReport(db, userA, {
        budgetId: roll.id,
        periodStart: "2026-07-01",
        today: TODAY,
      }),
      "july",
    );
    unwrap(
      await budgetsService.setAllocation(db, userA, {
        periodId: july.period.id,
        categoryId: transportCat,
        plannedMinor: 20000,
      }),
      "july transport",
    );
    // Opening August (lazy creation) computes rollover ONCE and closes July.
    const august = unwrap(
      await budgetsService.periodReport(db, userA, { budgetId: roll.id, today: TODAY }),
      "august",
    );
    const transport = august.allocations.find((a) => a.categoryId === transportCat);
    expect(transport).toMatchObject({ plannedMinor: 20000, rolloverInMinor: 20000 });
    expect(transport?.availableMinor).toBe(40000);
    // August transport spend 50.00 → remaining = 400 − 50 = 350.00.
    expect(transport?.remainingMinor).toBe(35000);

    const julyAfter = unwrap(
      await budgetsService.periodReport(db, userA, {
        budgetId: roll.id,
        periodStart: "2026-07-01",
        today: TODAY,
      }),
      "july after",
    );
    expect(julyAfter.period.status).toBe("closed");
    unwrap(await budgetsService.archive(db, userA, roll.id), "archive roll");
  });
});

describe("isolation and auditing", () => {
  test("user B cannot see or touch user A's budget", async () => {
    expect(isErr(await budgetsService.periodReport(db, userB, { budgetId, today: TODAY }))).toBe(
      true,
    );
    expect(
      isErr(
        await budgetsService.setAllocation(db, userB, {
          periodId: augustPeriodId,
          categoryId: foodCat,
          plannedMinor: 1,
        }),
      ),
    ).toBe(true);
    expect(isErr(await budgetsService.copyPreviousPeriod(db, userB, augustPeriodId))).toBe(true);
    expect(isErr(await budgetsService.archive(db, userB, budgetId))).toBe(true);
    // User B allocating THEIR period against A's category also fails closed.
    const bBudget = unwrap(
      await budgetsService.create(db, userB, {
        name: "B budget",
        mode: "fixed",
        cycleType: "calendar_month",
      }),
      "b budget",
    );
    const bReport = unwrap(
      await budgetsService.periodReport(db, userB, { budgetId: bBudget.id, today: TODAY }),
      "b report",
    );
    expect(
      isErr(
        await budgetsService.setAllocation(db, userB, {
          periodId: bReport.period.id,
          categoryId: foodCat, // user A's category
          plannedMinor: 1000,
        }),
      ),
    ).toBe(true);
  });

  test("budget changes are audited", async () => {
    const events = await testDb.pool.query(
      `select event_type, count(*)::int as n from audit_logs
       where user_id = $1 and event_type like 'budget%' group by event_type order by event_type`,
      [userA],
    );
    const byType = Object.fromEntries(events.rows.map((r) => [r.event_type, Number(r.n)]));
    expect(byType["budget.created"]).toBeGreaterThanOrEqual(4);
    expect(byType["budget.archived"]).toBeGreaterThanOrEqual(3);
    expect(byType["budget_allocation.created"]).toBeGreaterThanOrEqual(4);
    expect(byType["budget_allocation.updated"]).toBeGreaterThanOrEqual(1);
    expect(byType["budget_period.created"]).toBeGreaterThanOrEqual(4);
    expect(byType["budget_period.copied"]).toBeGreaterThanOrEqual(1);
  });
});
