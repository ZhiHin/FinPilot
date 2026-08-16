/**
 * Money is always integer minor units (sen for MYR) — ADR-003.
 * This module is the only place amounts are parsed from or formatted to strings;
 * float-shaped APIs (parseFloat, toFixed) are lint-banned everywhere else.
 */

const CURRENCY_EXPONENT: Record<string, number> = {
  MYR: 2,
  SGD: 2,
  USD: 2,
  EUR: 2,
  JPY: 0,
};

const DEFAULT_LOCALE = "en-MY";

function exponentFor(currency: string): number {
  return CURRENCY_EXPONENT[currency] ?? 2;
}

/** Throws unless the value is a safe integer amount of minor units. */
export function assertSafeMinor(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`Money must be a safe integer of minor units, got: ${amountMinor}`);
  }
}

/**
 * Formats minor units as a localized currency string, e.g. 123456 → "RM 1,234.56".
 * Integer and fraction digits are derived with integer arithmetic; Intl only renders.
 */
export function formatMinor(
  amountMinor: number,
  currency: string,
  locale: string = DEFAULT_LOCALE,
): string {
  assertSafeMinor(amountMinor);
  const exponent = exponentFor(currency);
  const factor = 10 ** exponent;
  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const major = (abs - (abs % factor)) / factor;
  const fraction = String(abs % factor).padStart(exponent, "0");

  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });
  const rendered = formatter
    .formatToParts(major)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
  return negative ? `-${rendered}` : rendered;
}

const AMOUNT_PATTERN = /^(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?$/;

/**
 * Parses a user-entered amount ("1,234.56", "RM 32.50", "-8.20") into minor units.
 * Returns null for anything ambiguous or with excess decimal places. Integer math only.
 */
export function parseAmountToMinor(input: string, currency: string = "MYR"): number | null {
  const exponent = exponentFor(currency);
  const factor = 10 ** exponent;

  let s = input.trim();
  if (s === "") return null;

  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  }
  // Optional currency prefix such as "RM" / "MYR".
  s = s.replace(/^[A-Za-z]{1,3}\s*/, "");
  if (s === "" || !AMOUNT_PATTERN.test(s)) return null;

  const [intPart, fracPart = ""] = s.replaceAll(",", "").split(".");
  if (fracPart.length > exponent) return null;

  const minor =
    Number(intPart) * factor + (exponent > 0 ? Number(fracPart.padEnd(exponent, "0") || "0") : 0);
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/** Minor units → plain magnitude string for form inputs ("3250" → "32.50"). */
export function minorToAmountInput(amountMinor: number, currency: string = "MYR"): string {
  assertSafeMinor(amountMinor);
  const exponent = exponentFor(currency);
  const factor = 10 ** exponent;
  const abs = Math.abs(amountMinor);
  const major = (abs - (abs % factor)) / factor;
  if (exponent === 0) return String(major);
  return `${major}.${String(abs % factor).padStart(exponent, "0")}`;
}

/** Sums minor units, throwing if any input or the running total leaves the safe range. */
export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    assertSafeMinor(value);
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError("Money sum exceeded the safe integer range");
    }
  }
  return total;
}

/**
 * Splits a total into parts proportional to `ratios` using the largest-remainder
 * method. The parts always sum exactly to the total (invariant for transaction splits).
 */
export function allocateMinor(totalMinor: number, ratios: readonly number[]): number[] {
  assertSafeMinor(totalMinor);
  if (ratios.length === 0) {
    throw new Error("allocateMinor requires at least one ratio");
  }
  if (ratios.some((r) => !Number.isFinite(r) || r < 0)) {
    throw new Error("Ratios must be non-negative finite numbers");
  }
  const totalRatio = ratios.reduce((a, b) => a + b, 0);
  if (totalRatio <= 0) {
    throw new Error("At least one ratio must be positive");
  }

  const negative = totalMinor < 0;
  const abs = Math.abs(totalMinor);
  const shares = ratios.map((r) => Math.floor((abs * r) / totalRatio));
  let remainder = abs - shares.reduce((a, b) => a + b, 0);

  const byLargestRemainder = ratios
    .map((r, index) => ({ remainder: (abs * r) % totalRatio, index }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byLargestRemainder) {
    if (remainder === 0) break;
    shares[index] += 1;
    remainder -= 1;
  }

  return negative ? shares.map((s) => -s) : shares;
}
