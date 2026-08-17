/**
 * Deterministic recurrence math (Phase 6). Pure functions over calendar-date
 * strings and integer minor units — the detection service composes these; no
 * statistics library, no ML, every rule documented and unit-tested.
 */

import { addDaysIso } from "@/lib/dates";

export type RecurringFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

/** Uppercase, strip standalone digit/reference tokens and digit runs, collapse spaces. */
export function normalizeSeriesKey(description: string): string {
  return description
    .toUpperCase()
    .replace(/\b[A-Z]*\d[A-Z0-9]*\b/g, " ") // tokens containing digits (refs, ids)
    .replace(/\s+/g, " ")
    .trim();
}

function dayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Band per frequency: [min interval, max interval] in days + minimum occurrences. */
const BANDS: Array<{
  frequency: RecurringFrequency;
  min: number;
  max: number;
  minOccurrences: number;
}> = [
  { frequency: "weekly", min: 6, max: 8, minOccurrences: 3 },
  { frequency: "biweekly", min: 12, max: 16, minOccurrences: 3 },
  { frequency: "monthly", min: 27, max: 33, minOccurrences: 3 },
  { frequency: "quarterly", min: 84, max: 98, minOccurrences: 3 },
  { frequency: "annual", min: 350, max: 380, minOccurrences: 2 },
];

export interface IntervalClassification {
  frequency: RecurringFrequency;
  medianIntervalDays: number;
  /** Max |interval − median| across the series — regularity measure. */
  deviationDays: number;
}

/**
 * Classify sorted occurrence dates into a frequency band. Rules (documented):
 * the median interval must sit inside a band, at least 80% of individual
 * intervals must too, and the band's minimum occurrence count must be met.
 */
export function classifyIntervals(sortedDates: string[]): IntervalClassification | null {
  if (sortedDates.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < sortedDates.length; i++) {
    intervals.push(dayNumber(sortedDates[i]) - dayNumber(sortedDates[i - 1]));
  }
  const med = median(intervals);
  for (const band of BANDS) {
    if (med < band.min || med > band.max) continue;
    if (sortedDates.length < band.minOccurrences) continue;
    const inBand = intervals.filter((d) => d >= band.min && d <= band.max).length;
    if (inBand / intervals.length < 0.8) continue;
    const deviationDays = Math.max(...intervals.map((d) => Math.abs(d - med)));
    return { frequency: band.frequency, medianIntervalDays: med, deviationDays };
  }
  return null;
}

/** The next expected date after `lastSeen` (month math clamps short months). */
export function nextExpected(lastSeen: string, frequency: RecurringFrequency): string {
  if (frequency === "weekly") return addDaysIso(lastSeen, 7);
  if (frequency === "biweekly") return addDaysIso(lastSeen, 14);
  const [year, month, day] = lastSeen.split("-").map(Number);
  const monthsToAdd = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
  const index = year * 12 + (month - 1) + monthsToAdd;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const daysIn = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, daysIn)).padStart(2, "0")}`;
}

export interface AmountAnalysis {
  typicalMinor: number;
  toleranceMinor: number;
  /** All charges within 25% of the overall median. */
  stable: boolean;
  /** Sustained (≥2 charges) move to a new level, with evidence counts. */
  priceChange?: {
    previousMinor: number;
    currentMinor: number;
    previousCount: number;
    currentCount: number;
  };
}

/**
 * Analyze charge magnitudes (oldest → newest):
 * - typical = the latest amount; its trailing run = consecutive charges within
 *   2% of it.
 * - price change only when the trailing run has ≥2 charges AND ≥2 earlier
 *   charges sit ≥5% away — a single odd charge is never "a price change".
 * - tolerance = max(10% of typical, max deviation inside the trailing run);
 *   unstable series (any charge >25% from the overall median) widen it to the
 *   observed spread.
 */
export function analyzeAmounts(magnitudesMinor: number[]): AmountAnalysis {
  const latest = magnitudesMinor[magnitudesMinor.length - 1];
  let runStart = magnitudesMinor.length - 1;
  while (runStart > 0 && Math.abs(magnitudesMinor[runStart - 1] - latest) <= latest * 0.02) {
    runStart -= 1;
  }
  const run = magnitudesMinor.slice(runStart);
  const earlier = magnitudesMinor.slice(0, runStart);

  const overallMedian = median(magnitudesMinor);
  const stable = magnitudesMinor.every(
    (value) => Math.abs(value - overallMedian) <= overallMedian * 0.25,
  );

  let toleranceMinor = Math.max(
    Math.round(latest * 0.1),
    ...run.map((value) => Math.abs(value - latest)),
  );
  if (!stable) {
    toleranceMinor = Math.max(
      toleranceMinor,
      ...magnitudesMinor.map((value) => Math.abs(value - overallMedian)),
    );
  }

  const analysis: AmountAnalysis = { typicalMinor: latest, toleranceMinor, stable };
  if (run.length >= 2 && earlier.length >= 2) {
    const previous = median(earlier);
    if (Math.abs(latest - previous) > previous * 0.05) {
      analysis.priceChange = {
        previousMinor: previous,
        currentMinor: latest,
        previousCount: earlier.length,
        currentCount: run.length,
      };
    }
  }
  return analysis;
}

/**
 * Confidence in basis points. Documented formula, capped at 9500 — only the
 * user's own confirmation reaches certainty:
 *   4000 base + 500 × min(occurrences, 8)
 *   + 2000 if intervals deviate ≤ 2 days (1000 if ≤ 4)
 *   + 1000 if amounts are stable.
 */
export function confidenceBp(input: {
  occurrences: number;
  intervalDeviationDays: number;
  amountStable: boolean;
}): number {
  let score = 4000 + 500 * Math.min(input.occurrences, 8);
  if (input.intervalDeviationDays <= 2) score += 2000;
  else if (input.intervalDeviationDays <= 4) score += 1000;
  if (input.amountStable) score += 1000;
  return Math.min(score, 9500);
}

const CYCLES_PER_YEAR: Record<RecurringFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  annual: 1,
};

export function annualizedMinor(typicalMinor: number, frequency: RecurringFrequency): number {
  return typicalMinor * CYCLES_PER_YEAR[frequency];
}

export interface DueItem {
  date: string;
  amountMinor: number;
}

export interface Cluster {
  start: string;
  end: string;
  count: number;
  totalMinor: number;
}

/**
 * Greedy left-to-right scan for windows of ≥ minCount dues within windowDays
 * (inclusive); overlapping windows merge into the earliest cluster.
 */
export function findClusters(dues: DueItem[], windowDays: number, minCount: number): Cluster[] {
  const sorted = [...dues].sort((a, b) => a.date.localeCompare(b.date));
  const clusters: Cluster[] = [];
  let index = 0;
  while (index < sorted.length) {
    const windowEnd = dayNumber(sorted[index].date) + windowDays - 1;
    let last = index;
    while (last + 1 < sorted.length && dayNumber(sorted[last + 1].date) <= windowEnd) {
      last += 1;
    }
    const count = last - index + 1;
    if (count >= minCount) {
      clusters.push({
        start: sorted[index].date,
        end: sorted[last].date,
        count,
        totalMinor: sorted.slice(index, last + 1).reduce((sum, d) => sum + d.amountMinor, 0),
      });
      index = last + 1;
    } else {
      index += 1;
    }
  }
  return clusters;
}

/** Is HH:MM inside the quiet window? Handles windows crossing midnight. */
export function inQuietHours(
  time: string,
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  if (!start || !end) return false;
  if (start <= end) return time >= start && time < end;
  return time >= start || time < end; // crosses midnight
}
