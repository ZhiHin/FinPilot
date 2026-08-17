/**
 * Baseline exclusion math (spec V2): journal entries marked one-off remove
 * their period from history baselines. Deterministic date-interval work only —
 * the actual sums always come from the same analytics engine, run over the
 * remaining segments, so exclusion can never drift from the reporting rules.
 */

import { addDaysIso } from "@/lib/dates";

export interface DateWindow {
  start: string;
  /** Inclusive. */
  end: string;
}

/** True when the two inclusive windows share at least one day. */
export function windowsOverlap(a: DateWindow, b: DateWindow): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/**
 * The parts of `window` NOT covered by any exclusion (inclusive segments,
 * ascending, non-overlapping). An empty result means fully excluded.
 */
export function subtractExclusions(window: DateWindow, exclusions: DateWindow[]): DateWindow[] {
  const relevant = exclusions
    .filter((exclusion) => windowsOverlap(window, exclusion))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const segments: DateWindow[] = [];
  let cursor = window.start;
  for (const exclusion of relevant) {
    if (exclusion.start > cursor) {
      segments.push({ start: cursor, end: addDaysIso(exclusion.start, -1) });
    }
    const next = addDaysIso(exclusion.end, 1);
    if (next > cursor) cursor = next;
    if (cursor > window.end) return segments;
  }
  if (cursor <= window.end) segments.push({ start: cursor, end: window.end });
  return segments;
}
