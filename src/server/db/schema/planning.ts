import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { isNull } from "drizzle-orm";

import { users } from "./identity";
import { accounts, categories, transactions } from "./ledger";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Phase 5 planning domain (ERD §3): budgets with per-period category
 * allocations, and savings goals with an append-only contribution ledger.
 * Money is always bigint minor units; currency is stored explicitly on the
 * budget and the goal, and everything under them inherits it — cross-currency
 * math is prevented at the query layer (spend lookups filter on the budget's
 * currency) and linked transfers are currency-checked by trigger (0009).
 */

export const budgetModeEnum = pgEnum("budget_mode", [
  "fixed",
  "flexible",
  "rollover",
  "zero_based",
]);

export const budgetCycleEnum = pgEnum("budget_cycle", ["calendar_month", "payday"]);

export const budgetPeriodStatusEnum = pgEnum("budget_period_status", ["open", "closed"]);

export const goalTypeEnum = pgEnum("goal_type", [
  "emergency",
  "purchase",
  "travel",
  "education",
  "debt_payoff",
  "custom",
]);

export const goalStatusEnum = pgEnum("goal_status", ["active", "paused", "completed", "archived"]);

export const goalContributionKindEnum = pgEnum("goal_contribution_kind", [
  "allocation",
  "linked_transfer",
]);

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mode: budgetModeEnum("mode").notNull(),
    cycleType: budgetCycleEnum("cycle_type").notNull(),
    /** Payday anchor `{ day: 1–28|"last", weekendAdjust: boolean }` (Zod-validated). */
    cycleAnchor: jsonb("cycle_anchor"),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    /**
     * Negative-rollover policy: when false (default) an overspent category
     * rolls RM 0 into the next period; when true the shortfall carries as a
     * negative rollover. Explicit and user-configurable per acceptance criteria.
     */
    carryNegative: boolean("carry_negative").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("budgets_user_name_unique")
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`${t.isActive} = true`),
    check(
      "budgets_payday_anchor_required",
      sql`${t.cycleType} <> 'payday' OR ${t.cycleAnchor} IS NOT NULL`,
    ),
  ],
);

export const budgetPeriods = pgTable(
  "budget_periods",
  {
    id: uuid("id").primaryKey(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: budgetPeriodStatusEnum("status").notNull().default("open"),
    /** Zero-based mode: the income this period plans against. */
    expectedIncomeMinor: bigint("expected_income_minor", { mode: "number" }),
    notes: text("notes"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("budget_periods_budget_start_unique").on(t.budgetId, t.periodStart),
    check("budget_periods_valid_range", sql`${t.periodEnd} > ${t.periodStart}`),
    check(
      "budget_periods_income_non_negative",
      sql`${t.expectedIncomeMinor} IS NULL OR ${t.expectedIncomeMinor} >= 0`,
    ),
    // No-overlap exclusion constraint (daterange + btree_gist) lives in 0009.
  ],
);

export const budgetAllocations = pgTable(
  "budget_allocations",
  {
    id: uuid("id").primaryKey(),
    budgetPeriodId: uuid("budget_period_id")
      .notNull()
      .references(() => budgetPeriods.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    plannedMinor: bigint("planned_minor", { mode: "number" }).notNull().default(0),
    /** Computed once when the period is created; negative only with carryNegative. */
    rolloverInMinor: bigint("rollover_in_minor", { mode: "number" }).notNull().default(0),
    rolloverEnabled: boolean("rollover_enabled").notNull().default(false),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("budget_allocations_period_category_unique").on(t.budgetPeriodId, t.categoryId),
    check("budget_allocations_planned_non_negative", sql`${t.plannedMinor} >= 0`),
  ],
);

export const savingsGoals = pgTable(
  "savings_goals",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: goalTypeEnum("type").notNull(),
    targetAmountMinor: bigint("target_amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    targetDate: date("target_date"),
    /** 1 = highest … 5 = lowest. */
    priority: integer("priority").notNull().default(3),
    /** Reference only — linking never moves money (Phase 5 rule). */
    linkedAccountId: uuid("linked_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    /** Planned contribution `{ amountMinor, frequency: "monthly" }` (Zod-validated). */
    contributionSchedule: jsonb("contribution_schedule"),
    status: goalStatusEnum("status").notNull().default("active"),
    deletedAt: timestamptz("deleted_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("savings_goals_user_name_unique")
      .on(t.userId, sql`lower(${t.name})`)
      .where(isNull(t.deletedAt)),
    index("savings_goals_user_idx").on(t.userId).where(isNull(t.deletedAt)),
    check("savings_goals_target_positive", sql`${t.targetAmountMinor} > 0`),
    check("savings_goals_priority_range", sql`${t.priority} BETWEEN 1 AND 5`),
  ],
);

export const goalContributions = pgTable(
  "goal_contributions",
  {
    id: uuid("id").primaryKey(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Signed: positive = contribution, negative = withdrawal/correction. */
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    contributedOn: date("contributed_on").notNull(),
    kind: goalContributionKindEnum("kind").notNull().default("allocation"),
    /** Only for kind = linked_transfer: the real transfer backing this entry. */
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("goal_contributions_goal_date_idx").on(t.goalId, t.contributedOn),
    check("goal_contributions_amount_nonzero", sql`${t.amountMinor} <> 0`),
    check(
      "goal_contributions_transfer_requires_txn",
      sql`${t.kind} <> 'linked_transfer' OR ${t.transactionId} IS NOT NULL`,
    ),
  ],
);
