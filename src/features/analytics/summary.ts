import { formatIsoDate } from "@/lib/dates";
import { changeBp } from "@/server/services/analytics";
import { formatBp } from "@/components/charts/format";

/** "2026-08-01".."2026-08-17" → "1 Aug 2026 – 17 Aug 2026 (in progress)". */
export function periodDisplayLabel(dateFrom: string, dateTo: string, incomplete: boolean): string {
  const range = `${formatIsoDate(dateFrom, "en-MY")} – ${formatIsoDate(dateTo, "en-MY")}`;
  return incomplete ? `${range} (in progress)` : range;
}

/**
 * Screen-reader-friendly comparison text. Zero baseline never renders a
 * percentage — "New — no activity in the previous period" instead.
 */
export function comparisonText(current: number, previous: number): string {
  const bp = changeBp(current, previous);
  if (bp === null) {
    return current === 0
      ? "No activity in either period"
      : "New — no activity in the previous period";
  }
  if (bp === 0) return "Unchanged from the previous period";
  const direction = bp > 0 ? "up" : "down";
  return `${direction} ${formatBp(Math.abs(bp))} vs the previous period`;
}
