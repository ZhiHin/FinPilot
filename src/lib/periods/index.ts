/**
 * Reporting-period math for the dashboard and analytics workspace.
 *
 * All inputs and outputs are plain "YYYY-MM-DD" calendar dates — callers derive
 * "today" from the user's timezone (lib/dates localDateInTz) so every boundary
 * here is timezone-aware without this module touching Date-now state.
 *
 * Comparison rule (Phase 4 acceptance criteria): comparisons are equal-length.
 * Whole-calendar-month windows compare in calendar months (July vs June — the
 * natural MoM reading); month-to-date compares the same days into the previous
 * month (clamped to shorter months); any other range compares to the
 * equal-day-length window immediately before it.
 */

import { addDaysIso, isValidIsoDate } from "@/lib/dates";

export type PeriodKey =
  "this-month" | "last-month" | "last-3-months" | "this-year" | "last-12-months";

export const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string }> = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "last-3-months", label: "Last 3 months" },
  { key: "this-year", label: "This year" },
  { key: "last-12-months", label: "Last 12 months" },
];

export interface ResolvedPeriod {
  key: PeriodKey;
  dateFrom: string;
  dateTo: string;
  /** True when the window ends today or later — label it "to date" in UI. */
  incomplete: boolean;
}

export interface DateRange {
  dateFrom: string;
  dateTo: string;
}

function parts(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split("-").map(Number);
  return { year, month, day };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstOfMonth(year: number, month: number): string {
  return `${year}-${pad(month)}-01`;
}

function lastOfMonth(year: number, month: number): string {
  return `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
}

/** Shift a (year, month) pair by a number of months. */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function isCompleteThrough(dateTo: string, today: string): boolean {
  return dateTo < today;
}

export function resolvePeriod(key: string, today: string): ResolvedPeriod {
  const { year, month } = parts(today);
  switch (key) {
    case "last-month": {
      const prev = shiftMonth(year, month, -1);
      return {
        key,
        dateFrom: firstOfMonth(prev.year, prev.month),
        dateTo: lastOfMonth(prev.year, prev.month),
        incomplete: false,
      };
    }
    case "last-3-months": {
      const start = shiftMonth(year, month, -2);
      return {
        key,
        dateFrom: firstOfMonth(start.year, start.month),
        dateTo: today,
        incomplete: true,
      };
    }
    case "this-year":
      return { key, dateFrom: `${year}-01-01`, dateTo: today, incomplete: true };
    case "last-12-months": {
      const start = shiftMonth(year, month, -11);
      return {
        key,
        dateFrom: firstOfMonth(start.year, start.month),
        dateTo: today,
        incomplete: true,
      };
    }
    case "this-month":
    default:
      return {
        key: "this-month",
        dateFrom: firstOfMonth(year, month),
        dateTo: today,
        incomplete: today < lastOfMonth(year, month),
      };
  }
}

/** The equal-length period immediately before [dateFrom, dateTo] (see module doc). */
export function previousPeriod(dateFrom: string, dateTo: string): DateRange {
  const from = parts(dateFrom);
  const to = parts(dateTo);
  const startsOnFirst = from.day === 1;

  if (startsOnFirst) {
    const monthCount = to.year * 12 + to.month - (from.year * 12 + from.month) + 1;
    const prevStart = shiftMonth(from.year, from.month, -monthCount);
    const prevEnd = shiftMonth(to.year, to.month, -monthCount);
    if (to.day === daysInMonth(to.year, to.month)) {
      // Whole calendar months → the preceding whole-months window.
      return {
        dateFrom: firstOfMonth(prevStart.year, prevStart.month),
        dateTo: lastOfMonth(prevEnd.year, prevEnd.month),
      };
    }
    // Month-to-date → same days into the earlier month(s), clamped.
    return {
      dateFrom: firstOfMonth(prevStart.year, prevStart.month),
      dateTo: `${prevEnd.year}-${pad(prevEnd.month)}-${pad(
        Math.min(to.day, daysInMonth(prevEnd.year, prevEnd.month)),
      )}`,
    };
  }

  // Arbitrary range → strict equal day count ending the day before it starts.
  const lengthDays =
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      86_400_000 +
    1;
  const prevTo = addDaysIso(dateFrom, -1);
  return { dateFrom: addDaysIso(prevTo, -(lengthDays - 1)), dateTo: prevTo };
}

/** The same range one year earlier (Feb 29 clamps to Feb 28). */
export function yearAgoPeriod(dateFrom: string, dateTo: string): DateRange {
  const shift = (isoDate: string): string => {
    const { year, month, day } = parts(isoDate);
    return `${year - 1}-${pad(month)}-${pad(Math.min(day, daysInMonth(year - 1, month)))}`;
  };
  return { dateFrom: shift(dateFrom), dateTo: shift(dateTo) };
}

/** The window covering the `months` calendar months ending with `dateTo`'s month. */
export function shiftRangeMonthsBack(dateTo: string, months: number): DateRange {
  const { year, month } = parts(dateTo);
  const start = shiftMonth(year, month, -(months - 1));
  return { dateFrom: firstOfMonth(start.year, start.month), dateTo };
}

/** Every "YYYY-MM" calendar month covered by the range, in order. */
export function enumerateMonths(dateFrom: string, dateTo: string): string[] {
  if (!isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) {
    throw new Error(`Invalid range: ${dateFrom}..${dateTo}`);
  }
  const from = parts(dateFrom);
  const to = parts(dateTo);
  const months: string[] = [];
  let cursor = { year: from.year, month: from.month };
  while (cursor.year < to.year || (cursor.year === to.year && cursor.month <= to.month)) {
    months.push(`${cursor.year}-${pad(cursor.month)}`);
    cursor = shiftMonth(cursor.year, cursor.month, 1);
  }
  return months;
}
