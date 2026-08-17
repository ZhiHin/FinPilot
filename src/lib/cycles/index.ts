/**
 * Budget-cycle resolution (Phase 5). Pure calendar math over "YYYY-MM-DD"
 * strings — callers derive "today" in the user's timezone, so cycle
 * boundaries are timezone-aware without this module touching clock state.
 *
 * Cycle kinds (ERD `budgets.cycle_type` + `cycle_anchor`):
 * - calendar_month: [1st, last day] of each month.
 * - payday: each window runs from one (adjusted) payday to the day before the
 *   next. Anchor day is 1–28 or "last"; with weekendAdjust a Saturday/Sunday
 *   payday moves back to the preceding Friday (the approved onboarding
 *   pattern). Holiday adjustment is deferred — no approved holiday source.
 */

import { addDaysIso, isValidIsoDate } from "@/lib/dates";

export interface CycleAnchor {
  day: number | "last";
  weekendAdjust: boolean;
}

export interface CycleSpec {
  type: "calendar_month" | "payday";
  anchor: CycleAnchor | null;
}

export interface CycleWindow {
  periodStart: string;
  periodEnd: string;
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

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** 0 = Sunday … 6 = Saturday. */
function weekday(isoDate: string): number {
  const { year, month, day } = parts(isoDate);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The (possibly weekend-adjusted) payday for a given calendar month. */
export function paydayFor(year: number, month: number, anchor: CycleAnchor): string {
  const day = anchor.day === "last" ? daysInMonth(year, month) : anchor.day;
  let date = `${year}-${pad(month)}-${pad(day)}`;
  if (anchor.weekendAdjust) {
    const dow = weekday(date);
    if (dow === 6) date = addDaysIso(date, -1); // Saturday → Friday
    if (dow === 0) date = addDaysIso(date, -2); // Sunday → Friday
  }
  return date;
}

function assertPayday(spec: CycleSpec): CycleAnchor {
  if (!spec.anchor) throw new Error("payday cycle requires an anchor");
  return spec.anchor;
}

/** The cycle window containing `date` (inclusive on both ends). */
export function resolveWindow(spec: CycleSpec, date: string): CycleWindow {
  if (!isValidIsoDate(date)) throw new Error(`Invalid date: ${date}`);
  const { year, month } = parts(date);
  if (spec.type === "calendar_month") {
    return {
      periodStart: `${year}-${pad(month)}-01`,
      periodEnd: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`,
    };
  }
  const anchor = assertPayday(spec);
  // Candidate paydays around the date; the window starts at the latest payday ≤ date.
  for (const delta of [1, 0, -1]) {
    const m = shiftMonth(year, month, delta);
    const start = paydayFor(m.year, m.month, anchor);
    if (start <= date) {
      const nextMonth = shiftMonth(m.year, m.month, 1);
      const nextStart = paydayFor(nextMonth.year, nextMonth.month, anchor);
      return { periodStart: start, periodEnd: addDaysIso(nextStart, -1) };
    }
  }
  throw new Error(`Could not resolve a payday window for ${date}`);
}

/** Rebuild a window from its stored start date (period navigation, lazy creation). */
export function windowForStart(spec: CycleSpec, periodStart: string): CycleWindow {
  return resolveWindow(spec, periodStart);
}

export function nextWindow(spec: CycleSpec, window: CycleWindow): CycleWindow {
  return resolveWindow(spec, addDaysIso(window.periodEnd, 1));
}

export function prevWindow(spec: CycleSpec, window: CycleWindow): CycleWindow {
  return resolveWindow(spec, addDaysIso(window.periodStart, -1));
}

/**
 * How much of the cycle has elapsed, in basis points (0–10000), counting today
 * as a full day — on the last day of the cycle this is exactly 10000.
 */
export function elapsedBp(window: CycleWindow, today: string): number {
  if (today < window.periodStart) return 0;
  if (today >= window.periodEnd) return 10000;
  const dayNumber = (isoDate: string): number => {
    const { year, month, day } = parts(isoDate);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  const total = dayNumber(window.periodEnd) - dayNumber(window.periodStart) + 1;
  const elapsed = dayNumber(today) - dayNumber(window.periodStart) + 1;
  return Math.round((elapsed * 10_000) / total);
}
