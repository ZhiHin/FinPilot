/**
 * Numeric-claim verification (spec B5): every RM amount and percentage in
 * generated text must match a verified deterministic value, or the text is
 * rejected and the caller falls back to the deterministic template. Pure and
 * unit-tested; golden wrong-number fixtures live in verify.test.ts.
 */

export interface ExtractedClaims {
  amountsMinor: number[];
  pctBp: number[];
}

const AMOUNT_PATTERN = /(-?)RM[\s ]?(-?)(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g;
const PCT_PATTERN = /(\d+(?:\.\d+)?)\s?%/g;

export function extractClaims(text: string): ExtractedClaims {
  const amountsMinor: number[] = [];
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const negative = match[1] === "-" || match[2] === "-";
    const whole = Number(match[3].replaceAll(",", ""));
    const cents = Number((match[4] ?? "0").padEnd(2, "0"));
    const minor = whole * 100 + cents;
    amountsMinor.push(negative ? -minor : minor);
  }
  const pctBp: number[] = [];
  for (const match of text.matchAll(PCT_PATTERN)) {
    pctBp.push(Math.round(Number(match[1]) * 100));
  }
  return { amountsMinor, pctBp };
}

export interface VerifiedNumbers {
  amountsMinor: number[];
  pctBp: number[];
}

export interface VerificationResult {
  ok: boolean;
  failures: string[];
}

/**
 * Percent tolerance: a claim stated to N decimal places may differ from a
 * verified value only by display rounding (half a unit in the last shown
 * digit) — 36.83% may be phrased as "37%" but never "38%".
 */
function pctMatches(claimBp: number, verifiedBp: number, claimText: string): boolean {
  const decimals = claimText.includes(".") ? claimText.split(".")[1].length : 0;
  const tolerance = decimals === 0 ? 50 : decimals === 1 ? 5 : 1;
  return Math.abs(claimBp - verifiedBp) <= tolerance;
}

export function verifyNumericClaims(text: string, verified: VerifiedNumbers): VerificationResult {
  const failures: string[] = [];
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const negative = match[1] === "-" || match[2] === "-";
    const whole = Number(match[3].replaceAll(",", ""));
    const cents = Number((match[4] ?? "0").padEnd(2, "0"));
    const minor = (negative ? -1 : 1) * (whole * 100 + cents);
    // Whole-ringgit phrasing of an exact amount ("RM 110" for RM 110.50) is
    // NOT accepted — amounts must match to the sen.
    if (!verified.amountsMinor.includes(minor)) {
      failures.push(`unverified amount ${match[0]} (${minor} minor)`);
    }
  }
  for (const match of text.matchAll(PCT_PATTERN)) {
    const claimBp = Math.round(Number(match[1]) * 100);
    if (!verified.pctBp.some((v) => pctMatches(claimBp, v, match[1]))) {
      failures.push(`unverified percentage ${match[0]}`);
    }
  }
  return { ok: failures.length === 0, failures };
}
