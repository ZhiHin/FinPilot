import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { isErr, isOk, type Result } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { accountsService, type AccountRow } from "@/server/services/accounts";
import { budgetsService } from "@/server/services/budgets";
import { categoriesService } from "@/server/services/categories";
import { goalsService } from "@/server/services/goals";
import { intelService } from "@/server/services/intel";
import { recurringService } from "@/server/services/recurring";
import { transactionsService } from "@/server/services/transactions";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;
let userA: string; // STS + forecast
let userB: string; // isolation
let userC: string; // insights
let accountA: AccountRow;
let accountC: AccountRow;
let internetCatA: string;
let foodCatA: string;

const TODAY = "2026-08-17";

function unwrap<T>(result: Result<T>, label: string): T {
  if (!isOk(result)) throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  return result.data;
}

async function seedUser(email: string, buffer: number): Promise<string> {
  const id = uuidv7();
  await testDb.pool.query(`insert into users (id, email, password_hash) values ($1, $2, 'x')`, [
    id,
    email,
  ]);
  await testDb.pool.query(
    `insert into user_preferences (user_id, safety_buffer_minor, income_pattern)
     values ($1, $2, '{"frequency":"monthly","day":25,"weekendAdjust":true}'::jsonb)`,
    [id, buffer],
  );
  return id;
}

/** Monthly series ending last month (day < 25 keeps next-due before payday). */
async function monthlySeries(
  userId: string,
  accountId: string,
  description: string,
  merchantName: string | null,
  categoryId: string | null,
  amounts: number[],
  day: number,
  type: "expense" | "income" = "expense",
): Promise<void> {
  const [y, m] = TODAY.split("-").map(Number);
  const start = y * 12 + (m - 1) - amounts.length;
  for (const [index, amount] of amounts.entries()) {
    const total = start + index;
    unwrap(
      await transactionsService.create(db, userId, {
        accountId,
        type,
        amountMinor: type === "income" ? amount : -amount,
        txnDate: `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        description,
        merchantName: merchantName ?? undefined,
        categoryId,
      }),
      `${description} ${index}`,
    );
  }
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  userA = await seedUser("intel-a@example.com", 30000);
  userB = await seedUser("intel-b@example.com", 0);
  userC = await seedUser("intel-c@example.com", 30000);

  accountA = unwrap(
    await accountsService.create(db, userA, {
      name: "Intel main",
      type: "current",
      openingBalanceMinor: 900000,
      openingBalanceDate: "2026-01-01",
    }),
    "account A",
  );
  const groupA = unwrap(
    await categoriesService.createGroup(db, userA, { name: "Living A", kind: "expense" }),
    "group A",
  );
  internetCatA = unwrap(
    await categoriesService.createCategory(db, userA, { groupId: groupA.id, name: "Internet" }),
    "internet",
  ).id;
  foodCatA = unwrap(
    await categoriesService.createCategory(db, userA, { groupId: groupA.id, name: "Food" }),
    "food",
  ).id;

  // Recurring bill due Aug 20 (inside the window to payday on the 25th).
  await monthlySeries(
    userA,
    accountA.id,
    "UNIFI HOME",
    null,
    internetCatA,
    Array(6).fill(12900),
    20,
  );
  // Inferred mid-month income due Aug 22.
  await monthlySeries(
    userA,
    accountA.id,
    "FREELANCE PAYOUT",
    null,
    null,
    Array(4).fill(130000),
    22,
    "income",
  );
  unwrap(await recurringService.scan(db, userA, TODAY), "scan A");

  // Budget: Food committal counts; Internet is claimed by the bill (no double count).
  const budget = unwrap(
    await budgetsService.create(db, userA, {
      name: "Intel budget",
      mode: "flexible",
      cycleType: "calendar_month",
    }),
    "budget A",
  );
  const report = unwrap(
    await budgetsService.periodReport(db, userA, { budgetId: budget.id, today: TODAY }),
    "report A",
  );
  unwrap(
    await budgetsService.setAllocation(db, userA, {
      periodId: report.period.id,
      categoryId: foodCatA,
      plannedMinor: 60000,
    }),
    "alloc food",
  );
  unwrap(
    await budgetsService.setAllocation(db, userA, {
      periodId: report.period.id,
      categoryId: internetCatA,
      plannedMinor: 20000,
    }),
    "alloc internet",
  );
  // Spend RM 300 of the Food plan this month.
  unwrap(
    await transactionsService.create(db, userA, {
      accountId: accountA.id,
      type: "expense",
      amountMinor: -30000,
      txnDate: "2026-08-10",
      description: "Groceries",
      categoryId: foodCatA,
    }),
    "food spend",
  );

  // Goal: RM 480/month schedule, RM 200 contributed this month → RM 280 due.
  const goal = unwrap(
    await goalsService.create(db, userA, {
      name: "Emergency",
      type: "emergency",
      targetAmountMinor: 1000000,
      contributionSchedule: { amountMinor: 48000, frequency: "monthly" },
    }),
    "goal A",
  );
  unwrap(
    await goalsService.addContribution(db, userA, goal.id, {
      amountMinor: 20000,
      contributedOn: "2026-08-05",
    }),
    "goal contribution",
  );
});

afterAll(async () => {
  await testDb.drop();
});

describe("safe-to-spend (backlog: itemization equals ledger math)", () => {
  test("terms are gathered correctly and sum exactly to the expected band", async () => {
    const view = unwrap(await intelService.safeToSpend(db, userA, TODAY), "sts");
    expect(view.payday).toBe("2026-08-25"); // Tue, no weekend adjustment
    expect(view.result.daysToPayday).toBe(8);

    const b = view.result.breakdown;
    // Liquid = 900,000 opening − 6×12,900 bills + 4×130,000 income − 30,000 food.
    expect(b.liquidMinor).toBe(900000 - 6 * 12900 + 4 * 130000 - 30000);
    // The Unifi bill due 20 Aug is inferred → predicted, not confirmed.
    expect(b.confirmedBillsMinor).toBe(0);
    expect(b.predictedBillsMinor).toBe(12900);
    expect(b.incomeExpectedMinor).toBe(130000);
    // Food committal = 60,000 planned − 30,000 spent; Internet excluded (bill).
    expect(b.budgetCommittalMinor).toBe(30000);
    expect(view.committalItems.map((i) => i.name)).toEqual(["Food"]);
    expect(b.goalContributionsDueMinor).toBe(28000);
    expect(b.safetyBufferMinor).toBe(30000);

    const expectedUntilPayday =
      b.liquidMinor +
      b.incomeExpectedMinor -
      b.confirmedBillsMinor -
      b.predictedBillsMinor -
      b.budgetCommittalMinor -
      b.goalContributionsDueMinor -
      b.safetyBufferMinor;
    expect(view.result.expected.untilPaydayMinor).toBe(expectedUntilPayday);
    // Inferred income + tolerant bill → a range (B1), ordered bands (B2).
    expect(view.result.isRange).toBe(true);
    expect(view.result.conservative.untilPaydayMinor).toBeLessThan(
      view.result.expected.untilPaydayMinor,
    );
  });
});

describe("cash-flow forecast (cached per ADR-015)", () => {
  test("bands are monotone daily; caching hits until the ledger changes", async () => {
    const first = unwrap(
      await intelService.cashFlowForecast(db, userA, { horizonDays: 30, today: TODAY }),
      "forecast 1",
    );
    expect(first.cached).toBe(false);
    expect(first.series.length).toBe(30);
    for (const point of first.series) {
      expect(point.conservativeMinor).toBeLessThanOrEqual(point.expectedMinor);
      expect(point.expectedMinor).toBeLessThanOrEqual(point.optimisticMinor);
    }

    const second = unwrap(
      await intelService.cashFlowForecast(db, userA, { horizonDays: 30, today: TODAY }),
      "forecast 2",
    );
    expect(second.cached).toBe(true);
    expect(second.series).toEqual(first.series);

    // A ledger change invalidates the inputs hash.
    unwrap(
      await transactionsService.create(db, userA, {
        accountId: accountA.id,
        type: "expense",
        amountMinor: -1000,
        txnDate: TODAY,
        description: "Invalidator",
      }),
      "invalidator",
    );
    const third = unwrap(
      await intelService.cashFlowForecast(db, userA, { horizonDays: 30, today: TODAY }),
      "forecast 3",
    );
    expect(third.cached).toBe(false);

    // Different horizons compute independently.
    const ninety = unwrap(
      await intelService.cashFlowForecast(db, userA, { horizonDays: 90, today: TODAY }),
      "forecast 90",
    );
    expect(ninety.series.length).toBe(90);
  });
});

describe("insight generation (deterministic producers, deduplicated)", () => {
  beforeAll(async () => {
    accountC = unwrap(
      await accountsService.create(db, userC, {
        name: "Intel C",
        type: "current",
        openingBalanceMinor: 500000,
        openingBalanceDate: "2026-01-01",
      }),
      "account C",
    );
    const groupC = unwrap(
      await categoriesService.createGroup(db, userC, { name: "Living C", kind: "expense" }),
      "group C",
    );
    const delivery = unwrap(
      await categoriesService.createCategory(db, userC, {
        groupId: groupC.id,
        name: "Food delivery",
      }),
      "delivery",
    ).id;
    const shopping = unwrap(
      await categoriesService.createCategory(db, userC, { groupId: groupC.id, name: "Shopping" }),
      "shopping",
    ).id;
    const groceries = unwrap(
      await categoriesService.createCategory(db, userC, { groupId: groupC.id, name: "Groceries" }),
      "groceries",
    ).id;

    // spend_change fixture: delivery 300 in June → 710 in July (+137%).
    for (const [monthOffset, amounts] of [
      [-2, [10000, 10000, 10000]],
      [-1, [24000, 23000, 24000]],
    ] as const) {
      const [y, m] = TODAY.split("-").map(Number);
      const index = y * 12 + (m - 1) + monthOffset;
      const month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
      for (const [i, amount] of amounts.entries()) {
        unwrap(
          await transactionsService.create(db, userC, {
            accountId: accountC.id,
            type: "expense",
            amountMinor: -amount,
            txnDate: `${month}-${String(5 + i * 7).padStart(2, "0")}`,
            description: `GRABFOOD ORDER ${i}`,
            merchantName: "GrabFood",
            categoryId: delivery,
          }),
          "delivery txn",
        );
      }
    }
    // anomaly fixture: Shopping stable Feb–May at 300, then Jun AND Jul at 900
    // (flat MoM → not a spend_change; way above the 6-month baseline → anomaly).
    for (const monthOffset of [-7, -6, -5, -4, -3]) {
      const [y, m] = TODAY.split("-").map(Number);
      const index = y * 12 + (m - 1) + monthOffset;
      unwrap(
        await transactionsService.create(db, userC, {
          accountId: accountC.id,
          type: "expense",
          amountMinor: -30000,
          txnDate: `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-10`,
          description: "SHOP HAUL",
          categoryId: shopping,
        }),
        "shopping baseline",
      );
    }
    for (const monthOffset of [-2, -1]) {
      const [y, m] = TODAY.split("-").map(Number);
      const index = y * 12 + (m - 1) + monthOffset;
      unwrap(
        await transactionsService.create(db, userC, {
          accountId: accountC.id,
          type: "expense",
          amountMinor: -90000,
          txnDate: `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-10`,
          description: "SHOP HAUL",
          categoryId: shopping,
        }),
        "shopping spike",
      );
    }
    // budget_suggestion fixture: Groceries ~600/cycle, planned 200.
    for (const monthOffset of [-3, -2, -1]) {
      const [y, m] = TODAY.split("-").map(Number);
      const index = y * 12 + (m - 1) + monthOffset;
      unwrap(
        await transactionsService.create(db, userC, {
          accountId: accountC.id,
          type: "expense",
          amountMinor: -(60000 + monthOffset * 1000),
          txnDate: `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-08`,
          description: "GROCERY RUN",
          categoryId: groceries,
        }),
        "grocery cycle",
      );
    }
    const budget = unwrap(
      await budgetsService.create(db, userC, {
        name: "C budget",
        mode: "flexible",
        cycleType: "calendar_month",
      }),
      "budget C",
    );
    const report = unwrap(
      await budgetsService.periodReport(db, userC, { budgetId: budget.id, today: TODAY }),
      "report C",
    );
    unwrap(
      await budgetsService.setAllocation(db, userC, {
        periodId: report.period.id,
        categoryId: groceries,
        plannedMinor: 20000,
      }),
      "alloc groceries",
    );
  });

  test("producers create spend_change (with evidence), anomaly, and budget_suggestion", async () => {
    const summary = unwrap(await intelService.generateInsights(db, userC, TODAY), "generate");
    expect(summary.created).toBeGreaterThanOrEqual(3);
    const list = await intelService.listInsights(db, userC);

    const spendChange = list.find((i) => i.type === "spend_change");
    expect(spendChange).toBeTruthy();
    expect(spendChange?.title).toMatch(/Food delivery spending increased/);
    expect(spendChange?.body).toMatch(/grabfood contributed/i);
    const comparison = spendChange?.comparison as { deltaMinor: number; pctBp: number };
    expect(comparison.deltaMinor).toBe(41000);
    const evidence = await intelService.getEvidence(db, userC, spendChange!.id);
    expect(evidence.map((e) => e.evidenceType)).toEqual([
      "category_delta",
      "merchant_delta",
      "calculation",
    ]);

    const anomalies = list.filter((i) => i.type === "anomaly");
    expect(anomalies.some((i) => /Shopping was unusually high/.test(i.title))).toBe(true);

    const suggestion = list.find((i) => i.type === "budget_suggestion");
    expect(suggestion?.title).toMatch(/Raise Groceries/);
    const suggestionComparison = suggestion?.comparison as { suggestedMinor: number };
    // Median of 57,000 / 58,000 / 59,000 = 58,000 → rounded to RM 10.
    expect(suggestionComparison.suggestedMinor).toBe(58000);
  });

  test("regeneration is idempotent (dedup keys hold)", async () => {
    const again = unwrap(await intelService.generateInsights(db, userC, TODAY), "regenerate");
    expect(again.created).toBe(0);
  });

  test("dismissed insights stay dismissed through regeneration", async () => {
    const list = await intelService.listInsights(db, userC);
    const target = list.find((i) => i.type === "anomaly")!;
    unwrap(await intelService.setInsightStatus(db, userC, target.id, "dismissed"), "dismiss");
    unwrap(await intelService.generateInsights(db, userC, TODAY), "regenerate");
    const after = await intelService.listInsights(db, userC);
    expect(after.find((i) => i.id === target.id)).toBeUndefined(); // filtered out
    const all = await intelService.listInsights(db, userC, { includeDismissed: true });
    expect(all.find((i) => i.id === target.id)?.status).toBe("dismissed");
  });

  test("isolation: user B sees nothing and cannot touch user C's insights", async () => {
    expect(await intelService.listInsights(db, userB)).toEqual([]);
    const insight = (await intelService.listInsights(db, userC))[0];
    expect(isErr(await intelService.setInsightStatus(db, userB, insight.id, "dismissed"))).toBe(
      true,
    );
    expect(await intelService.getEvidence(db, userB, insight.id)).toEqual([]);
    // User B's own STS works on an empty ledger without inventing numbers.
    const sts = unwrap(await intelService.safeToSpend(db, userB, TODAY), "b sts");
    expect(sts.result.breakdown.liquidMinor).toBe(0);
    expect(sts.incomeItems).toEqual([]);
  });
});
