/**
 * Cash-flow forecasting (spec A16): transparent statistical methods only —
 * recurring projection + robust baseline spend, three bands. No ML.
 *
 * Method (id `recurring+baseline`, v1 — referenced by forecasts.method):
 * - Recurring events are projected from active patterns' next-expected dates.
 * - Non-recurring spending burns down as a daily baseline derived from
 *   trailing weekly totals: expected = median ÷ 7, conservative = 75th
 *   percentile ÷ 7 (spends more), optimistic = 25th percentile ÷ 7.
 * - Per band, per day: balance += inflows − outflows − baseline.
 *   Conservative counts only confirmed inflows and pads outflows by their
 *   tolerance; optimistic adds inflow tolerance and trims inferred outflows.
 * - Band ordering conservative ≤ expected ≤ optimistic holds by construction
 *   every day (spec B2; asserted in tests and at the service boundary).
 */

import { addDaysIso } from "@/lib/dates";
import { nextExpected, type RecurringFrequency } from "@/lib/recurrence";

export interface ProjectedOccurrence {
  date: string;
  amountMinor: number;
  toleranceMinor: number;
  confirmed: boolean;
  direction: "inflow" | "outflow";
}

export interface ProjectablePattern {
  nextExpectedOn: string;
  frequency: RecurringFrequency | "custom";
  typicalAmountMinor: number;
  amountToleranceMinor: number;
  confirmed: boolean;
  direction: "inflow" | "outflow";
}

/** All occurrences of the patterns inside (from, to] — bounded projection. */
export function projectOccurrences(
  patterns: ProjectablePattern[],
  from: string,
  to: string,
): ProjectedOccurrence[] {
  const occurrences: ProjectedOccurrence[] = [];
  for (const pattern of patterns) {
    if (pattern.frequency === "custom") continue;
    let cursor = pattern.nextExpectedOn;
    for (let guard = 0; guard < 120 && cursor <= to; guard++) {
      if (cursor > from) {
        occurrences.push({
          date: cursor,
          amountMinor: pattern.typicalAmountMinor,
          toleranceMinor: pattern.amountToleranceMinor,
          confirmed: pattern.confirmed,
          direction: pattern.direction,
        });
      }
      cursor = nextExpected(cursor, pattern.frequency as RecurringFrequency);
    }
  }
  return occurrences;
}

export interface BaselineBands {
  expectedDailyMinor: number;
  conservativeDailyMinor: number;
  optimisticDailyMinor: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

/** Robust daily-outflow baseline from trailing weekly non-recurring totals. */
export function robustBaseline(weeklySumsMinor: number[]): BaselineBands {
  const sorted = [...weeklySumsMinor].sort((a, b) => a - b);
  return {
    expectedDailyMinor: Math.round(percentile(sorted, 0.5) / 7),
    conservativeDailyMinor: Math.round(percentile(sorted, 0.75) / 7),
    optimisticDailyMinor: Math.round(percentile(sorted, 0.25) / 7),
  };
}

export interface ForecastPoint {
  date: string;
  conservativeMinor: number;
  expectedMinor: number;
  optimisticMinor: number;
}

export interface ForecastInputs {
  startBalanceMinor: number;
  today: string;
  horizonDays: number;
  occurrences: ProjectedOccurrence[];
  baseline: BaselineBands;
}

export interface ForecastResult {
  series: ForecastPoint[];
  lowestExpected: { date: string; balanceMinor: number };
  lowestConservative: { date: string; balanceMinor: number };
}

export function computeCashFlowForecast(inputs: ForecastInputs): ForecastResult {
  const byDate = new Map<string, ProjectedOccurrence[]>();
  for (const occurrence of inputs.occurrences) {
    const list = byDate.get(occurrence.date) ?? [];
    list.push(occurrence);
    byDate.set(occurrence.date, list);
  }

  let conservative = inputs.startBalanceMinor;
  let expected = inputs.startBalanceMinor;
  let optimistic = inputs.startBalanceMinor;
  const series: ForecastPoint[] = [];
  let lowestExpected = { date: inputs.today, balanceMinor: expected };
  let lowestConservative = { date: inputs.today, balanceMinor: conservative };

  let date = inputs.today;
  for (let day = 1; day <= inputs.horizonDays; day++) {
    date = addDaysIso(date, 1);
    for (const occurrence of byDate.get(date) ?? []) {
      if (occurrence.direction === "inflow") {
        if (occurrence.confirmed) conservative += occurrence.amountMinor;
        expected += occurrence.amountMinor;
        optimistic += occurrence.amountMinor + occurrence.toleranceMinor;
      } else {
        conservative -= occurrence.amountMinor + occurrence.toleranceMinor;
        expected -= occurrence.amountMinor;
        optimistic -= occurrence.confirmed
          ? occurrence.amountMinor
          : Math.max(occurrence.amountMinor - occurrence.toleranceMinor, 0);
      }
    }
    conservative -= inputs.baseline.conservativeDailyMinor;
    expected -= inputs.baseline.expectedDailyMinor;
    optimistic -= inputs.baseline.optimisticDailyMinor;

    series.push({
      date,
      conservativeMinor: conservative,
      expectedMinor: expected,
      optimisticMinor: optimistic,
    });
    if (expected < lowestExpected.balanceMinor) {
      lowestExpected = { date, balanceMinor: expected };
    }
    if (conservative < lowestConservative.balanceMinor) {
      lowestConservative = { date, balanceMinor: conservative };
    }
  }
  return { series, lowestExpected, lowestConservative };
}
