/** "2026-06" → "Jun 26" for axis ticks (presentation only). */
export function shortMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return `${new Intl.DateTimeFormat("en-MY", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, m - 1, 15)),
  )} ${String(year).slice(2)}`;
}

/** "2026-06" → "June 2026" for tables and tooltips. */
export function longMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, m - 1, 15)));
}

/** Basis points → "75.0%" (integer math; presentation only). */
export function formatBp(bp: number): string {
  const negative = bp < 0;
  const abs = Math.abs(bp);
  const whole = (abs - (abs % 100)) / 100;
  const tenth = Math.round((abs % 100) / 10);
  const rendered = tenth === 10 ? `${whole + 1}.0` : `${whole}.${tenth}`;
  return `${negative ? "-" : ""}${rendered}%`;
}
