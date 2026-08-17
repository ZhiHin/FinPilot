import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { isErr, isOk, type Result } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { accountsService, type AccountRow } from "@/server/services/accounts";
import { analyticsService } from "@/server/services/analytics";
import { categoriesService } from "@/server/services/categories";
import { transactionsService } from "@/server/services/transactions";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;
let userA: string;
let userB: string;
let main: AccountRow;
let card: AccountRow;
let sgd: AccountRow;
let accountB: AccountRow;
let salaryCat: string;
let foodCat: string;
let transportCat: string;

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
  userA = await seedUser("analytics-a@example.com");
  userB = await seedUser("analytics-b@example.com");

  main = unwrap(
    await accountsService.create(db, userA, {
      name: "Main",
      type: "current",
      openingBalanceMinor: 100000,
      openingBalanceDate: "2026-01-01",
    }),
    "main",
  );
  card = unwrap(
    await accountsService.create(db, userA, {
      name: "Card",
      type: "credit_card",
      openingBalanceMinor: 0,
      openingBalanceDate: "2026-01-01",
    }),
    "card",
  );
  sgd = unwrap(
    await accountsService.create(db, userA, {
      name: "SG",
      type: "current",
      currency: "SGD",
      openingBalanceMinor: 0,
      openingBalanceDate: "2026-01-01",
    }),
    "sgd",
  );
  accountB = unwrap(
    await accountsService.create(db, userB, {
      name: "B main",
      type: "current",
      openingBalanceMinor: 0,
      openingBalanceDate: "2026-01-01",
    }),
    "accountB",
  );

  const incomeGroup = unwrap(
    await categoriesService.createGroup(db, userA, { name: "Earnings", kind: "income" }),
    "income group",
  );
  const livingGroup = unwrap(
    await categoriesService.createGroup(db, userA, { name: "Living", kind: "expense" }),
    "living group",
  );
  salaryCat = unwrap(
    await categoriesService.createCategory(db, userA, {
      groupId: incomeGroup.id,
      name: "Salary",
    }),
    "salary cat",
  ).id;
  foodCat = unwrap(
    await categoriesService.createCategory(db, userA, { groupId: livingGroup.id, name: "Food" }),
    "food cat",
  ).id;
  transportCat = unwrap(
    await categoriesService.createCategory(db, userA, {
      groupId: livingGroup.id,
      name: "Transport",
    }),
    "transport cat",
  ).id;

  const create = async (input: Parameters<typeof transactionsService.create>[2]) =>
    unwrap(await transactionsService.create(db, userA, input), `txn ${input.description}`);

  // ---- June 2026 (a complete month) ----
  await create({
    accountId: main.id,
    type: "income",
    amountMinor: 500000,
    txnDate: "2026-06-01",
    description: "Salary June",
    categoryId: salaryCat,
  });
  const groceries = await create({
    accountId: main.id,
    type: "expense",
    amountMinor: -100000,
    txnDate: "2026-06-05",
    description: "Groceries",
    merchantName: "Tesco",
    categoryId: foodCat,
  });
  await create({
    accountId: main.id,
    type: "expense",
    amountMinor: -30000,
    txnDate: "2026-06-10",
    description: "Grab combined",
    merchantName: "Grab",
    splits: [
      { categoryId: foodCat, amountMinor: -20000 },
      { categoryId: transportCat, amountMinor: -10000 },
    ],
  });
  const refund = await create({
    accountId: main.id,
    type: "refund",
    amountMinor: 5000,
    txnDate: "2026-06-12",
    description: "Tesco refund",
    merchantName: "Tesco",
    categoryId: foodCat,
  });
  unwrap(
    await transactionsService.linkRefund(db, userA, {
      refundTransactionId: refund.transaction.id,
      purchaseTransactionId: groceries.transaction.id,
    }),
    "link refund",
  );
  // Transfers never count as income or expense.
  unwrap(
    await transactionsService.createTransfer(db, userA, {
      fromAccountId: main.id,
      toAccountId: card.id,
      amountMinor: 40000,
      txnDate: "2026-06-15",
    }),
    "transfer",
  );
  // Excluded: out of reports, still in balances.
  await create({
    accountId: main.id,
    type: "expense",
    amountMinor: -99900,
    txnDate: "2026-06-20",
    description: "Excluded reimbursable",
    isExcluded: true,
  });
  // Pending: out of reports until posted.
  await create({
    accountId: main.id,
    type: "expense",
    amountMinor: -7700,
    txnDate: "2026-06-25",
    description: "Pending card hold",
    status: "pending",
  });
  // Deleted: out of everything.
  const doomed = await create({
    accountId: main.id,
    type: "expense",
    amountMinor: -88800,
    txnDate: "2026-06-26",
    description: "Deleted mistake",
  });
  unwrap(await transactionsService.softDelete(db, userA, doomed.transaction.id), "soft delete");

  // ---- July 2026 ----
  await create({
    accountId: main.id,
    type: "income",
    amountMinor: 400000,
    txnDate: "2026-07-01",
    description: "Salary July",
    categoryId: salaryCat,
  });
  await create({
    accountId: main.id,
    type: "expense",
    amountMinor: -250000,
    txnDate: "2026-07-05",
    description: "Rent",
    categoryId: foodCat,
  });

  // ---- Second currency: never combined ----
  await create({
    accountId: sgd.id,
    type: "income",
    amountMinor: 100000,
    txnDate: "2026-06-03",
    description: "SG dividend",
  });

  // ---- User B (isolation) ----
  unwrap(
    await transactionsService.create(db, userB, {
      accountId: accountB.id,
      type: "income",
      amountMinor: 777700,
      txnDate: "2026-06-01",
      description: "B income",
    }),
    "b txn",
  );
});

afterAll(async () => {
  await testDb.drop();
});

const JUNE = { dateFrom: "2026-06-01", dateTo: "2026-06-30" };
const JULY = { dateFrom: "2026-07-01", dateTo: "2026-07-31" };

describe("periodTotals — the single source of savings math", () => {
  test("June follows the documented reporting rules exactly", async () => {
    const totals = unwrap(await analyticsService.periodTotals(db, userA, JUNE), "totals");
    // income 5,000.00; expense 1,000 + 300 − 50 refund = 1,250.00; transfers,
    // excluded, pending, and deleted rows all stay out.
    expect(totals.MYR).toEqual({
      incomeMinor: 500000,
      expenseMinor: 125000,
      savingsMinor: 375000,
      savingsRateBp: 7500,
    });
    // Currencies are never combined: SGD reports separately.
    expect(totals.SGD).toEqual({
      incomeMinor: 100000,
      expenseMinor: 0,
      savingsMinor: 100000,
      savingsRateBp: 10000,
    });
  });

  test("zero-income periods report a null savings rate, never a misleading percent", async () => {
    const totals = unwrap(
      await analyticsService.periodTotals(db, userA, {
        dateFrom: "2026-05-01",
        dateTo: "2026-05-31",
      }),
      "empty month",
    );
    expect(totals.MYR).toBeUndefined(); // no activity at all

    // A month with only spending: savings negative, rate null.
    const julyCard = unwrap(
      await analyticsService.periodTotals(db, userA, { ...JULY, categoryIds: [foodCat] }),
      "filtered",
    );
    expect(julyCard.MYR?.expenseMinor).toBe(250000);
    expect(julyCard.MYR?.incomeMinor).toBe(0);
    expect(julyCard.MYR?.savingsRateBp).toBeNull();
    expect(julyCard.MYR?.savingsMinor).toBe(-250000);
  });

  test("account filter scopes the report", async () => {
    const totals = unwrap(
      await analyticsService.periodTotals(db, userA, { ...JUNE, accountIds: [main.id] }),
      "account filter",
    );
    expect(totals.SGD).toBeUndefined();
    expect(totals.MYR?.incomeMinor).toBe(500000);
  });

  test("filters referencing another user's ids fail closed", async () => {
    expect(
      isErr(await analyticsService.periodTotals(db, userA, { ...JUNE, accountIds: [accountB.id] })),
    ).toBe(true);
    expect(
      isErr(await analyticsService.periodTotals(db, userB, { ...JUNE, categoryIds: [foodCat] })),
    ).toBe(true);
  });

  test("user B never sees user A's activity", async () => {
    const totals = unwrap(await analyticsService.periodTotals(db, userB, JUNE), "b totals");
    expect(totals.MYR?.incomeMinor).toBe(777700);
    expect(totals.MYR?.expenseMinor).toBe(0);
  });
});

describe("monthlyFlows", () => {
  test("groups by calendar month per currency with zero-filled gaps", async () => {
    const rows = unwrap(
      await analyticsService.monthlyFlows(db, userA, {
        dateFrom: "2026-05-01",
        dateTo: "2026-07-31",
      }),
      "flows",
    );
    const myr = rows.filter((r) => r.currency === "MYR");
    expect(myr.map((r) => r.month)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(myr[0]).toMatchObject({ incomeMinor: 0, expenseMinor: 0, savingsMinor: 0 });
    expect(myr[1]).toMatchObject({
      incomeMinor: 500000,
      expenseMinor: 125000,
      savingsMinor: 375000,
      savingsRateBp: 7500,
    });
    expect(myr[2]).toMatchObject({
      incomeMinor: 400000,
      expenseMinor: 250000,
      savingsMinor: 150000,
      savingsRateBp: 3750,
    });
    const sgdRows = rows.filter((r) => r.currency === "SGD");
    expect(sgdRows.map((r) => r.month)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(sgdRows[1].incomeMinor).toBe(100000);
  });
});

describe("categoryBreakdown", () => {
  test("expense breakdown is split-aware and refund-reducing, with no double count", async () => {
    const rows = unwrap(
      await analyticsService.categoryBreakdown(db, userA, { ...JUNE, kind: "expense" }),
      "breakdown",
    );
    const myr = rows.filter((r) => r.currency === "MYR");
    const food = myr.find((r) => r.categoryId === foodCat);
    const transport = myr.find((r) => r.categoryId === transportCat);
    // Food: 1,000 groceries + 200 split share − 50 refund = 1,150.00
    expect(food?.amountMinor).toBe(115000);
    expect(transport?.amountMinor).toBe(10000);
    // The split parent must not ALSO appear against its own category.
    const total = myr.reduce((sum, r) => sum + r.amountMinor, 0);
    expect(total).toBe(125000); // matches periodTotals expense exactly
  });

  test("income breakdown groups by category", async () => {
    const rows = unwrap(
      await analyticsService.categoryBreakdown(db, userA, { ...JUNE, kind: "income" }),
      "income breakdown",
    );
    const salary = rows.find((r) => r.currency === "MYR" && r.categoryId === salaryCat);
    expect(salary?.amountMinor).toBe(500000);
    const uncategorizedSgd = rows.find((r) => r.currency === "SGD" && r.categoryId === null);
    expect(uncategorizedSgd?.amountMinor).toBe(100000);
  });
});

describe("topMerchants", () => {
  test("ranks net expense per merchant (refunds reduce their merchant)", async () => {
    const rows = unwrap(
      await analyticsService.topMerchants(db, userA, { ...JUNE, limit: 5 }),
      "merchants",
    );
    const myr = rows.filter((r) => r.currency === "MYR");
    expect(myr[0]).toMatchObject({ name: "Tesco", spendMinor: 95000 });
    expect(myr[1]).toMatchObject({ name: "Grab", spendMinor: 30000 });
  });
});

describe("netPositionTrend", () => {
  test("month-end balances include excluded but not pending or deleted rows", async () => {
    const rows = unwrap(
      await analyticsService.netPositionTrend(db, userA, {
        dateFrom: "2026-05-01",
        dateTo: "2026-06-30",
      }),
      "trend",
    );
    const myr = rows.filter((r) => r.currency === "MYR");
    expect(myr.map((r) => r.month)).toEqual(["2026-05", "2026-06"]);
    // May: opening balances only (1,000.00 main + 0 card).
    expect(myr[0].netMinor).toBe(100000);
    // June-end main: 1,000 + 5,000 − 1,000 − 300 + 50 − 400 transfer − 999 excluded = 3,351.00
    // card: 0 + 400 transfer in. Net = 3,751.00.
    expect(myr[1].netMinor).toBe(375100);
    expect(myr[1].assetsMinor).toBe(335100);
    expect(myr[1].liabilitiesMinor).toBe(40000);
    const sgdRows = rows.filter((r) => r.currency === "SGD");
    expect(sgdRows[1].netMinor).toBe(100000);
  });
});

describe("dataQuality", () => {
  test("reports pending, needs-review, and uncategorized counts for the period", async () => {
    const quality = unwrap(await analyticsService.dataQuality(db, userA, JUNE), "quality");
    expect(quality.pendingCount).toBe(1);
    expect(quality.uncategorizedCount).toBeGreaterThanOrEqual(1); // excluded expense has no category
    expect(quality.uncommittedImportJobs).toBe(0);
  });
});
