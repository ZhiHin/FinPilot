import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { formatIsoDate, isValidIsoDate } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import type { ForecastResult } from "@/lib/intel/forecast";
import { earliestSaferDate, simulateScenario, type SimEvent } from "@/lib/intel/scenario";
import { formatMinor } from "@/lib/money";
import { err, ok, type Result } from "@/lib/result";
import type { Db } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import {
  categories,
  recurringPatterns,
  savingsGoals,
  scenarioEvents,
  scenarios,
} from "@/server/db/schema";
import { budgetsService } from "@/server/services/budgets";
import { computeGoalOutlook, goalsService } from "@/server/services/goals";
import { gatherForecastInputs } from "@/server/services/intel";

/**
 * Scenario Lab (spec Journey 4, UX 4.6, ADR — same engine as the Overview
 * forecast via `gatherForecastInputs`). THE BINDING INVARIANT (spec V1):
 * `simulate`/`compare` write NOTHING — not even the forecast cache. The only
 * writes in this module touch `scenarios`/`scenario_events`, and saving is an
 * explicit user action. Real balances, budgets, and goals are never altered.
 */

export type ScenarioRow = typeof scenarios.$inferSelect;
export type ScenarioEventRow = typeof scenarioEvents.$inferSelect;

const isoDate = z.string().refine(isValidIsoDate, "Invalid date.");
const minorAmount = z.number().int().min(-100_000_000_00).max(100_000_000_00);

/** Per-type validation: which refs/params each event type requires. */
const eventSchema = z.discriminatedUnion("eventType", [
  z.object({
    eventType: z.literal("one_time_expense"),
    effectiveOn: isoDate,
    amountMinor: minorAmount.refine((v) => v > 0, "Amount must be positive."),
    categoryId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    eventType: z.literal("emergency_expense"),
    effectiveOn: isoDate,
    amountMinor: minorAmount.refine((v) => v > 0, "Amount must be positive."),
    categoryId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    eventType: z.literal("income_change"),
    effectiveOn: isoDate,
    amountMinor: minorAmount.refine((v) => v !== 0, "Delta cannot be zero."),
    patternId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    eventType: z.literal("rent_change"),
    effectiveOn: isoDate,
    newAmountMinor: minorAmount.refine((v) => v >= 0, "Amount cannot be negative."),
    patternId: z.string().uuid(),
  }),
  z.object({
    eventType: z.literal("cancel_recurring"),
    effectiveOn: isoDate,
    patternId: z.string().uuid(),
  }),
  z.object({
    eventType: z.literal("add_installment"),
    effectiveOn: isoDate,
    amountMinor: minorAmount.refine((v) => v > 0, "Amount must be positive."),
    months: z.number().int().min(1).max(60),
  }),
  z.object({
    eventType: z.literal("savings_change"),
    effectiveOn: isoDate,
    amountMinor: minorAmount.refine((v) => v !== 0, "Delta cannot be zero."),
    goalId: z.string().uuid().nullable().optional(),
  }),
]);

export type ScenarioEventInput = z.input<typeof eventSchema>;

export interface ImpactGoal {
  goalId: string;
  name: string;
  note: string;
}

export interface ImpactBudget {
  categoryName: string;
  note: string;
}

export interface ScenarioSimulationView {
  currency: string;
  bufferMinor: number;
  horizonDays: number;
  scenario: ForecastResult;
  baseline: ForecastResult;
  endDeltaMinor: number;
  saferDate: string | null;
  largestPurchaseMinor: number | null;
  affectedGoals: ImpactGoal[];
  budgetRisks: ImpactBudget[];
  assumptions: string[];
}

function toSimEvent(row: ScenarioEventRow): SimEvent {
  const refs = (row.refs ?? {}) as { patternId?: string; categoryId?: string; goalId?: string };
  const params = (row.params ?? {}) as { months?: number; newAmountMinor?: number };
  return {
    eventType: row.eventType,
    effectiveOn: row.effectiveOn,
    amountMinor: row.amountMinor === null ? null : Number(row.amountMinor),
    refs,
    params: {
      months: params.months,
      newAmountMinor: params.newAmountMinor != null ? Number(params.newAmountMinor) : undefined,
    },
  };
}

async function loadOwnedScenario(
  db: Db,
  userId: string,
  scenarioId: string,
): Promise<ScenarioRow | null> {
  const [row] = await db
    .select()
    .from(scenarios)
    .where(
      and(eq(scenarios.id, scenarioId), eq(scenarios.userId, userId), isNull(scenarios.deletedAt)),
    )
    .limit(1);
  return row ?? null;
}

export const scenariosService = {
  async list(db: Db, userId: string): Promise<ScenarioRow[]> {
    return db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.userId, userId), isNull(scenarios.deletedAt)))
      .orderBy(desc(scenarios.updatedAt));
  },

  async get(
    db: Db,
    userId: string,
    scenarioId: string,
  ): Promise<Result<{ scenario: ScenarioRow; events: ScenarioEventRow[] }>> {
    const scenario = await loadOwnedScenario(db, userId, scenarioId);
    if (!scenario) return err("not_found", "Scenario not found.");
    const events = await db
      .select()
      .from(scenarioEvents)
      .where(eq(scenarioEvents.scenarioId, scenarioId))
      .orderBy(asc(scenarioEvents.effectiveOn), asc(scenarioEvents.createdAt));
    return ok({ scenario, events });
  },

  /** New scenarios start as drafts; saving with a name is the explicit action. */
  async createDraft(db: Db, userId: string): Promise<Result<{ id: string }>> {
    const id = uuidv7();
    await db.insert(scenarios).values({ id, userId, name: "Untitled scenario", status: "draft" });
    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: "scenario.draft_created",
      entityType: "scenario",
      entityId: id,
    });
    return ok({ id });
  },

  async addEvent(
    db: Db,
    userId: string,
    scenarioId: string,
    input: ScenarioEventInput,
  ): Promise<Result<{ id: string }>> {
    const scenario = await loadOwnedScenario(db, userId, scenarioId);
    if (!scenario) return err("not_found", "Scenario not found.");
    if (scenario.status === "archived") return err("invalid_input", "Scenario is archived.");
    const parsed = eventSchema.safeParse(input);
    if (!parsed.success) {
      return err("invalid_input", parsed.error.issues[0]?.message ?? "Invalid event.");
    }
    const value = parsed.data;

    // Referenced real entities must belong to the caller (fail closed).
    if ("patternId" in value && value.patternId) {
      const [pattern] = await db
        .select({ id: recurringPatterns.id })
        .from(recurringPatterns)
        .where(and(eq(recurringPatterns.id, value.patternId), eq(recurringPatterns.userId, userId)))
        .limit(1);
      if (!pattern) return err("not_found", "Recurring pattern not found.");
    }
    if ("categoryId" in value && value.categoryId) {
      const [category] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, value.categoryId), eq(categories.userId, userId)))
        .limit(1);
      if (!category) return err("not_found", "Category not found.");
    }
    if ("goalId" in value && value.goalId) {
      const [goal] = await db
        .select({ id: savingsGoals.id })
        .from(savingsGoals)
        .where(and(eq(savingsGoals.id, value.goalId), eq(savingsGoals.userId, userId)))
        .limit(1);
      if (!goal) return err("not_found", "Goal not found.");
    }

    const id = uuidv7();
    await db.insert(scenarioEvents).values({
      id,
      scenarioId,
      userId,
      eventType: value.eventType,
      effectiveOn: value.effectiveOn,
      amountMinor:
        value.eventType === "rent_change" || value.eventType === "cancel_recurring"
          ? null
          : value.amountMinor,
      refs: {
        ...("patternId" in value && value.patternId ? { patternId: value.patternId } : {}),
        ...("categoryId" in value && value.categoryId ? { categoryId: value.categoryId } : {}),
        ...("goalId" in value && value.goalId ? { goalId: value.goalId } : {}),
      },
      params: {
        ...("months" in value ? { months: value.months } : {}),
        ...("newAmountMinor" in value ? { newAmountMinor: value.newAmountMinor } : {}),
      },
    });
    await db.update(scenarios).set({ updatedAt: new Date() }).where(eq(scenarios.id, scenarioId));
    return ok({ id });
  },

  async removeEvent(
    db: Db,
    userId: string,
    scenarioId: string,
    eventId: string,
  ): Promise<Result<null>> {
    const deleted = await db
      .delete(scenarioEvents)
      .where(
        and(
          eq(scenarioEvents.id, eventId),
          eq(scenarioEvents.scenarioId, scenarioId),
          eq(scenarioEvents.userId, userId),
        ),
      )
      .returning({ id: scenarioEvents.id });
    if (deleted.length === 0) return err("not_found", "Event not found.");
    await db
      .update(scenarios)
      .set({ updatedAt: new Date() })
      .where(and(eq(scenarios.id, scenarioId), eq(scenarios.userId, userId)));
    return ok(null);
  },

  /** The explicit save action (UX 4.6): names the draft and marks it saved. */
  async save(
    db: Db,
    userId: string,
    scenarioId: string,
    input: { name: string; description?: string },
  ): Promise<Result<null>> {
    const name = input.name.trim();
    if (name.length === 0 || name.length > 80) {
      return err("invalid_input", "Give the scenario a name (up to 80 characters).");
    }
    const scenario = await loadOwnedScenario(db, userId, scenarioId);
    if (!scenario) return err("not_found", "Scenario not found.");
    try {
      await db
        .update(scenarios)
        .set({
          name,
          description: input.description?.trim() || null,
          status: "saved",
          baseSnapshotAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(scenarios.id, scenarioId), eq(scenarios.userId, userId)));
    } catch {
      return err("conflict", `You already have a saved scenario named “${name}”.`);
    }
    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: "scenario.saved",
      entityType: "scenario",
      entityId: scenarioId,
      diff: { name },
    });
    return ok(null);
  },

  async archive(db: Db, userId: string, scenarioId: string): Promise<Result<null>> {
    const updated = await db
      .update(scenarios)
      .set({ status: "archived", updatedAt: new Date() })
      .where(
        and(
          eq(scenarios.id, scenarioId),
          eq(scenarios.userId, userId),
          isNull(scenarios.deletedAt),
        ),
      )
      .returning({ id: scenarios.id });
    if (updated.length === 0) return err("not_found", "Scenario not found.");
    return ok(null);
  },

  async softDelete(db: Db, userId: string, scenarioId: string): Promise<Result<null>> {
    const updated = await db
      .update(scenarios)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(scenarios.id, scenarioId),
          eq(scenarios.userId, userId),
          isNull(scenarios.deletedAt),
        ),
      )
      .returning({ id: scenarios.id });
    if (updated.length === 0) return err("not_found", "Scenario not found.");
    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: "scenario.deleted",
      entityType: "scenario",
      entityId: scenarioId,
    });
    return ok(null);
  },

  /**
   * Deterministic simulation — READS ONLY (spec V1). Baseline and scenario
   * run through the same engine over the same gathered inputs; the forecast
   * cache is deliberately not consulted and not written.
   */
  async simulate(
    db: Db,
    userId: string,
    scenarioId: string,
    input: { today: string; horizonDays?: 30 | 60 | 90 },
  ): Promise<Result<ScenarioSimulationView>> {
    if (!isValidIsoDate(input.today)) return err("invalid_input", "Invalid date.");
    const horizonDays = input.horizonDays ?? 90;
    const loaded = await this.get(db, userId, scenarioId);
    if (!loaded.ok) return loaded;
    const events = loaded.data.events.map(toSimEvent);

    const gathered = await gatherForecastInputs(db, userId, { today: input.today, horizonDays });
    const sim = simulateScenario(gathered.inputs, events);

    // Earliest safer purchase date for the largest one-time expense: the
    // scenario WITHOUT that purchase, asked "when could it be absorbed?".
    const purchases = events.filter(
      (e) =>
        (e.eventType === "one_time_expense" || e.eventType === "emergency_expense") &&
        (e.amountMinor ?? 0) > 0,
    );
    let saferDate: string | null = null;
    let largestPurchaseMinor: number | null = null;
    if (purchases.length > 0) {
      const largest = purchases.reduce((a, b) =>
        (a.amountMinor ?? 0) >= (b.amountMinor ?? 0) ? a : b,
      );
      largestPurchaseMinor = largest.amountMinor ?? 0;
      const without = simulateScenario(
        gathered.inputs,
        events.filter((e) => e !== largest),
      );
      saferDate = earliestSaferDate(
        without.scenario.series,
        largestPurchaseMinor,
        gathered.bufferMinor,
      );
    }

    // Affected goals: savings_change deltas shift the projected completion
    // month; a conservative dip under the buffer puts scheduled contributions
    // at risk. Deterministic rules only — no speculation.
    const goals = await goalsService.listWithProgress(db, userId, input.today);
    const affectedGoals: ImpactGoal[] = [];
    for (const event of events) {
      if (event.eventType !== "savings_change") continue;
      const targets = event.refs.goalId
        ? goals.filter((g) => g.id === event.refs.goalId)
        : goals.filter((g) => g.status === "active");
      for (const goal of targets) {
        const before = goal.outlook;
        const after = computeGoalOutlook({
          targetMinor: goal.targetAmountMinor,
          savedMinor: goal.savedMinor,
          targetDate: goal.targetDate,
          monthlyRateMinor: Math.max(before.monthlyRateMinor + (event.amountMinor ?? 0), 0),
          today: input.today,
        });
        if (after.estimatedCompletionMonth !== before.estimatedCompletionMonth) {
          affectedGoals.push({
            goalId: goal.id,
            name: goal.name,
            note:
              after.estimatedCompletionMonth === null
                ? "Would stop progressing at this contribution rate."
                : `Estimated completion moves ${before.estimatedCompletionMonth ?? "never"} to ${after.estimatedCompletionMonth}.`,
          });
        }
      }
    }
    if (sim.scenario.lowestConservative.balanceMinor < gathered.bufferMinor) {
      for (const goal of goals.filter(
        (g) => g.status === "active" && (g.contributionSchedule?.amountMinor ?? 0) > 0,
      )) {
        if (affectedGoals.some((a) => a.goalId === goal.id)) continue;
        affectedGoals.push({
          goalId: goal.id,
          name: goal.name,
          note: `Scheduled contributions may be at risk around ${formatIsoDate(sim.scenario.lowestConservative.date, "en-MY")} (conservative path dips under your buffer).`,
        });
      }
    }

    // Budget risk: one-time expenses with a category, landing in the current
    // cycle of the active budget, checked against the remaining allocation.
    const budgetRisks: ImpactBudget[] = [];
    const budgets = await budgetsService.list(db, userId);
    const activeBudget = budgets.find((b) => b.isActive && b.currency === gathered.currency);
    if (activeBudget) {
      const report = await budgetsService.periodReport(db, userId, {
        budgetId: activeBudget.id,
        today: input.today,
      });
      if (report.ok) {
        for (const event of purchases) {
          if (!event.refs.categoryId) continue;
          if (
            event.effectiveOn < report.data.period.periodStart ||
            event.effectiveOn > report.data.period.periodEnd
          ) {
            continue;
          }
          const allocation = report.data.allocations.find(
            (a) => a.categoryId === event.refs.categoryId,
          );
          if (!allocation) continue;
          const amount = event.amountMinor ?? 0;
          budgetRisks.push({
            categoryName: allocation.categoryName,
            note:
              amount > allocation.remainingMinor
                ? `Would exceed this cycle's ${allocation.categoryName} allocation by ${formatMinor(amount - allocation.remainingMinor, gathered.currency)}.`
                : `Fits within the ${formatMinor(allocation.remainingMinor, gathered.currency)} remaining in ${allocation.categoryName} this cycle.`,
          });
        }
      }
    }

    return ok({
      currency: gathered.currency,
      bufferMinor: gathered.bufferMinor,
      horizonDays,
      scenario: sim.scenario,
      baseline: sim.baseline,
      endDeltaMinor: sim.endDeltaMinor,
      saferDate,
      largestPurchaseMinor,
      affectedGoals,
      budgetRisks,
      assumptions: [
        `Baseline: the Overview projection method (recurring+baseline v1) over ${gathered.patterns.length} active recurring pattern(s) plus your typical non-recurring spending.`,
        "Savings changes model cash set aside each month; goal contributions never move real money.",
        "Simulation only — no real records are read-modified or written.",
      ],
    });
  },

  /** Two saved scenarios over one shared baseline (UX 4.6 compare view). */
  async compare(
    db: Db,
    userId: string,
    aId: string,
    bId: string,
    input: { today: string; horizonDays?: 30 | 60 | 90 },
  ): Promise<
    Result<{
      a: { scenario: ScenarioRow; view: ScenarioSimulationView };
      b: { scenario: ScenarioRow; view: ScenarioSimulationView };
    }>
  > {
    if (aId === bId) return err("invalid_input", "Pick two different scenarios.");
    const [a, b] = await Promise.all([this.get(db, userId, aId), this.get(db, userId, bId)]);
    if (!a.ok) return a;
    if (!b.ok) return b;
    const [viewA, viewB] = [
      await this.simulate(db, userId, aId, input),
      await this.simulate(db, userId, bId, input),
    ];
    if (!viewA.ok) return viewA;
    if (!viewB.ok) return viewB;
    return ok({
      a: { scenario: a.data.scenario, view: viewA.data },
      b: { scenario: b.data.scenario, view: viewB.data },
    });
  },
};
