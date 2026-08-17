import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { formatMinor } from "@/lib/money";
import { isErr, isOk, type Result } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { accountsService, type AccountRow } from "@/server/services/accounts";
import { budgetsService } from "@/server/services/budgets";
import { categoriesService } from "@/server/services/categories";
import { intelService } from "@/server/services/intel";
import { journalService } from "@/server/services/journal";
import { transactionsService } from "@/server/services/transactions";

import { createTestDatabase, type TestDatabase } from "./harness";

/**
 * Decision Journal tests including THE Phase 9 acceptance (spec V2, Journey
 * 7): journal exclusions change anomaly, budget-suggestion, and forecast
 * baselines correctly — proven by two users with byte-identical ledgers where
 * only one annotated the one-off period.
 */

let testDb: TestDatabase;
let db: Db;
let userJ: string; // annotates the one-off periods
let userN: string; // identical ledger, no journal
const TODAY = "2026-08-17";

function unwrap<T>(result: Result<T>, label: string): T {
  if (!isOk(result)) throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  return result.data;
}

interface SeededUser {
  id: string;
  account: AccountRow;
  diningCat: string;
  petrolCat: string;
}

async function seedUser(email: string): Promise<SeededUser> {
  const id = uuidv7();
  await testDb.pool.query(`insert into users (id, email, password_hash) values ($1, $2, 'x')`, [
    id,
    email,
  ]);
  await testDb.pool.query(
    `insert into user_preferences (user_id, safety_buffer_minor) values ($1, 30000)`,
    [id],
  );
  const account = unwrap(
    await accountsService.create(db, id, {
      name: "Journal main",
      type: "current",
      openingBalanceMinor: 2000000,
      openingBalanceDate: "2026-01-01",
    }),
    "account",
  );
  const group = unwrap(
    await categoriesService.createGroup(db, id, { name: "Journal Living", kind: "expense" }),
    "group",
  );
  const diningCat = unwrap(
    await categoriesService.createCategory(db, id, { groupId: group.id, name: "Dining" }),
    "dining",
  ).id;
  const petrolCat = unwrap(
    await categoriesService.createCategory(db, id, { groupId: group.id, name: "Petrol" }),
    "petrol",
  ).id;

  const spend = async (categoryId: string, txnDate: string, amountMinor: number) => {
    unwrap(
      await transactionsService.create(db, id, {
        accountId: account.id,
        type: "expense",
        amountMinor: -amountMinor,
        txnDate,
        description: `SPEND ${txnDate}`,
        categoryId,
      }),
      `txn ${txnDate}`,
    );
  };

  // Dining: RM 400 normal each of May/Jun/Jul + RM 1,600 one-offs in Jun and
  // Jul (the "wedding season" that would distort the 3-cycle median).
  await spend(diningCat, "2026-05-10", 40000);
  await spend(diningCat, "2026-06-02", 40000);
  await spend(diningCat, "2026-07-25", 40000);
  await spend(diningCat, "2026-06-15", 160000);
  await spend(diningCat, "2026-07-08", 160000);

  // Petrol: RM 400 monthly Jan–May + a RM 1,500 one-off roadtrip in March.
  // June AND July are RM 1,000 (equal, so spend_change stays quiet and the
  // anomaly producer judges July against the 6-month baseline).
  for (const month of ["01", "02", "03", "04", "05"]) {
    await spend(petrolCat, `2026-${month}-20`, 40000);
  }
  await spend(petrolCat, "2026-03-11", 150000);
  await spend(petrolCat, "2026-06-03", 100000);
  await spend(petrolCat, "2026-07-14", 100000);

  // Steady uncategorized weekly spending across the trailing 12 weeks so the
  // forecast's robust weekly median is nonzero (and exclusion-sensitive).
  for (const week of [
    "2026-05-26",
    "2026-06-02",
    "2026-06-09",
    "2026-06-16",
    "2026-06-23",
    "2026-06-30",
    "2026-07-07",
    "2026-07-14",
    "2026-07-21",
    "2026-07-28",
    "2026-08-04",
    "2026-08-11",
  ]) {
    unwrap(
      await transactionsService.create(db, id, {
        accountId: account.id,
        type: "expense",
        amountMinor: -30000,
        txnDate: week,
        description: `GROCERIES ${week}`,
      }),
      `weekly ${week}`,
    );
  }

  const budget = unwrap(
    await budgetsService.create(db, id, {
      name: "Journal budget",
      mode: "flexible",
      cycleType: "calendar_month",
    }),
    "budget",
  );
  const report = unwrap(
    await budgetsService.periodReport(db, id, { budgetId: budget.id, today: TODAY }),
    "period",
  );
  unwrap(
    await budgetsService.setAllocation(db, id, {
      periodId: report.period.id,
      categoryId: diningCat,
      plannedMinor: 10000,
    }),
    "allocation",
  );
  return { id, account, diningCat, petrolCat };
}

let seededJ: SeededUser;
let seededN: SeededUser;

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  seededJ = await seedUser("journal-j@example.com");
  seededN = await seedUser("journal-n@example.com");
  userJ = seededJ.id;
  userN = seededN.id;

  // Only user J annotates: wedding season (spans both Dining one-offs, not
  // the normal spends) and the March roadtrip (partial month).
  unwrap(
    await journalService.create(db, userJ, {
      kind: "life_event",
      title: "Wedding season",
      startsOn: "2026-06-05",
      endsOn: "2026-07-20",
      excludeFromBaselines: true,
    }),
    "wedding entry",
  );
  unwrap(
    await journalService.create(db, userJ, {
      kind: "life_event",
      title: "Roadtrip",
      startsOn: "2026-03-10",
      endsOn: "2026-03-12",
      excludeFromBaselines: true,
    }),
    "roadtrip entry",
  );
});

afterAll(async () => {
  await testDb.drop();
});

async function insightRows(
  userId: string,
  type: string,
): Promise<Array<{ title: string; body: string; data_quality: unknown }>> {
  const { rows } = await testDb.pool.query<{ title: string; body: string; data_quality: unknown }>(
    `select title, body, data_quality from insights where user_id = $1 and type = $2`,
    [userId, type],
  );
  return rows;
}

describe("V2: journal exclusions change baselines correctly", () => {
  test("generation runs for both users", async () => {
    unwrap(await intelService.generateInsights(db, userN, TODAY), "generate N");
    unwrap(await intelService.generateInsights(db, userJ, TODAY), "generate J");
  });

  test("budget suggestion WITHOUT the journal is distorted by the one-off months", async () => {
    const rows = await insightRows(userN, "budget_suggestion");
    const dining = rows.find((r) => r.title.includes("Dining"));
    // Median of [2,000, 2,000, 400] = RM 2,000 — the wedding months dominate.
    expect(dining?.title).toBe(`Raise Dining to ${formatMinor(200000, "MYR")}`);
    expect(dining?.body).not.toContain("excluded from your baseline");
  });

  test("budget suggestion WITH the journal uses the clean median and explains itself", async () => {
    const rows = await insightRows(userJ, "budget_suggestion");
    const dining = rows.find((r) => r.title.includes("Dining"));
    // Median of [400, 400, 400] once the annotated spending leaves.
    expect(dining?.title).toBe(`Raise Dining to ${formatMinor(40000, "MYR")}`);
    expect(dining?.body).toContain(
      `Wedding season (${formatMinor(320000, "MYR")}, marked one-time) was excluded from your baseline`,
    );
    expect((dining?.data_quality as { journalExcluded?: string }).journalExcluded).toContain(
      "Wedding season",
    );
  });

  test("anomaly baseline drops the annotated roadtrip and says so", async () => {
    const rows = await insightRows(userJ, "anomaly");
    const petrol = rows.find((r) => r.title.includes("Petrol"));
    expect(petrol?.title).toBe("Petrol was unusually high last month");
    expect(petrol?.body).toContain(
      `Roadtrip (${formatMinor(150000, "MYR")}, marked one-time) was excluded from your baseline`,
    );
    // Evidence baseline (Jun..Jan order) with the roadtrip cleanly removed.
    const { rows: evidence } = await testDb.pool.query<{ payload: { baseline: number[] } }>(
      `select e.payload from insight_evidence e
       join insights i on i.id = e.insight_id
       where i.user_id = $1 and i.type = 'anomaly' and i.title like 'Petrol%'`,
      [userJ],
    );
    expect(evidence[0].payload.baseline).toEqual([100000, 40000, 40000, 40000, 40000, 40000]);
  });

  test("control: the same anomaly without the journal keeps the distorted March", async () => {
    const rows = await insightRows(userN, "anomaly");
    const petrol = rows.find((r) => r.title.includes("Petrol"));
    expect(petrol?.body).not.toContain("excluded from your baseline");
    const { rows: evidence } = await testDb.pool.query<{ payload: { baseline: number[] } }>(
      `select e.payload from insight_evidence e
       join insights i on i.id = e.insight_id
       where i.user_id = $1 and i.type = 'anomaly' and i.title like 'Petrol%'`,
      [userN],
    );
    expect(evidence[0].payload.baseline).toEqual([100000, 40000, 40000, 190000, 40000, 40000]);
  });

  test("forecast baseline excludes annotated spending (J projects higher than N)", async () => {
    const j = unwrap(
      await intelService.cashFlowForecast(db, userJ, { horizonDays: 90, today: TODAY }),
      "forecast J",
    );
    const n = unwrap(
      await intelService.cashFlowForecast(db, userN, { horizonDays: 90, today: TODAY }),
      "forecast N",
    );
    const lastJ = j.series[j.series.length - 1].expectedMinor;
    const lastN = n.series[n.series.length - 1].expectedMinor;
    expect(lastJ).toBeGreaterThan(lastN);
  });

  test("annotating invalidates the forecast cache and changes the series", async () => {
    const first = unwrap(
      await intelService.cashFlowForecast(db, userN, { horizonDays: 60, today: TODAY }),
      "first",
    );
    expect(first.cached).toBe(false);
    const second = unwrap(
      await intelService.cashFlowForecast(db, userN, { horizonDays: 60, today: TODAY }),
      "second",
    );
    expect(second.cached).toBe(true);
    unwrap(
      await journalService.create(db, userN, {
        kind: "life_event",
        title: "Wedding season",
        startsOn: "2026-06-05",
        endsOn: "2026-07-20",
        excludeFromBaselines: true,
      }),
      "late entry",
    );
    const third = unwrap(
      await intelService.cashFlowForecast(db, userN, { horizonDays: 60, today: TODAY }),
      "third",
    );
    expect(third.cached).toBe(false);
    expect(third.series[third.series.length - 1].expectedMinor).toBeGreaterThan(
      second.series[second.series.length - 1].expectedMinor,
    );
  });
});

describe("journal entries", () => {
  let entryId: string;

  test("create validates dates; list computes the review-due flag", async () => {
    const bad = await journalService.create(db, userJ, {
      kind: "decision",
      title: "Backwards",
      startsOn: "2026-08-10",
      endsOn: "2026-08-01",
      excludeFromBaselines: false,
    });
    expect(isErr(bad)).toBe(true);

    entryId = unwrap(
      await journalService.create(db, userJ, {
        kind: "decision",
        title: "Cancel gym",
        body: "Switching to running.",
        startsOn: "2026-07-01",
        excludeFromBaselines: false,
        expectedSavingMinor: 9000,
        reviewOn: "2026-08-10",
      }),
      "decision entry",
    ).id;
    const list = await journalService.list(db, userJ, TODAY);
    const entry = list.find((e) => e.id === entryId);
    expect(entry?.reviewDue).toBe(true);
    expect(entry?.expectedOutcome).toEqual({ saveMinorPerMonth: 9000 });
  });

  test("outcome review records the verdict and clears the due flag", async () => {
    unwrap(
      await journalService.recordOutcome(db, userJ, entryId, {
        verdict: "partly",
        note: "Saved about half of it.",
      }),
      "outcome",
    );
    const list = await journalService.list(db, userJ, TODAY);
    const entry = list.find((e) => e.id === entryId);
    expect(entry?.reviewDue).toBe(false);
    expect((entry?.outcomeReview as { verdict: string }).verdict).toBe("partly");
  });

  test("transaction links are ownership-checked and idempotent", async () => {
    const foreignTxn = await journalService.linkTransaction(db, userJ, entryId, uuidv7());
    expect(isErr(foreignTxn)).toBe(true);
    const txn = unwrap(
      await transactionsService.create(db, userJ, {
        accountId: seededJ.account.id,
        type: "expense",
        amountMinor: -9900,
        txnDate: "2026-08-01",
        description: "GYM FINAL BILL",
      }),
      "gym txn",
    );
    unwrap(await journalService.linkTransaction(db, userJ, entryId, txn.transaction.id), "link");
    unwrap(await journalService.linkTransaction(db, userJ, entryId, txn.transaction.id), "relink");
    const list = await journalService.list(db, userJ, TODAY);
    const entry = list.find((e) => e.id === entryId);
    expect(entry?.links.filter((l) => l.entityType === "transaction")).toHaveLength(1);
  });

  test("exclusion windows expose only live excluding entries", async () => {
    const windows = await journalService.exclusionWindows(db, userJ);
    expect(windows.map((w) => w.title).sort()).toEqual(["Roadtrip", "Wedding season"]);
    expect(windows.find((w) => w.title === "Roadtrip")).toMatchObject({
      start: "2026-03-10",
      end: "2026-03-12",
    });
    // The non-excluding decision entry never appears.
    expect(windows.some((w) => w.title === "Cancel gym")).toBe(false);
  });

  test("soft delete removes the entry and its exclusion effect", async () => {
    const roadtrip = (await journalService.list(db, userJ, TODAY)).find(
      (e) => e.title === "Roadtrip",
    )!;
    unwrap(await journalService.softDelete(db, userJ, roadtrip.id), "delete");
    const windows = await journalService.exclusionWindows(db, userJ);
    expect(windows.some((w) => w.title === "Roadtrip")).toBe(false);
  });

  test("isolation: another user cannot read or mutate", async () => {
    const list = await journalService.list(db, userN, TODAY);
    expect(list.some((e) => e.title === "Cancel gym")).toBe(false);
    expect(
      isErr(
        await journalService.update(db, userN, entryId, {
          kind: "note",
          title: "Hijack",
          startsOn: "2026-01-01",
          excludeFromBaselines: false,
        }),
      ),
    ).toBe(true);
    expect(isErr(await journalService.recordOutcome(db, userN, entryId, { verdict: "no" }))).toBe(
      true,
    );
  });
});
