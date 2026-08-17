import { and, asc, desc, eq, lt, sql } from "drizzle-orm";

import {
  elapsedBp as cycleElapsedBp,
  nextWindow,
  prevWindow,
  resolveWindow,
  windowForStart,
  type CycleSpec,
  type CycleWindow,
} from "@/lib/cycles";
import { addDaysIso, isValidIsoDate } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { assertSafeMinor } from "@/lib/money";
import { err, ok, type Result } from "@/lib/result";
import type { Db } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import {
  budgetAllocations,
  budgetPeriods,
  budgets,
  categories,
  categoryGroups,
} from "@/server/db/schema";

/**
 * FinPilot budgets (Phase 5). All budget arithmetic lives here — UI renders
 * what this service computed, never re-derives it.
 *
 * Inclusion rules (identical to the analytics reporting engine):
 * - Actual spending = posted ∧ not-excluded ∧ not-deleted expense minus
 *   refunds, split-aware (splits count in their split category), in the
 *   budget's currency only. Transfers/adjustments/debt payments never count.
 * - Pending spending is computed identically for status = pending and always
 *   shown separately — it never reduces Remaining.
 * - Uncategorized and unbudgeted spending are reported separately, never
 *   silently assigned to an allocation.
 *
 * Formulas (documented in docs/progress/phase-5.md):
 * - Remaining              = Planned − Posted
 * - Available with rollover = Planned + Rollover-in − Posted ≥ Remaining rule
 * - Usage rate (bp)        = Posted ÷ Available; null when Available ≤ 0
 * - Rollover-out           = max(Available − Posted, 0), or the signed value
 *                            when the budget's carryNegative flag is on.
 *   Rollover is computed ONCE, when the next adjacent period is created, and
 *   stored on the new allocation (`rollover_in_minor`) — later edits to the
 *   old period never rewrite it (history is immutable).
 * - Zero-based unallocated = Expected income − Σ Planned (null without income).
 */

// ---------------------------------------------------------------------------
// Pure formulas (unit-tested in budgets.formulas.test.ts)
// ---------------------------------------------------------------------------

export function remainingMinor(availablePlannedMinor: number, postedMinor: number): number {
  return availablePlannedMinor - postedMinor;
}

export function availableMinor(plannedMinor: number, rolloverInMinor: number): number {
  return plannedMinor + rolloverInMinor;
}

/** Posted ÷ available in basis points; null when there is no available budget. */
export function usageBp(postedMinor: number, availableBudgetMinor: number): number | null {
  if (availableBudgetMinor <= 0) return null;
  return Math.round((postedMinor * 10_000) / availableBudgetMinor);
}

export function rolloverOutMinor(input: {
  availableMinor: number;
  postedMinor: number;
  carryNegative: boolean;
}): number {
  const leftover = input.availableMinor - input.postedMinor;
  return input.carryNegative ? leftover : Math.max(leftover, 0);
}

export function unallocatedMinor(
  expectedIncomeMinor: number | null,
  totalPlannedMinor: number,
): number | null {
  if (expectedIncomeMinor === null) return null;
  return expectedIncomeMinor - totalPlannedMinor;
}

export type BudgetHealth =
  "not_started" | "no_activity" | "on_track" | "watch" | "at_risk" | "exceeded";

/**
 * Deterministic health ladder (documented thresholds — never an AI prediction):
 * 1. not_started — the period hasn't begun.
 * 2. no_activity — nothing posted and nothing pending.
 * 3. exceeded    — posted > available (including available ≤ 0 with spending).
 * 4. at_risk     — usage ≥ 90%, or usage is ≥ 20 percentage points ahead of
 *                  the elapsed share of the cycle.
 * 5. watch       — usage ≥ 10 points ahead of the elapsed share.
 * 6. on_track    — everything else.
 */
export function healthState(input: {
  availableMinor: number;
  postedMinor: number;
  pendingMinor: number;
  elapsedBp: number;
  periodStart: string;
  today: string;
}): BudgetHealth {
  if (input.today < input.periodStart) return "not_started";
  if (input.postedMinor === 0 && input.pendingMinor === 0) return "no_activity";
  if (input.postedMinor > input.availableMinor) return "exceeded";
  const usage = usageBp(input.postedMinor, input.availableMinor);
  if (usage === null) return input.postedMinor > 0 ? "exceeded" : "no_activity";
  if (usage >= 9000 || usage - input.elapsedBp >= 2000) return "at_risk";
  if (usage - input.elapsedBp >= 1000) return "watch";
  return "on_track";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CycleAnchorInput {
  day: number | "last";
  weekendAdjust: boolean;
}

export type BudgetMode = "fixed" | "flexible" | "rollover" | "zero_based";

export interface BudgetRow {
  id: string;
  name: string;
  mode: BudgetMode;
  cycleType: "calendar_month" | "payday";
  cycleAnchor: CycleAnchorInput | null;
  currency: string;
  carryNegative: boolean;
  isActive: boolean;
}

export interface AllocationReport {
  allocationId: string;
  categoryId: string;
  categoryName: string;
  groupName: string | null;
  plannedMinor: number;
  rolloverInMinor: number;
  rolloverEnabled: boolean;
  postedMinor: number;
  pendingMinor: number;
  availableMinor: number;
  remainingMinor: number;
  usageBp: number | null;
  health: BudgetHealth;
  notes: string | null;
  version: number;
}

export interface UnbudgetedRow {
  categoryId: string | null;
  categoryName: string;
  groupName: string | null;
  postedMinor: number;
  pendingMinor: number;
}

export interface PeriodReport {
  budget: BudgetRow;
  period: {
    id: string;
    periodStart: string;
    periodEnd: string;
    status: "open" | "closed";
    notes: string | null;
    expectedIncomeMinor: number | null;
  };
  allocations: AllocationReport[];
  /** Spending in categories without an allocation — health "no budget". */
  unbudgeted: UnbudgetedRow[];
  uncategorized: { postedMinor: number; pendingMinor: number };
  totals: {
    plannedMinor: number;
    rolloverInMinor: number;
    availableMinor: number;
    postedMinor: number;
    pendingMinor: number;
    remainingMinor: number;
    usageBp: number | null;
    health: BudgetHealth;
    elapsedBp: number;
  };
  /** Zero-based mode only; null when expected income isn't set. */
  unallocatedIncomeMinor: number | null;
  hasPreviousPeriod: boolean;
  nav: { prevStart: string; nextStart: string | null };
  incomplete: boolean;
}

function toBudgetRow(row: typeof budgets.$inferSelect): BudgetRow {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    cycleType: row.cycleType,
    cycleAnchor: (row.cycleAnchor as CycleAnchorInput | null) ?? null,
    currency: row.currency.trim(),
    carryNegative: row.carryNegative,
    isActive: row.isActive,
  };
}

function cycleSpecOf(budget: BudgetRow): CycleSpec {
  return { type: budget.cycleType, anchor: budget.cycleAnchor };
}

/** Drizzle wraps PG errors; the constraint name sits on the cause chain. */
function errorChain(error: unknown): string {
  const parts: string[] = [];
  let cursor: unknown = error;
  for (let depth = 0; depth < 4 && cursor instanceof Error; depth++) {
    parts.push(cursor.message);
    cursor = cursor.cause;
  }
  return parts.join(" | ");
}

function isValidAnchor(anchor: unknown): anchor is CycleAnchorInput {
  if (typeof anchor !== "object" || anchor === null) return false;
  const a = anchor as Record<string, unknown>;
  const dayOk =
    a.day === "last" ||
    (typeof a.day === "number" && Number.isInteger(a.day) && a.day >= 1 && a.day <= 28);
  return dayOk && typeof a.weekendAdjust === "boolean";
}

async function getOwnedBudget(
  db: Db,
  userId: string,
  budgetId: string,
): Promise<typeof budgets.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function getOwnedPeriod(
  db: Db,
  userId: string,
  periodId: string,
): Promise<typeof budgetPeriods.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.id, periodId), eq(budgetPeriods.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Split-aware posted/pending expense (minus refunds) per category for a window. */
async function spendingByCategory(
  db: Db,
  userId: string,
  currency: string,
  window: CycleWindow,
): Promise<Map<string | null, { postedMinor: number; pendingMinor: number }>> {
  const rows = (
    await db.execute<{ category_id: string | null; posted: number; pending: number }>(sql`
      with eff as (
        select coalesce(s.category_id, t.category_id) as category_id,
               coalesce(s.amount_minor, t.amount_minor)::bigint as amount_minor,
               t.status
        from transactions t
        left join transaction_splits s on s.transaction_id = t.id
        where t.user_id = ${userId}
          and t.deleted_at is null
          and t.is_excluded = false
          and t.currency = ${currency}
          and t.txn_date >= ${window.periodStart}::date
          and t.txn_date <= ${window.periodEnd}::date
          and t.type in ('expense', 'refund')
      )
      select category_id,
             coalesce(sum(-amount_minor) filter (where status = 'posted'), 0)::bigint as posted,
             coalesce(sum(-amount_minor) filter (where status = 'pending'), 0)::bigint as pending
      from eff
      group by category_id
    `)
  ).rows;
  const map = new Map<string | null, { postedMinor: number; pendingMinor: number }>();
  for (const row of rows) {
    map.set(row.category_id, {
      postedMinor: Number(row.posted),
      pendingMinor: Number(row.pending),
    });
  }
  return map;
}

/**
 * Get or lazily create the period whose window starts at `window.periodStart`,
 * computing rollover ONCE from the immediately-preceding adjacent period (if
 * any) and carrying its rollover-enabled allocations. Atomic; the unique
 * (budget_id, period_start) index makes concurrent creation safe.
 */
async function ensurePeriod(
  db: Db,
  userId: string,
  budget: BudgetRow,
  window: CycleWindow,
): Promise<typeof budgetPeriods.$inferSelect> {
  const existing = await db
    .select()
    .from(budgetPeriods)
    .where(
      and(eq(budgetPeriods.budgetId, budget.id), eq(budgetPeriods.periodStart, window.periodStart)),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const periodId = uuidv7();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(budgetPeriods).values({
        id: periodId,
        budgetId: budget.id,
        userId,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
      });

      // Rollover carry: only from the immediately-preceding ADJACENT period.
      const [prev] = await tx
        .select()
        .from(budgetPeriods)
        .where(
          and(
            eq(budgetPeriods.budgetId, budget.id),
            lt(budgetPeriods.periodStart, window.periodStart),
          ),
        )
        .orderBy(desc(budgetPeriods.periodStart))
        .limit(1);
      let carried = 0;
      if (prev && prev.periodEnd === addDaysIso(window.periodStart, -1)) {
        const prevAllocations = await tx
          .select()
          .from(budgetAllocations)
          .where(eq(budgetAllocations.budgetPeriodId, prev.id));
        const rolling = prevAllocations.filter(
          (a) => budget.mode === "rollover" || a.rolloverEnabled,
        );
        if (rolling.length > 0) {
          const prevSpend = await spendingByCategory(tx as unknown as Db, userId, budget.currency, {
            periodStart: prev.periodStart,
            periodEnd: prev.periodEnd,
          });
          for (const allocation of rolling) {
            const posted = prevSpend.get(allocation.categoryId)?.postedMinor ?? 0;
            const rolloverIn = rolloverOutMinor({
              availableMinor: availableMinor(allocation.plannedMinor, allocation.rolloverInMinor),
              postedMinor: posted,
              carryNegative: budget.carryNegative,
            });
            await tx.insert(budgetAllocations).values({
              id: uuidv7(),
              budgetPeriodId: periodId,
              userId,
              categoryId: allocation.categoryId,
              plannedMinor: allocation.plannedMinor,
              rolloverInMinor: rolloverIn,
              rolloverEnabled: allocation.rolloverEnabled,
            });
            carried += 1;
          }
        }
        // The predecessor is now history.
        await tx
          .update(budgetPeriods)
          .set({ status: "closed", updatedAt: sql`now()` })
          .where(eq(budgetPeriods.id, prev.id));
      }

      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "budget_period.created",
        entityType: "budget_period",
        entityId: periodId,
        diff: { periodStart: window.periodStart, periodEnd: window.periodEnd, carried },
      });
    });
  } catch {
    // Concurrent creation: the unique (budget_id, period_start) index won — reuse it.
    const [row] = await db
      .select()
      .from(budgetPeriods)
      .where(
        and(
          eq(budgetPeriods.budgetId, budget.id),
          eq(budgetPeriods.periodStart, window.periodStart),
        ),
      )
      .limit(1);
    if (row) return row;
    throw new Error("budget period creation failed");
  }
  const [created] = await db
    .select()
    .from(budgetPeriods)
    .where(eq(budgetPeriods.id, periodId))
    .limit(1);
  return created;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const budgetsService = {
  async list(db: Db, userId: string): Promise<BudgetRow[]> {
    const rows = await db
      .select()
      .from(budgets)
      .where(eq(budgets.userId, userId))
      .orderBy(desc(budgets.isActive), asc(budgets.createdAt));
    return rows.map(toBudgetRow);
  },

  async create(
    db: Db,
    userId: string,
    input: {
      name: string;
      mode: BudgetMode;
      cycleType: "calendar_month" | "payday";
      cycleAnchor?: CycleAnchorInput | null;
      currency?: string;
      carryNegative?: boolean;
    },
  ): Promise<Result<BudgetRow>> {
    const name = input.name.trim();
    if (!name || name.length > 80) {
      return err("invalid_input", "Please give the budget a name (up to 80 characters).");
    }
    if (input.cycleType === "payday" && !isValidAnchor(input.cycleAnchor)) {
      return err("invalid_input", "Payday budgets need a payday (day 1–28 or last day).");
    }
    const id = uuidv7();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(budgets).values({
          id,
          userId,
          name,
          mode: input.mode,
          cycleType: input.cycleType,
          cycleAnchor: input.cycleType === "payday" ? input.cycleAnchor : null,
          currency: (input.currency ?? "MYR").toUpperCase(),
          carryNegative: input.carryNegative ?? false,
        });
        await auditRepo.record(tx as unknown as Db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: "budget.created",
          entityType: "budget",
          entityId: id,
          diff: { name, mode: input.mode, cycleType: input.cycleType },
        });
      });
    } catch (error) {
      if (/budgets_user_name_unique/.test(errorChain(error))) {
        return err("conflict", "You already have an active budget with that name.");
      }
      throw error;
    }
    const [row] = await db.select().from(budgets).where(eq(budgets.id, id)).limit(1);
    return ok(toBudgetRow(row));
  },

  async update(
    db: Db,
    userId: string,
    budgetId: string,
    patch: Partial<{ name: string; carryNegative: boolean; mode: BudgetMode }>,
  ): Promise<Result<BudgetRow>> {
    const budget = await getOwnedBudget(db, userId, budgetId);
    if (!budget) return err("not_found", "That budget doesn’t exist.");
    const name = patch.name?.trim();
    if (name !== undefined && (!name || name.length > 80)) {
      return err("invalid_input", "Please give the budget a name (up to 80 characters).");
    }
    await db.transaction(async (tx) => {
      await tx
        .update(budgets)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(patch.carryNegative !== undefined ? { carryNegative: patch.carryNegative } : {}),
          ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(budgets.id, budgetId));
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "budget.updated",
        entityType: "budget",
        entityId: budgetId,
        diff: { changed: Object.keys(patch) },
      });
    });
    const [row] = await db.select().from(budgets).where(eq(budgets.id, budgetId)).limit(1);
    return ok(toBudgetRow(row));
  },

  /** Archiving keeps every period and allocation as readable history. */
  async archive(db: Db, userId: string, budgetId: string): Promise<Result<{ archived: true }>> {
    const budget = await getOwnedBudget(db, userId, budgetId);
    if (!budget) return err("not_found", "That budget doesn’t exist.");
    await db.transaction(async (tx) => {
      await tx
        .update(budgets)
        .set({ isActive: false, updatedAt: sql`now()` })
        .where(eq(budgets.id, budgetId));
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "budget.archived",
        entityType: "budget",
        entityId: budgetId,
        diff: {},
      });
    });
    return ok({ archived: true as const });
  },

  /**
   * The full report for one budget period. Omitting `periodStart` resolves
   * (and lazily creates) the period containing `today`; passing it navigates
   * history. Future periods are never created — the next cycle opens on its
   * start date.
   */
  async periodReport(
    db: Db,
    userId: string,
    input: { budgetId: string; periodStart?: string; today: string },
  ): Promise<Result<PeriodReport>> {
    const budgetRaw = await getOwnedBudget(db, userId, input.budgetId);
    if (!budgetRaw) return err("not_found", "That budget doesn’t exist.");
    const budget = toBudgetRow(budgetRaw);
    const spec = cycleSpecOf(budget);

    let window: CycleWindow;
    if (input.periodStart !== undefined) {
      if (!isValidIsoDate(input.periodStart)) {
        return err("invalid_input", "That period isn’t valid.");
      }
      window = windowForStart(spec, input.periodStart);
      if (window.periodStart !== input.periodStart) {
        return err("invalid_input", "That period doesn’t start on a cycle boundary.");
      }
      if (window.periodStart > input.today) {
        return err("invalid_input", "That cycle hasn’t started yet — it opens on its first day.");
      }
    } else {
      window = resolveWindow(spec, input.today);
    }

    const period = await ensurePeriod(db, userId, budget, window);
    const spending = await spendingByCategory(db, userId, budget.currency, window);

    const allocationRows = await db
      .select({
        allocation: budgetAllocations,
        categoryName: categories.name,
        groupName: categoryGroups.name,
      })
      .from(budgetAllocations)
      .innerJoin(categories, eq(categories.id, budgetAllocations.categoryId))
      .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
      .where(eq(budgetAllocations.budgetPeriodId, period.id))
      .orderBy(asc(categoryGroups.sortOrder), asc(categories.name));

    const elapsed = cycleElapsedBp(window, input.today);
    const allocations: AllocationReport[] = allocationRows.map(
      ({ allocation, categoryName, groupName }) => {
        const spend = spending.get(allocation.categoryId) ?? { postedMinor: 0, pendingMinor: 0 };
        const available = availableMinor(allocation.plannedMinor, allocation.rolloverInMinor);
        return {
          allocationId: allocation.id,
          categoryId: allocation.categoryId,
          categoryName,
          groupName,
          plannedMinor: allocation.plannedMinor,
          rolloverInMinor: allocation.rolloverInMinor,
          rolloverEnabled: allocation.rolloverEnabled,
          postedMinor: spend.postedMinor,
          pendingMinor: spend.pendingMinor,
          availableMinor: available,
          remainingMinor: remainingMinor(available, spend.postedMinor),
          usageBp: usageBp(spend.postedMinor, available),
          health: healthState({
            availableMinor: available,
            postedMinor: spend.postedMinor,
            pendingMinor: spend.pendingMinor,
            elapsedBp: elapsed,
            periodStart: window.periodStart,
            today: input.today,
          }),
          notes: allocation.notes,
          version: allocation.version,
        };
      },
    );

    // Spending outside any allocation: reported, never silently assigned.
    const budgetedIds = new Set(allocations.map((a) => a.categoryId));
    const unbudgetedIds = [...spending.keys()].filter(
      (id): id is string => id !== null && !budgetedIds.has(id),
    );
    let unbudgeted: UnbudgetedRow[] = [];
    if (unbudgetedIds.length > 0) {
      const names = await db
        .select({ id: categories.id, name: categories.name, groupName: categoryGroups.name })
        .from(categories)
        .leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
        .where(and(eq(categories.userId, userId)));
      const nameById = new Map(names.map((n) => [n.id, n]));
      unbudgeted = unbudgetedIds
        .map((id) => ({
          categoryId: id,
          categoryName: nameById.get(id)?.name ?? "Unknown category",
          groupName: nameById.get(id)?.groupName ?? null,
          postedMinor: spending.get(id)?.postedMinor ?? 0,
          pendingMinor: spending.get(id)?.pendingMinor ?? 0,
        }))
        .filter((row) => row.postedMinor !== 0 || row.pendingMinor !== 0)
        .sort((a, b) => b.postedMinor - a.postedMinor);
    }
    const uncategorizedSpend = spending.get(null) ?? { postedMinor: 0, pendingMinor: 0 };

    const totalsPlanned = allocations.reduce((sum, a) => sum + a.plannedMinor, 0);
    const totalsRollover = allocations.reduce((sum, a) => sum + a.rolloverInMinor, 0);
    const totalsAvailable = availableMinor(totalsPlanned, totalsRollover);
    const totalsPosted = allocations.reduce((sum, a) => sum + a.postedMinor, 0);
    const totalsPending = allocations.reduce((sum, a) => sum + a.pendingMinor, 0);

    const [prevExisting] = await db
      .select({ id: budgetPeriods.id })
      .from(budgetPeriods)
      .where(
        and(
          eq(budgetPeriods.budgetId, budget.id),
          lt(budgetPeriods.periodStart, window.periodStart),
        ),
      )
      .limit(1);

    const next = nextWindow(spec, window);
    return ok({
      budget,
      period: {
        id: period.id,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        status: period.status,
        notes: period.notes,
        expectedIncomeMinor: period.expectedIncomeMinor,
      },
      allocations,
      unbudgeted,
      uncategorized: uncategorizedSpend,
      totals: {
        plannedMinor: totalsPlanned,
        rolloverInMinor: totalsRollover,
        availableMinor: totalsAvailable,
        postedMinor: totalsPosted,
        pendingMinor: totalsPending,
        remainingMinor: remainingMinor(totalsAvailable, totalsPosted),
        usageBp: usageBp(totalsPosted, totalsAvailable),
        health: healthState({
          availableMinor: totalsAvailable,
          postedMinor: totalsPosted,
          pendingMinor: totalsPending,
          elapsedBp: elapsed,
          periodStart: window.periodStart,
          today: input.today,
        }),
        elapsedBp: elapsed,
      },
      unallocatedIncomeMinor:
        budget.mode === "zero_based"
          ? unallocatedMinor(period.expectedIncomeMinor, totalsPlanned)
          : null,
      hasPreviousPeriod: Boolean(prevExisting),
      nav: {
        prevStart: prevWindow(spec, window).periodStart,
        nextStart: next.periodStart <= input.today ? next.periodStart : null,
      },
      incomplete: input.today >= window.periodStart && input.today < window.periodEnd,
    });
  },

  /**
   * Create or update one category allocation. Explicit and auditable — budgets
   * never change themselves. `expectedVersion` guards concurrent edits;
   * `allocationId` doubles as the idempotency key for double-submits.
   */
  async setAllocation(
    db: Db,
    userId: string,
    input: {
      periodId: string;
      categoryId: string;
      plannedMinor: number;
      rolloverEnabled?: boolean;
      notes?: string | null;
      expectedVersion?: number;
      allocationId?: string;
    },
  ): Promise<Result<{ allocationId: string }>> {
    assertSafeMinor(input.plannedMinor);
    if (input.plannedMinor < 0) {
      return err("invalid_input", "Planned amounts can’t be negative.");
    }
    const period = await getOwnedPeriod(db, userId, input.periodId);
    if (!period) return err("not_found", "That budget period doesn’t exist.");
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.userId, userId)))
      .limit(1);
    if (!category) return err("not_found", "That category doesn’t exist.");

    const [existing] = await db
      .select()
      .from(budgetAllocations)
      .where(
        and(
          eq(budgetAllocations.budgetPeriodId, input.periodId),
          eq(budgetAllocations.categoryId, input.categoryId),
        ),
      )
      .limit(1);

    if (existing) {
      if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
        return err("conflict", "This allocation changed in another tab. Refresh and try again.");
      }
      await db.transaction(async (tx) => {
        await tx
          .update(budgetAllocations)
          .set({
            plannedMinor: input.plannedMinor,
            ...(input.rolloverEnabled !== undefined
              ? { rolloverEnabled: input.rolloverEnabled }
              : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            version: sql`${budgetAllocations.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(budgetAllocations.id, existing.id));
        await auditRepo.record(tx as unknown as Db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: "budget_allocation.updated",
          entityType: "budget_allocation",
          entityId: existing.id,
          diff: {
            categoryId: input.categoryId,
            plannedMinor: { from: existing.plannedMinor, to: input.plannedMinor },
          },
        });
      });
      return ok({ allocationId: existing.id });
    }

    const id = input.allocationId ?? uuidv7();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(budgetAllocations).values({
          id,
          budgetPeriodId: input.periodId,
          userId,
          categoryId: input.categoryId,
          plannedMinor: input.plannedMinor,
          rolloverEnabled: input.rolloverEnabled ?? false,
          notes: input.notes ?? null,
        });
        await auditRepo.record(tx as unknown as Db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: "budget_allocation.created",
          entityType: "budget_allocation",
          entityId: id,
          diff: { categoryId: input.categoryId, plannedMinor: input.plannedMinor },
        });
      });
    } catch (error) {
      // Duplicate submit raced us: the unique (period, category) index held.
      if (/period_category_unique|duplicate key/i.test(errorChain(error))) {
        return err("conflict", "That category is already allocated in this period.");
      }
      throw error;
    }
    return ok({ allocationId: id });
  },

  async deleteAllocation(
    db: Db,
    userId: string,
    allocationId: string,
  ): Promise<Result<{ deleted: true }>> {
    const [existing] = await db
      .select()
      .from(budgetAllocations)
      .where(and(eq(budgetAllocations.id, allocationId), eq(budgetAllocations.userId, userId)))
      .limit(1);
    if (!existing) return err("not_found", "That allocation doesn’t exist.");
    await db.transaction(async (tx) => {
      await tx.delete(budgetAllocations).where(eq(budgetAllocations.id, allocationId));
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "budget_allocation.deleted",
        entityType: "budget_allocation",
        entityId: allocationId,
        diff: { categoryId: existing.categoryId, plannedMinor: existing.plannedMinor },
      });
    });
    return ok({ deleted: true as const });
  },

  /**
   * Copy the previous period's allocations into this one (skipping categories
   * already allocated). Rollover-in for the copies follows the same
   * once-computed rule as lazy carry, and only when the periods are adjacent.
   */
  async copyPreviousPeriod(
    db: Db,
    userId: string,
    periodId: string,
  ): Promise<Result<{ copied: number }>> {
    const period = await getOwnedPeriod(db, userId, periodId);
    if (!period) return err("not_found", "That budget period doesn’t exist.");
    const budgetRaw = await getOwnedBudget(db, userId, period.budgetId);
    if (!budgetRaw) return err("not_found", "That budget doesn’t exist.");
    const budget = toBudgetRow(budgetRaw);

    const [prev] = await db
      .select()
      .from(budgetPeriods)
      .where(
        and(
          eq(budgetPeriods.budgetId, period.budgetId),
          lt(budgetPeriods.periodStart, period.periodStart),
        ),
      )
      .orderBy(desc(budgetPeriods.periodStart))
      .limit(1);
    if (!prev) return err("not_found", "There’s no earlier period to copy from.");

    const prevAllocations = await db
      .select()
      .from(budgetAllocations)
      .where(eq(budgetAllocations.budgetPeriodId, prev.id));
    if (prevAllocations.length === 0) {
      return err("not_found", "The previous period has no allocations to copy.");
    }
    const current = await db
      .select({ categoryId: budgetAllocations.categoryId })
      .from(budgetAllocations)
      .where(eq(budgetAllocations.budgetPeriodId, periodId));
    const existingIds = new Set(current.map((c) => c.categoryId));
    const toCopy = prevAllocations.filter((a) => !existingIds.has(a.categoryId));
    if (toCopy.length === 0) return ok({ copied: 0 });

    const adjacent = prev.periodEnd === addDaysIso(period.periodStart, -1);
    const prevSpend = adjacent
      ? await spendingByCategory(db, userId, budget.currency, {
          periodStart: prev.periodStart,
          periodEnd: prev.periodEnd,
        })
      : new Map<string | null, { postedMinor: number; pendingMinor: number }>();

    let copied = 0;
    await db.transaction(async (tx) => {
      for (const allocation of toCopy) {
        const rollsOver = budget.mode === "rollover" || allocation.rolloverEnabled;
        const rolloverIn =
          rollsOver && adjacent
            ? rolloverOutMinor({
                availableMinor: availableMinor(allocation.plannedMinor, allocation.rolloverInMinor),
                postedMinor: prevSpend.get(allocation.categoryId)?.postedMinor ?? 0,
                carryNegative: budget.carryNegative,
              })
            : 0;
        await tx.insert(budgetAllocations).values({
          id: uuidv7(),
          budgetPeriodId: periodId,
          userId,
          categoryId: allocation.categoryId,
          plannedMinor: allocation.plannedMinor,
          rolloverInMinor: rolloverIn,
          rolloverEnabled: allocation.rolloverEnabled,
          notes: allocation.notes,
        });
        copied += 1;
      }
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "budget_period.copied",
        entityType: "budget_period",
        entityId: periodId,
        diff: { fromPeriodId: prev.id, copied },
      });
    });
    return ok({ copied });
  },

  async updatePeriodMeta(
    db: Db,
    userId: string,
    periodId: string,
    patch: { notes?: string | null; expectedIncomeMinor?: number | null },
  ): Promise<Result<{ updated: true }>> {
    if (patch.expectedIncomeMinor !== undefined && patch.expectedIncomeMinor !== null) {
      assertSafeMinor(patch.expectedIncomeMinor);
      if (patch.expectedIncomeMinor < 0) {
        return err("invalid_input", "Expected income can’t be negative.");
      }
    }
    const period = await getOwnedPeriod(db, userId, periodId);
    if (!period) return err("not_found", "That budget period doesn’t exist.");
    await db.transaction(async (tx) => {
      await tx
        .update(budgetPeriods)
        .set({
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.expectedIncomeMinor !== undefined
            ? { expectedIncomeMinor: patch.expectedIncomeMinor }
            : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(budgetPeriods.id, periodId));
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "budget_period.updated",
        entityType: "budget_period",
        entityId: periodId,
        diff: { changed: Object.keys(patch) },
      });
    });
    return ok({ updated: true as const });
  },
} as const;
