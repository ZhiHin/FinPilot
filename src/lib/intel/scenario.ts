/**
 * Scenario simulation (spec Journey 4, UX 4.6): deterministic what-if math
 * over the SAME forecast engine as the Overview projection. Events transform
 * the projected occurrence list; the transformed inputs run through
 * `computeCashFlowForecast`, so band ordering (conservative <= expected <=
 * optimistic) holds by construction for every scenario.
 *
 * The binding invariant (spec V1): this module is pure — it never sees a
 * database. Simulation reads projected inputs and returns numbers; nothing
 * here can alter real balances, budgets, or goals.
 *
 * Event semantics (documented, unit-tested):
 * - one_time_expense / emergency_expense: a single confirmed outflow of
 *   |amountMinor| on effectiveOn.
 * - income_change: signed monthly delta applied to projected INFLOW
 *   occurrences on/after effectiveOn (all income patterns, or only
 *   refs.patternId when given). Amounts floor at zero.
 * - rent_change: refs.patternId required; that pattern's projected OUTFLOW
 *   occurrences on/after effectiveOn become params.newAmountMinor (or shift
 *   by the signed amountMinor delta). Amounts floor at zero.
 * - cancel_recurring: refs.patternId required; drops that pattern's
 *   occurrences on/after effectiveOn.
 * - add_installment: params.months confirmed monthly outflows of
 *   |amountMinor| starting effectiveOn (BNPL/loan modelling).
 * - savings_change: signed monthly cash-flow delta from saving more (+ =
 *   more set aside = monthly outflow) or less (- = cash freed = monthly
 *   inflow), starting effectiveOn. Goal contributions do not move real money
 *   (Phase 5 invariant) — this models the cash the user intends to set aside.
 */

import {
  computeCashFlowForecast,
  type ForecastInputs,
  type ForecastPoint,
  type ForecastResult,
  type ProjectedOccurrence,
} from "@/lib/intel/forecast";
import { nextExpected } from "@/lib/recurrence";

export type ScenarioEventType =
  | "one_time_expense"
  | "income_change"
  | "rent_change"
  | "cancel_recurring"
  | "add_installment"
  | "savings_change"
  | "emergency_expense";

export interface SimEvent {
  eventType: ScenarioEventType;
  effectiveOn: string;
  /** Signed minor units; magnitude for expenses/installments, delta for changes. */
  amountMinor: number | null;
  refs: { patternId?: string; categoryId?: string; goalId?: string };
  params: { months?: number; newAmountMinor?: number };
}

/** Monthly synthetic occurrences from `from` (inclusive) to `to`, capped. */
function monthlyDates(from: string, to: string, cap: number): string[] {
  const dates: string[] = [];
  let cursor = from;
  for (let i = 0; i < cap && cursor <= to; i++) {
    dates.push(cursor);
    cursor = nextExpected(cursor, "monthly");
  }
  return dates;
}

/** Apply scenario events to a projected occurrence list (pure; input unchanged). */
export function applyScenarioEvents(
  occurrences: ProjectedOccurrence[],
  events: SimEvent[],
  window: { today: string; horizonEnd: string },
): ProjectedOccurrence[] {
  let result = occurrences.map((o) => ({ ...o }));
  for (const event of events) {
    const from = event.effectiveOn;
    switch (event.eventType) {
      case "one_time_expense":
      case "emergency_expense": {
        const amount = Math.abs(event.amountMinor ?? 0);
        if (amount > 0 && from > window.today && from <= window.horizonEnd) {
          result.push({
            date: from,
            amountMinor: amount,
            toleranceMinor: 0,
            confirmed: true,
            direction: "outflow",
          });
        }
        break;
      }
      case "income_change": {
        const delta = event.amountMinor ?? 0;
        result = result.map((o) =>
          o.direction === "inflow" &&
          o.date >= from &&
          (!event.refs.patternId || o.patternId === event.refs.patternId)
            ? { ...o, amountMinor: Math.max(o.amountMinor + delta, 0) }
            : o,
        );
        break;
      }
      case "rent_change": {
        if (!event.refs.patternId) break;
        result = result.map((o) => {
          if (o.direction !== "outflow" || o.date < from || o.patternId !== event.refs.patternId) {
            return o;
          }
          const next =
            event.params.newAmountMinor != null
              ? event.params.newAmountMinor
              : o.amountMinor + (event.amountMinor ?? 0);
          return { ...o, amountMinor: Math.max(next, 0) };
        });
        break;
      }
      case "cancel_recurring": {
        if (!event.refs.patternId) break;
        result = result.filter((o) => !(o.patternId === event.refs.patternId && o.date >= from));
        break;
      }
      case "add_installment": {
        const amount = Math.abs(event.amountMinor ?? 0);
        const months = Math.max(event.params.months ?? 1, 1);
        if (amount === 0) break;
        for (const date of monthlyDates(from, window.horizonEnd, months)) {
          if (date > window.today) {
            result.push({
              date,
              amountMinor: amount,
              toleranceMinor: 0,
              confirmed: true,
              direction: "outflow",
            });
          }
        }
        break;
      }
      case "savings_change": {
        const delta = event.amountMinor ?? 0;
        if (delta === 0) break;
        for (const date of monthlyDates(from, window.horizonEnd, 120)) {
          if (date > window.today) {
            result.push({
              date,
              amountMinor: Math.abs(delta),
              toleranceMinor: 0,
              confirmed: true,
              direction: delta > 0 ? "outflow" : "inflow",
            });
          }
        }
        break;
      }
    }
  }
  return result;
}

export interface ScenarioSimulation {
  baseline: ForecastResult;
  scenario: ForecastResult;
  /** Expected-path delta at the horizon end (scenario minus baseline). */
  endDeltaMinor: number;
}

/** Run baseline and scenario through the same engine over shared inputs. */
export function simulateScenario(base: ForecastInputs, events: SimEvent[]): ScenarioSimulation {
  const horizonEnd = ((): string => {
    let d = base.today;
    for (let i = 0; i < base.horizonDays; i++) d = nextDay(d);
    return d;
  })();
  const baseline = computeCashFlowForecast(base);
  const scenario = computeCashFlowForecast({
    ...base,
    occurrences: applyScenarioEvents(base.occurrences, events, { today: base.today, horizonEnd }),
  });
  const last = scenario.series.length - 1;
  return {
    baseline,
    scenario,
    endDeltaMinor:
      last >= 0 ? scenario.series[last].expectedMinor - baseline.series[last].expectedMinor : 0,
  };
}

function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Earliest date on which making a one-time purchase keeps the remaining
 * conservative path at or above the buffer (suffix minima, integer math —
 * the same rule as the Phase 8 affordability tool).
 */
export function earliestSaferDate(
  series: ForecastPoint[],
  amountMinor: number,
  bufferMinor: number,
): string | null {
  if (series.length === 0) return null;
  const suffixMin: number[] = new Array(series.length);
  for (let i = series.length - 1; i >= 0; i--) {
    suffixMin[i] = Math.min(
      series[i].conservativeMinor,
      i + 1 < series.length ? suffixMin[i + 1] : series[i].conservativeMinor,
    );
  }
  for (let i = 0; i < series.length; i++) {
    if (suffixMin[i] - amountMinor >= bufferMinor) return series[i].date;
  }
  return null;
}
