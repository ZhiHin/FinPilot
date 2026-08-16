/**
 * Calendar-date helpers. Instants are stored in UTC; calendar dates are plain
 * "YYYY-MM-DD" strings interpreted in an explicit timezone (ADR / ERD conventions).
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar date of an instant in the given IANA timezone, as "YYYY-MM-DD". */
export function localDateInTz(instant: Date, timeZone: string): string {
  // en-CA renders dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** True only for well-formed, real calendar dates ("2026-02-30" is rejected). */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Adds (or subtracts) whole days to a calendar date. */
export function addDaysIso(isoDate: string, days: number): string {
  if (!isValidIsoDate(isoDate)) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Formats a calendar date for display, e.g. "2026-08-16" → "16 Aug 2026" (en-MY). */
export function formatIsoDate(isoDate: string, locale: string): string {
  if (!isValidIsoDate(isoDate)) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  const [year, month, day] = isoDate.split("-").map(Number);
  // Noon UTC + explicit UTC timezone: the calendar date can never shift while formatting.
  const instant = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(instant);
}
