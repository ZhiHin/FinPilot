import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { formatMinor } from "@/lib/money";
import { isErr, isOk, type Result } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { accountsService, type AccountRow } from "@/server/services/accounts";
import { budgetsService } from "@/server/services/budgets";
import { categoriesService } from "@/server/services/categories";
import { goalsService } from "@/server/services/goals";
import { scenariosService } from "@/server/services/scenarios";

import { createTestDatabase, type TestDatabase } from "./harness";

/**
 * Scenario Lab service tests, including THE binding invariant (spec V1):
 * simulation and the full scenario lifecycle leave every real table
 * byte-identical.
 */

let testDb: TestDatabase;
let db: Db;
let userA: string;
let userB: string;
let accountA: AccountRow;
let foodCat: string;
let goalId: string;
let scenarioId: string;

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
  await testDb.pool.query(
    `insert into user_preferences (user_id, safety_buffer_minor) values ($1, 30000)`,
    [id],
  );
  return id;
}

async function insertPattern(
  userId: string,
  input: {
    name: string;
    direction: "inflow" | "outflow";
    amountMinor: number;
    nextExpectedOn: string;
  },
): Promise<string> {
  const id = uuidv7();
  await testDb.pool.query(
    `insert into recurring_patterns
       (id, user_id, name, direction, frequency, typical_amount_minor, amount_tolerance_minor,
        next_expected_on, confidence_bp, source, status)
     values ($1, $2, $3, $4, 'monthly', $5, 0, $6, 10000, 'user_confirmed', 'active')`,
    [id, userId, input.name, input.direction, input.amountMinor, input.nextExpectedOn],
  );
  return id;
}

/** Stable checksum of a whole table's rows for one user (V1 invariant). */
async function tableChecksum(table: string, userId: string): Promise<string> {
  const { rows } = await testDb.pool.query<{ sum: string }>(
    `select coalesce(md5(string_agg(t.*::text, '|' order by t.id)), 'empty') as sum
     from ${table} t where t.user_id = $1`,
    [userId],
  );
  return rows[0].sum;
}

const REAL_TABLES = [
  "transactions",
  "accounts",
  "budgets",
  "budget_periods",
  "budget_allocations",
  "savings_goals",
  "goal_contributions",
  "recurring_patterns",
  "categories",
];

async function realStateChecksums(userId: string): Promise<Record<string, string>> {
  const sums: Record<string, string> = {};
  for (const table of REAL_TABLES) {
    // budget_periods/allocations key off budgets, not user_id directly.
    if (table === "budget_periods" || table === "budget_allocations") {
      const { rows } = await testDb.pool.query<{ sum: string }>(
        table === "budget_periods"
          ? `select coalesce(md5(string_agg(p.*::text, '|' order by p.id)), 'empty') as sum
             from budget_periods p join budgets b on b.id = p.budget_id where b.user_id = $1`
          : `select coalesce(md5(string_agg(a.*::text, '|' order by a.id)), 'empty') as sum
             from budget_allocations a
             join budget_periods p on p.id = a.budget_period_id
             join budgets b on b.id = p.budget_id where b.user_id = $1`,
        [userId],
      );
      sums[table] = rows[0].sum;
    } else {
      sums[table] = await tableChecksum(table, userId);
    }
  }
  // The derived-forecast cache must stay untouched by simulation too.
  sums.forecasts = await tableChecksum("forecasts", userId);
  return sums;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  userA = await seedUser("scn-a@example.com");
  userB = await seedUser("scn-b@example.com");

  accountA = unwrap(
    await accountsService.create(db, userA, {
      name: "Scenario main",
      type: "current",
      openingBalanceMinor: 300000,
      openingBalanceDate: "2026-01-01",
    }),
    "account",
  );
  void accountA;
  const group = unwrap(
    await categoriesService.createGroup(db, userA, { name: "Scenario Living", kind: "expense" }),
    "group",
  );
  foodCat = unwrap(
    await categoriesService.createCategory(db, userA, { groupId: group.id, name: "Food" }),
    "food",
  ).id;

  await insertPattern(userA, {
    name: "Salary",
    direction: "inflow",
    amountMinor: 520000,
    nextExpectedOn: "2026-08-25",
  });
  await insertPattern(userA, {
    name: "Rent",
    direction: "outflow",
    amountMinor: 160000,
    nextExpectedOn: "2026-08-20",
  });

  const budget = unwrap(
    await budgetsService.create(db, userA, {
      name: "Scenario budget",
      mode: "flexible",
      cycleType: "calendar_month",
    }),
    "budget",
  );
  const report = unwrap(
    await budgetsService.periodReport(db, userA, { budgetId: budget.id, today: TODAY }),
    "period",
  );
  unwrap(
    await budgetsService.setAllocation(db, userA, {
      periodId: report.period.id,
      categoryId: foodCat,
      plannedMinor: 50000,
    }),
    "allocation",
  );
  goalId = unwrap(
    await goalsService.create(db, userA, {
      name: "House deposit",
      type: "purchase",
      targetAmountMinor: 1200000,
      targetDate: "2027-08-31",
      contributionSchedule: { amountMinor: 100000, frequency: "monthly" },
    }),
    "goal",
  ).id;
});

afterAll(async () => {
  await testDb.drop();
});

describe("scenario lifecycle and simulation", () => {
  let before: Record<string, string>;

  test("V1 setup: checksum every real table before any scenario work", async () => {
    before = await realStateChecksums(userA);
    expect(Object.keys(before)).toContain("transactions");
  });

  test("a draft with no events simulates to exactly the baseline", async () => {
    scenarioId = unwrap(await scenariosService.createDraft(db, userA), "draft").id;
    const view = unwrap(
      await scenariosService.simulate(db, userA, scenarioId, { today: TODAY }),
      "simulate empty",
    );
    expect(view.scenario.series).toEqual(view.baseline.series);
    expect(view.endDeltaMinor).toBe(0);
    // Hand-computed: 300000 + 3 salaries - 3 rents, all confirmed, no baseline burn.
    const last = view.scenario.series[view.scenario.series.length - 1];
    expect(last.expectedMinor).toBe(1380000);
    expect(last.conservativeMinor).toBe(1380000);
    expect(last.optimisticMinor).toBe(1380000);
  });

  test("event validation: refs must exist and belong to the caller", async () => {
    const badPattern = await scenariosService.addEvent(db, userA, scenarioId, {
      eventType: "cancel_recurring",
      effectiveOn: "2026-09-01",
      patternId: uuidv7(),
    });
    expect(isErr(badPattern)).toBe(true);
    const badCategory = await scenariosService.addEvent(db, userA, scenarioId, {
      eventType: "one_time_expense",
      effectiveOn: "2026-09-15",
      amountMinor: 1000,
      categoryId: uuidv7(),
    });
    expect(isErr(badCategory)).toBe(true);
    const badAmount = await scenariosService.addEvent(db, userA, scenarioId, {
      eventType: "one_time_expense",
      effectiveOn: "2026-09-15",
      amountMinor: -5,
      categoryId: null,
    });
    expect(isErr(badAmount)).toBe(true);
  });

  test("a one-time purchase: exact delta, lowest point, and safer date", async () => {
    unwrap(
      await scenariosService.addEvent(db, userA, scenarioId, {
        eventType: "one_time_expense",
        effectiveOn: "2026-09-15",
        amountMinor: 280000,
        categoryId: foodCat,
      }),
      "purchase event",
    );
    const view = unwrap(
      await scenariosService.simulate(db, userA, scenarioId, { today: TODAY }),
      "simulate purchase",
    );
    expect(view.endDeltaMinor).toBe(-280000);
    expect(view.largestPurchaseMinor).toBe(280000);
    // Pre-payday dip is 140000; after the Aug 25 salary the remaining path
    // never drops under 500000, so 500000 - 280000 >= 30000 buffer → Aug 25.
    expect(view.saferDate).toBe("2026-08-25");
    expect(view.scenario.lowestExpected.balanceMinor).toBe(
      view.baseline.lowestExpected.balanceMinor,
    );
    // September purchase is outside the August budget cycle: no budget risk.
    expect(view.budgetRisks).toEqual([]);
  });

  test("current-cycle purchase against the allocation reports exact budget risk", async () => {
    const eventId = unwrap(
      await scenariosService.addEvent(db, userA, scenarioId, {
        eventType: "one_time_expense",
        effectiveOn: "2026-08-25",
        amountMinor: 60000,
        categoryId: foodCat,
      }),
      "cycle purchase",
    ).id;
    const view = unwrap(
      await scenariosService.simulate(db, userA, scenarioId, { today: TODAY }),
      "simulate cycle purchase",
    );
    expect(view.budgetRisks).toEqual([
      {
        categoryName: "Food",
        note: `Would exceed this cycle's Food allocation by ${formatMinor(10000, "MYR")}.`,
      },
    ]);
    unwrap(await scenariosService.removeEvent(db, userA, scenarioId, eventId), "remove");
  });

  test("savings_change shifts the goal's estimated completion deterministically", async () => {
    const eventId = unwrap(
      await scenariosService.addEvent(db, userA, scenarioId, {
        eventType: "savings_change",
        effectiveOn: "2026-09-01",
        amountMinor: -20000,
        goalId,
      }),
      "savings event",
    ).id;
    const view = unwrap(
      await scenariosService.simulate(db, userA, scenarioId, { today: TODAY }),
      "simulate savings",
    );
    // Rate 1000/mo → 12 months (2027-08); at 800/mo → 15 months (2027-11).
    expect(view.affectedGoals).toEqual([
      {
        goalId,
        name: "House deposit",
        note: "Estimated completion moves 2027-08 to 2027-11.",
      },
    ]);
    unwrap(await scenariosService.removeEvent(db, userA, scenarioId, eventId), "remove savings");
  });

  test("saving is explicit; duplicate saved names are refused", async () => {
    unwrap(await scenariosService.save(db, userA, scenarioId, { name: "Laptop — Sept" }), "save");
    const list = await scenariosService.list(db, userA);
    expect(list.find((s) => s.id === scenarioId)?.status).toBe("saved");

    const second = unwrap(await scenariosService.createDraft(db, userA), "second draft").id;
    const dup = await scenariosService.save(db, userA, second, { name: "laptop — sept" });
    expect(isErr(dup)).toBe(true);
    unwrap(await scenariosService.save(db, userA, second, { name: "Laptop — Nov" }), "save 2");
    unwrap(
      await scenariosService.addEvent(db, userA, second, {
        eventType: "one_time_expense",
        effectiveOn: "2026-11-10",
        amountMinor: 280000,
        categoryId: null,
      }),
      "second event",
    );
  });

  test("compare returns both saved scenarios over one shared baseline", async () => {
    const list = await scenariosService.list(db, userA);
    const a = list.find((s) => s.name === "Laptop — Sept")!.id;
    const b = list.find((s) => s.name === "Laptop — Nov")!.id;
    const compared = unwrap(
      await scenariosService.compare(db, userA, a, b, { today: TODAY }),
      "compare",
    );
    expect(compared.a.view.baseline.series).toEqual(compared.b.view.baseline.series);
    expect(compared.a.view.endDeltaMinor).toBe(-280000);
    expect(compared.b.view.endDeltaMinor).toBe(-280000);
    const same = await scenariosService.compare(db, userA, a, a, { today: TODAY });
    expect(isErr(same)).toBe(true);
  });

  test("V1 INVARIANT: the full lifecycle changed no real table and no forecast cache", async () => {
    const after = await realStateChecksums(userA);
    expect(after).toEqual(before);
  });

  test("archive blocks new events; soft delete hides the scenario", async () => {
    unwrap(await scenariosService.archive(db, userA, scenarioId), "archive");
    const blocked = await scenariosService.addEvent(db, userA, scenarioId, {
      eventType: "one_time_expense",
      effectiveOn: "2026-09-20",
      amountMinor: 1000,
      categoryId: null,
    });
    expect(isErr(blocked)).toBe(true);
    unwrap(await scenariosService.softDelete(db, userA, scenarioId), "delete");
    const list = await scenariosService.list(db, userA);
    expect(list.some((s) => s.id === scenarioId)).toBe(false);
  });

  test("isolation: another user cannot see, simulate, or mutate", async () => {
    const list = await scenariosService.list(db, userB);
    expect(list).toEqual([]);
    const mine = await scenariosService.list(db, userA);
    const target = mine[0]?.id;
    if (target) {
      expect(isErr(await scenariosService.get(db, userB, target))).toBe(true);
      expect(isErr(await scenariosService.simulate(db, userB, target, { today: TODAY }))).toBe(
        true,
      );
      expect(isErr(await scenariosService.save(db, userB, target, { name: "Steal" }))).toBe(true);
    }
  });
});
