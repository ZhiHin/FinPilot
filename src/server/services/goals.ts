import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { isValidIsoDate } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { assertSafeMinor } from "@/lib/money";
import { err, ok, type Result } from "@/lib/result";
import type { Db } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import { accounts, goalContributions, savingsGoals, transactions } from "@/server/db/schema";

/**
 * Savings goals (Phase 5). Contributions are TRACKING ALLOCATIONS in an
 * append-only ledger — recording one never moves money, never creates a bank
 * transaction, never changes an account balance or net worth. A contribution
 * may optionally reference a real transfer transaction (`kind =
 * linked_transfer`), which is a label on the entry, not a money movement.
 * The saved amount is always DERIVED from the contribution ledger — it is
 * never stored, so it can never drift.
 *
 * Formulas (documented in docs/progress/phase-5.md):
 * - Progress (bp)        = Saved ÷ Target
 * - Remaining            = max(Target − Saved, 0)
 * - Required monthly     = ceil(Remaining ÷ months until target date);
 *                          the whole remainder when the date is this month or past
 * - Estimated completion = today + ceil(Remaining ÷ monthly rate) calendar
 *                          months (month resolution); null at rate ≤ 0
 * - Ahead/on-track/behind = estimated month vs target month; deterministic,
 *                           never an AI prediction.
 * - Rate used for the estimate: the goal's planned schedule amount if set,
 *   otherwise the trailing-3-calendar-month average of net contributions.
 */

// ---------------------------------------------------------------------------
// Pure formulas (unit-tested; the what-if controls reuse these unchanged)
// ---------------------------------------------------------------------------

export function progressBp(savedMinor: number, targetMinor: number): number {
  if (targetMinor <= 0) return 0;
  return Math.round((savedMinor * 10_000) / targetMinor);
}

/** Calendar-month boundaries between two dates (same month = 0; past = negative). */
export function monthsUntil(today: string, targetDate: string): number {
  const [y, m] = today.split("-").map(Number);
  const [ty, tm] = targetDate.split("-").map(Number);
  return (ty - y) * 12 + (tm - m);
}

export function requiredMonthlyMinor(remainingMinor: number, monthsRemaining: number): number {
  if (remainingMinor <= 0) return 0;
  if (monthsRemaining <= 0) return remainingMinor;
  return Math.ceil(remainingMinor / monthsRemaining);
}

/** "YYYY-MM" the goal completes at the given rate; null when rate ≤ 0. */
export function estimatedCompletionMonth(
  today: string,
  remainingMinor: number,
  monthlyRateMinor: number,
): string | null {
  const [y, m] = today.split("-").map(Number);
  if (remainingMinor <= 0) return `${y}-${String(m).padStart(2, "0")}`;
  if (monthlyRateMinor <= 0) return null;
  const months = Math.ceil(remainingMinor / monthlyRateMinor);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export type GoalTimeStatus =
  "completed" | "overdue" | "ahead" | "on_track" | "behind" | "no_target_date";

export interface GoalOutlook {
  progressBp: number;
  remainingMinor: number;
  /** Null without a target date (nothing to divide toward). */
  requiredMonthlyMinor: number | null;
  estimatedCompletionMonth: string | null;
  monthlyRateMinor: number;
  timeStatus: GoalTimeStatus;
}

export function computeGoalOutlook(input: {
  targetMinor: number;
  savedMinor: number;
  targetDate: string | null;
  monthlyRateMinor: number;
  today: string;
}): GoalOutlook {
  const remaining = Math.max(input.targetMinor - input.savedMinor, 0);
  const estimate = estimatedCompletionMonth(input.today, remaining, input.monthlyRateMinor);
  const base = {
    progressBp: progressBp(input.savedMinor, input.targetMinor),
    remainingMinor: remaining,
    estimatedCompletionMonth: estimate,
    monthlyRateMinor: input.monthlyRateMinor,
  };
  if (input.savedMinor >= input.targetMinor) {
    return { ...base, requiredMonthlyMinor: 0, timeStatus: "completed" };
  }
  if (input.targetDate === null) {
    return { ...base, requiredMonthlyMinor: null, timeStatus: "no_target_date" };
  }
  const months = monthsUntil(input.today, input.targetDate);
  const required = requiredMonthlyMinor(remaining, months);
  if (input.targetDate < input.today) {
    return { ...base, requiredMonthlyMinor: required, timeStatus: "overdue" };
  }
  if (estimate === null) {
    // Zero rate with a live target date: the goal will not arrive — honest "behind".
    return { ...base, requiredMonthlyMinor: required, timeStatus: "behind" };
  }
  const targetMonth = input.targetDate.slice(0, 7);
  const timeStatus: GoalTimeStatus =
    estimate > targetMonth ? "behind" : estimate < targetMonth ? "ahead" : "on_track";
  return { ...base, requiredMonthlyMinor: required, timeStatus };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GoalType = "emergency" | "purchase" | "travel" | "education" | "debt_payoff" | "custom";
export type GoalStatus = "active" | "paused" | "completed" | "archived";

export interface ContributionScheduleInput {
  amountMinor: number;
  frequency: "monthly";
}

export interface GoalRow {
  id: string;
  name: string;
  type: GoalType;
  targetAmountMinor: number;
  currency: string;
  targetDate: string | null;
  priority: number;
  linkedAccountId: string | null;
  linkedAccountName: string | null;
  contributionSchedule: ContributionScheduleInput | null;
  status: GoalStatus;
}

export interface GoalWithProgress extends GoalRow {
  savedMinor: number;
  outlook: GoalOutlook;
}

export interface ContributionRow {
  id: string;
  amountMinor: number;
  contributedOn: string;
  kind: "allocation" | "linked_transfer";
  transactionId: string | null;
  note: string | null;
}

function toGoalRow(
  row: typeof savingsGoals.$inferSelect,
  linkedAccountName: string | null,
): GoalRow {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    targetAmountMinor: row.targetAmountMinor,
    currency: row.currency.trim(),
    targetDate: row.targetDate,
    priority: row.priority,
    linkedAccountId: row.linkedAccountId,
    linkedAccountName,
    contributionSchedule: (row.contributionSchedule as ContributionScheduleInput | null) ?? null,
    status: row.status,
  };
}

async function getOwnedGoal(
  db: Db,
  userId: string,
  goalId: string,
): Promise<typeof savingsGoals.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(savingsGoals)
    .where(
      and(
        eq(savingsGoals.id, goalId),
        eq(savingsGoals.userId, userId),
        isNull(savingsGoals.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function savedMinorFor(db: Db, goalId: string): Promise<number> {
  const [row] = (
    await db.execute<{ total: number }>(
      sql`select coalesce(sum(amount_minor), 0)::bigint as total from goal_contributions where goal_id = ${goalId}`,
    )
  ).rows;
  return Number(row?.total ?? 0);
}

/** Trailing-3-calendar-month average of net contributions (never negative). */
async function trailingMonthlyRate(db: Db, goalId: string, today: string): Promise<number> {
  const [row] = (
    await db.execute<{ total: number }>(sql`
      select coalesce(sum(amount_minor), 0)::bigint as total
      from goal_contributions
      where goal_id = ${goalId}
        and contributed_on > (${today}::date - interval '3 months')
        and contributed_on <= ${today}::date
    `)
  ).rows;
  return Math.max(Math.round(Number(row?.total ?? 0) / 3), 0);
}

async function outlookFor(
  db: Db,
  goal: typeof savingsGoals.$inferSelect,
  savedMinor: number,
  today: string,
): Promise<GoalOutlook> {
  const schedule = (goal.contributionSchedule as ContributionScheduleInput | null) ?? null;
  const rate =
    schedule && schedule.amountMinor > 0
      ? schedule.amountMinor
      : await trailingMonthlyRate(db, goal.id, today);
  return computeGoalOutlook({
    targetMinor: goal.targetAmountMinor,
    savedMinor,
    targetDate: goal.targetDate,
    monthlyRateMinor: rate,
    today,
  });
}

const GOAL_TYPES: ReadonlySet<string> = new Set([
  "emergency",
  "purchase",
  "travel",
  "education",
  "debt_payoff",
  "custom",
]);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const goalsService = {
  async listWithProgress(db: Db, userId: string, today: string): Promise<GoalWithProgress[]> {
    const rows = await db
      .select({
        goal: savingsGoals,
        linkedAccountName: accounts.name,
        savedMinor: sql<number>`coalesce((
          select sum(gc.amount_minor) from goal_contributions gc where gc.goal_id = ${savingsGoals.id}
        ), 0)::bigint`.mapWith(Number),
      })
      .from(savingsGoals)
      .leftJoin(accounts, eq(accounts.id, savingsGoals.linkedAccountId))
      .where(and(eq(savingsGoals.userId, userId), isNull(savingsGoals.deletedAt)))
      .orderBy(asc(savingsGoals.priority), asc(savingsGoals.createdAt));
    const result: GoalWithProgress[] = [];
    for (const row of rows) {
      result.push({
        ...toGoalRow(row.goal, row.linkedAccountName),
        savedMinor: row.savedMinor,
        outlook: await outlookFor(db, row.goal, row.savedMinor, today),
      });
    }
    return result;
  },

  async getDetail(
    db: Db,
    userId: string,
    goalId: string,
    today: string,
  ): Promise<Result<{ goal: GoalWithProgress; contributions: ContributionRow[] }>> {
    const goal = await getOwnedGoal(db, userId, goalId);
    if (!goal) return err("not_found", "That goal doesn’t exist.");
    const [linked] = goal.linkedAccountId
      ? await db
          .select({ name: accounts.name })
          .from(accounts)
          .where(eq(accounts.id, goal.linkedAccountId))
          .limit(1)
      : [];
    const savedMinor = await savedMinorFor(db, goalId);
    const contributions = await db
      .select()
      .from(goalContributions)
      .where(eq(goalContributions.goalId, goalId))
      .orderBy(desc(goalContributions.contributedOn), desc(goalContributions.createdAt));
    return ok({
      goal: {
        ...toGoalRow(goal, linked?.name ?? null),
        savedMinor,
        outlook: await outlookFor(db, goal, savedMinor, today),
      },
      contributions: contributions.map((row) => ({
        id: row.id,
        amountMinor: row.amountMinor,
        contributedOn: row.contributedOn,
        kind: row.kind,
        transactionId: row.transactionId,
        note: row.note,
      })),
    });
  },

  async create(
    db: Db,
    userId: string,
    input: {
      name: string;
      type: GoalType;
      targetAmountMinor: number;
      currency?: string;
      targetDate?: string | null;
      priority?: number;
      linkedAccountId?: string | null;
      contributionSchedule?: ContributionScheduleInput | null;
    },
  ): Promise<Result<GoalRow>> {
    const name = input.name.trim();
    if (!name || name.length > 80) {
      return err("invalid_input", "Please give the goal a name (up to 80 characters).");
    }
    if (!GOAL_TYPES.has(input.type)) return err("invalid_input", "Pick a goal type.");
    assertSafeMinor(input.targetAmountMinor);
    if (input.targetAmountMinor <= 0) {
      return err("invalid_input", "The target amount must be above zero.");
    }
    if (input.targetDate != null && !isValidIsoDate(input.targetDate)) {
      return err("invalid_input", "That target date isn’t valid.");
    }
    const priority = input.priority ?? 3;
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
      return err("invalid_input", "Priority runs from 1 (highest) to 5 (lowest).");
    }
    if (input.contributionSchedule) {
      assertSafeMinor(input.contributionSchedule.amountMinor);
      if (input.contributionSchedule.amountMinor <= 0) {
        return err("invalid_input", "The planned contribution must be above zero.");
      }
    }
    if (input.linkedAccountId) {
      const [owned] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, input.linkedAccountId), eq(accounts.userId, userId)))
        .limit(1);
      if (!owned) return err("not_found", "That account doesn’t exist.");
    }
    const id = uuidv7();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(savingsGoals).values({
          id,
          userId,
          name,
          type: input.type,
          targetAmountMinor: input.targetAmountMinor,
          currency: (input.currency ?? "MYR").toUpperCase(),
          targetDate: input.targetDate ?? null,
          priority,
          linkedAccountId: input.linkedAccountId ?? null,
          contributionSchedule: input.contributionSchedule ?? null,
        });
        await auditRepo.record(tx as unknown as Db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: "goal.created",
          entityType: "savings_goal",
          entityId: id,
          diff: { name, type: input.type, targetAmountMinor: input.targetAmountMinor },
        });
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /savings_goals_user_name_unique/.test(
          `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`,
        )
      ) {
        return err("conflict", "You already have a goal with that name.");
      }
      throw error;
    }
    const [row] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, id)).limit(1);
    return ok(toGoalRow(row, null));
  },

  async update(
    db: Db,
    userId: string,
    goalId: string,
    patch: Partial<{
      name: string;
      targetAmountMinor: number;
      targetDate: string | null;
      priority: number;
      linkedAccountId: string | null;
      contributionSchedule: ContributionScheduleInput | null;
      type: GoalType;
    }>,
  ): Promise<Result<{ updated: true }>> {
    const goal = await getOwnedGoal(db, userId, goalId);
    if (!goal) return err("not_found", "That goal doesn’t exist.");
    if (patch.name !== undefined && (!patch.name.trim() || patch.name.trim().length > 80)) {
      return err("invalid_input", "Please give the goal a name (up to 80 characters).");
    }
    if (patch.targetAmountMinor !== undefined) {
      assertSafeMinor(patch.targetAmountMinor);
      if (patch.targetAmountMinor <= 0) {
        return err("invalid_input", "The target amount must be above zero.");
      }
    }
    if (patch.targetDate !== undefined && patch.targetDate !== null) {
      if (!isValidIsoDate(patch.targetDate)) {
        return err("invalid_input", "That target date isn’t valid.");
      }
    }
    if (patch.priority !== undefined) {
      if (!Number.isInteger(patch.priority) || patch.priority < 1 || patch.priority > 5) {
        return err("invalid_input", "Priority runs from 1 (highest) to 5 (lowest).");
      }
    }
    if (patch.contributionSchedule !== undefined && patch.contributionSchedule !== null) {
      assertSafeMinor(patch.contributionSchedule.amountMinor);
      if (patch.contributionSchedule.amountMinor <= 0) {
        return err("invalid_input", "The planned contribution must be above zero.");
      }
    }
    if (patch.linkedAccountId) {
      const [owned] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, patch.linkedAccountId), eq(accounts.userId, userId)))
        .limit(1);
      if (!owned) return err("not_found", "That account doesn’t exist.");
    }
    await db.transaction(async (tx) => {
      await tx
        .update(savingsGoals)
        .set({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.targetAmountMinor !== undefined
            ? { targetAmountMinor: patch.targetAmountMinor }
            : {}),
          ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.linkedAccountId !== undefined
            ? { linkedAccountId: patch.linkedAccountId }
            : {}),
          ...(patch.contributionSchedule !== undefined
            ? { contributionSchedule: patch.contributionSchedule }
            : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(savingsGoals.id, goalId));
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "goal.updated",
        entityType: "savings_goal",
        entityId: goalId,
        diff: { changed: Object.keys(patch) },
      });
    });
    return ok({ updated: true as const });
  },

  /** pause ↔ resume, complete, archive — history always preserved. */
  async setStatus(
    db: Db,
    userId: string,
    goalId: string,
    status: GoalStatus,
  ): Promise<Result<{ status: GoalStatus }>> {
    const goal = await getOwnedGoal(db, userId, goalId);
    if (!goal) return err("not_found", "That goal doesn’t exist.");
    const allowed: Record<GoalStatus, GoalStatus[]> = {
      active: ["paused", "completed", "archived"],
      paused: ["active", "completed", "archived"],
      completed: ["active", "archived"],
      archived: ["active"],
    };
    if (!allowed[goal.status].includes(status)) {
      return err("invalid_input", `A ${goal.status} goal can’t move to ${status}.`);
    }
    await db.transaction(async (tx) => {
      await tx
        .update(savingsGoals)
        .set({ status, updatedAt: sql`now()` })
        .where(eq(savingsGoals.id, goalId));
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: `goal.${status}`,
        entityType: "savings_goal",
        entityId: goalId,
        diff: { from: goal.status },
      });
    });
    return ok({ status });
  },

  /**
   * Append a contribution (positive) or withdrawal/correction (negative, note
   * required). Tracking only — no account balance or transaction is touched.
   * `id` doubles as the idempotency key for double-submits. Optionally links
   * an existing real transaction of the user as evidence (kind becomes
   * linked_transfer; same-currency enforced by trigger).
   */
  async addContribution(
    db: Db,
    userId: string,
    goalId: string,
    input: {
      id?: string;
      amountMinor: number;
      contributedOn: string;
      note?: string | null;
      transactionId?: string | null;
    },
  ): Promise<Result<{ contributionId: string; savedMinor: number }>> {
    assertSafeMinor(input.amountMinor);
    if (input.amountMinor === 0) return err("invalid_input", "Enter an amount above zero.");
    if (!isValidIsoDate(input.contributedOn)) {
      return err("invalid_input", "That date isn’t valid.");
    }
    const goal = await getOwnedGoal(db, userId, goalId);
    if (!goal) return err("not_found", "That goal doesn’t exist.");
    if (goal.status === "archived") {
      return err("invalid_input", "This goal is archived — reactivate it first.");
    }
    if (input.amountMinor < 0 && !(input.note ?? "").trim()) {
      return err("invalid_input", "Withdrawals and corrections need a note explaining why.", {
        note: ["Add a short reason."],
      });
    }
    if (input.transactionId) {
      const [owned] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.id, input.transactionId), eq(transactions.userId, userId)))
        .limit(1);
      if (!owned) return err("not_found", "That transaction doesn’t exist.");
    }
    const id = input.id ?? uuidv7();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(goalContributions).values({
          id,
          goalId,
          userId,
          amountMinor: input.amountMinor,
          contributedOn: input.contributedOn,
          kind: input.transactionId ? "linked_transfer" : "allocation",
          transactionId: input.transactionId ?? null,
          note: input.note ?? null,
        });
        await auditRepo.record(tx as unknown as Db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: input.amountMinor > 0 ? "goal.contributed" : "goal.withdrawn",
          entityType: "savings_goal",
          entityId: goalId,
          diff: { amountMinor: input.amountMinor, contributedOn: input.contributedOn },
        });
      });
    } catch (error) {
      const chain = `${error instanceof Error ? error.message : ""} ${
        error instanceof Error && error.cause instanceof Error ? error.cause.message : ""
      }`;
      if (/goal_contributions_pkey|duplicate key/i.test(chain)) {
        // Same idempotency id submitted twice — the first write already landed.
        return ok({ contributionId: id, savedMinor: await savedMinorFor(db, goalId) });
      }
      if (/sum below zero/i.test(chain)) {
        return err("invalid_input", "You can’t withdraw more than this goal has saved.");
      }
      throw error;
    }
    return ok({ contributionId: id, savedMinor: await savedMinorFor(db, goalId) });
  },
} as const;
