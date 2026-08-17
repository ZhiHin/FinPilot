import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "./harness";

/** Phase 5 planning schema: budgets/periods/allocations, goals/contributions. */

let db: TestDatabase;

const USER_A = "018f0000-0000-7000-8000-0000000000e1";
const USER_B = "018f0000-0000-7000-8000-0000000000e2";
const GROUP = "018f0000-0000-7000-8000-00000000ce01";
const CAT_A = "018f0000-0000-7000-8000-00000000ce02";
const CAT_B = "018f0000-0000-7000-8000-00000000ce03";
const BUDGET = "018f0000-0000-7000-8000-00000000cf01";
const PERIOD = "018f0000-0000-7000-8000-00000000d001";
const GOAL = "018f0000-0000-7000-8000-00000000d101";
const ACC_A = "018f0000-0000-7000-8000-00000000d201";
const ACC_SGD = "018f0000-0000-7000-8000-00000000d202";

beforeAll(async () => {
  db = await createTestDatabase();
  for (const [id, email] of [
    [USER_A, "plan-a@example.com"],
    [USER_B, "plan-b@example.com"],
  ]) {
    await db.pool.query(`insert into users (id, email, password_hash) values ($1, $2, 'x')`, [
      id,
      email,
    ]);
  }
  await db.pool.query(
    `insert into category_groups (id, user_id, name, kind) values ($1, $2, 'Living', 'expense')`,
    [GROUP, USER_A],
  );
  await db.pool.query(
    `insert into categories (id, user_id, group_id, name) values ($1, $2, $3, 'Food'), ($4, $2, $3, 'Transport')`,
    [CAT_A, USER_A, GROUP, CAT_B],
  );
  await db.pool.query(
    `insert into accounts (id, user_id, name, type, currency, opening_balance_minor, opening_balance_date, is_liquid)
     values ($1, $2, 'Plan main', 'current', 'MYR', 0, '2026-01-01', true),
            ($3, $2, 'Plan SGD', 'current', 'SGD', 0, '2026-01-01', true)`,
    [ACC_A, USER_A, ACC_SGD],
  );
  await db.pool.query(
    `insert into budgets (id, user_id, name, mode, cycle_type, currency)
     values ($1, $2, 'Main budget', 'flexible', 'calendar_month', 'MYR')`,
    [BUDGET, USER_A],
  );
  await db.pool.query(
    `insert into budget_periods (id, budget_id, user_id, period_start, period_end)
     values ($1, $2, $3, '2026-08-01', '2026-08-31')`,
    [PERIOD, BUDGET, USER_A],
  );
  await db.pool.query(
    `insert into savings_goals (id, user_id, name, type, target_amount_minor, currency)
     values ($1, $2, 'Emergency fund', 'emergency', 1000000, 'MYR')`,
    [GOAL, USER_A],
  );
});

afterAll(async () => {
  await db.drop();
});

describe("budget constraints", () => {
  test("payday budgets must carry a cycle anchor", async () => {
    await expect(
      db.pool.query(
        `insert into budgets (id, user_id, name, mode, cycle_type, currency)
         values ('018f0000-0000-7000-8000-00000000cf02', $1, 'Payday no anchor', 'fixed', 'payday', 'MYR')`,
        [USER_A],
      ),
    ).rejects.toThrow(/budgets_payday_anchor_required/i);
  });

  test("periods for one budget can never overlap (exclusion constraint)", async () => {
    await expect(
      db.pool.query(
        `insert into budget_periods (id, budget_id, user_id, period_start, period_end)
         values ('018f0000-0000-7000-8000-00000000d002', $1, $2, '2026-08-15', '2026-09-14')`,
        [BUDGET, USER_A],
      ),
    ).rejects.toThrow(/budget_periods_no_overlap|conflicting key/i);
  });

  test("period date ranges must be valid", async () => {
    await expect(
      db.pool.query(
        `insert into budget_periods (id, budget_id, user_id, period_start, period_end)
         values ('018f0000-0000-7000-8000-00000000d003', $1, $2, '2026-10-31', '2026-10-01')`,
        [BUDGET, USER_A],
      ),
    ).rejects.toThrow(/budget_periods_valid_range/i);
  });

  test("a period's user must own its budget (trigger)", async () => {
    await expect(
      db.pool.query(
        `insert into budget_periods (id, budget_id, user_id, period_start, period_end)
         values ('018f0000-0000-7000-8000-00000000d004', $1, $2, '2026-11-01', '2026-11-30')`,
        [BUDGET, USER_B],
      ),
    ).rejects.toThrow(/does not own the budget/i);
  });

  test("one allocation per category per period; planned must be non-negative", async () => {
    await db.pool.query(
      `insert into budget_allocations (id, budget_period_id, user_id, category_id, planned_minor)
       values ('018f0000-0000-7000-8000-00000000d301', $1, $2, $3, 60000)`,
      [PERIOD, USER_A, CAT_A],
    );
    await expect(
      db.pool.query(
        `insert into budget_allocations (id, budget_period_id, user_id, category_id, planned_minor)
         values ('018f0000-0000-7000-8000-00000000d302', $1, $2, $3, 10000)`,
        [PERIOD, USER_A, CAT_A],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      db.pool.query(
        `insert into budget_allocations (id, budget_period_id, user_id, category_id, planned_minor)
         values ('018f0000-0000-7000-8000-00000000d303', $1, $2, $3, -100)`,
        [PERIOD, USER_A, CAT_B],
      ),
    ).rejects.toThrow(/planned_non_negative/i);
  });

  test("allocations cannot use another user's category (trigger)", async () => {
    await db.pool.query(
      `insert into category_groups (id, user_id, name, kind)
       values ('018f0000-0000-7000-8000-00000000ce11', $1, 'B group', 'expense')`,
      [USER_B],
    );
    await db.pool.query(
      `insert into categories (id, user_id, group_id, name)
       values ('018f0000-0000-7000-8000-00000000ce12', $1, '018f0000-0000-7000-8000-00000000ce11', 'B cat')`,
      [USER_B],
    );
    await expect(
      db.pool.query(
        `insert into budget_allocations (id, budget_period_id, user_id, category_id, planned_minor)
         values ('018f0000-0000-7000-8000-00000000d304', $1, $2, '018f0000-0000-7000-8000-00000000ce12', 5000)`,
        [PERIOD, USER_A],
      ),
    ).rejects.toThrow(/belongs to another user/i);
  });
});

describe("goal constraints", () => {
  test("target amounts must be positive and priority within 1–5", async () => {
    await expect(
      db.pool.query(
        `insert into savings_goals (id, user_id, name, type, target_amount_minor, currency)
         values ('018f0000-0000-7000-8000-00000000d102', $1, 'Zero target', 'custom', 0, 'MYR')`,
        [USER_A],
      ),
    ).rejects.toThrow(/target_positive/i);
    await expect(
      db.pool.query(
        `insert into savings_goals (id, user_id, name, type, target_amount_minor, currency, priority)
         values ('018f0000-0000-7000-8000-00000000d103', $1, 'Bad priority', 'custom', 1000, 'MYR', 9)`,
        [USER_A],
      ),
    ).rejects.toThrow(/priority_range/i);
  });

  test("a goal cannot link another user's account (trigger)", async () => {
    await expect(
      db.pool.query(
        `insert into savings_goals (id, user_id, name, type, target_amount_minor, currency, linked_account_id)
         values ('018f0000-0000-7000-8000-00000000d104', $1, 'Steal account', 'custom', 1000, 'MYR', $2)`,
        [USER_B, ACC_A],
      ),
    ).rejects.toThrow(/belongs to another user/i);
  });

  test("contributions: nonzero amounts; withdrawals cannot take the ledger below zero", async () => {
    await expect(
      db.pool.query(
        `insert into goal_contributions (id, goal_id, user_id, amount_minor, contributed_on)
         values ('018f0000-0000-7000-8000-00000000d401', $1, $2, 0, '2026-08-01')`,
        [GOAL, USER_A],
      ),
    ).rejects.toThrow(/amount_nonzero/i);
    await db.pool.query(
      `insert into goal_contributions (id, goal_id, user_id, amount_minor, contributed_on)
       values ('018f0000-0000-7000-8000-00000000d402', $1, $2, 50000, '2026-08-01')`,
      [GOAL, USER_A],
    );
    await expect(
      db.pool.query(
        `insert into goal_contributions (id, goal_id, user_id, amount_minor, contributed_on, note)
         values ('018f0000-0000-7000-8000-00000000d403', $1, $2, -60000, '2026-08-02', 'overdraw')`,
        [GOAL, USER_A],
      ),
    ).rejects.toThrow(/sum below zero/i);
  });

  test("contributions cannot be added to another user's goal (trigger)", async () => {
    await expect(
      db.pool.query(
        `insert into goal_contributions (id, goal_id, user_id, amount_minor, contributed_on)
         values ('018f0000-0000-7000-8000-00000000d404', $1, $2, 1000, '2026-08-01')`,
        [GOAL, USER_B],
      ),
    ).rejects.toThrow(/does not own the goal/i);
  });

  test("linked-transfer contributions require a same-currency transaction of the same user", async () => {
    await expect(
      db.pool.query(
        `insert into goal_contributions (id, goal_id, user_id, amount_minor, contributed_on, kind)
         values ('018f0000-0000-7000-8000-00000000d405', $1, $2, 1000, '2026-08-01', 'linked_transfer')`,
        [GOAL, USER_A],
      ),
    ).rejects.toThrow(/transfer_requires_txn/i);

    // A real SGD transaction cannot back a MYR goal contribution.
    await db.pool.query(
      `insert into transactions (id, user_id, account_id, type, status, amount_minor, currency, txn_date, description_original)
       values ('018f0000-0000-7000-8000-00000000d501', $1, $2, 'income', 'posted', 5000, 'SGD', '2026-08-01', 'sgd txn')`,
      [USER_A, ACC_SGD],
    );
    await expect(
      db.pool.query(
        `insert into goal_contributions (id, goal_id, user_id, amount_minor, contributed_on, kind, transaction_id)
         values ('018f0000-0000-7000-8000-00000000d406', $1, $2, 5000, '2026-08-01', 'linked_transfer', '018f0000-0000-7000-8000-00000000d501')`,
        [GOAL, USER_A],
      ),
    ).rejects.toThrow(/must match the goal currency/i);
  });
});
