/**
 * Merchant normalization (deterministic heuristics, no ML):
 * turns noisy statement descriptors ("GRABFOOD*KL 1234", "TNG-EWALLET*SEVEN
 * ELEVEN") into a stable per-user key plus a display name, without destroying
 * the original description (which is stored untouched on the transaction).
 */

const CHANNEL_SEGMENTS = new Set([
  "TNG-EWALLET",
  "TNG EWALLET",
  "DUITNOW",
  "FPX",
  "MB2U",
  "M2U",
  "MAE",
  "POS",
  "QR",
  "IBG",
  "CIMB CLICKS",
  "CIMBCLICKS",
]);

const CHANNEL_LEADING_TOKENS = new Set([
  "POS",
  "DUITNOW",
  "QR",
  "DR",
  "CR",
  "FPX",
  "MB2U",
  "M2U",
  "MAE",
]);

function cleanSegmentTokens(segment: string): string[] {
  let tokens = segment
    .replace(/[_/#]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 0 && CHANNEL_LEADING_TOKENS.has(tokens[0].toUpperCase())) {
    tokens = tokens.slice(1);
  }
  // Trailing reference/branch tokens contain digits ("1234", "SS2"); a leading
  // digit token can be part of the brand ("99 Speedmart"), so only trim from the end.
  while (tokens.length > 0 && /\d/.test(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }
  return tokens;
}

function bestSegmentTokens(raw: string): string[] {
  const segments = raw
    .split("*")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !CHANNEL_SEGMENTS.has(s.toUpperCase().replace(/\s+/g, " ")));

  let best: string[] = [];
  for (const segment of segments) {
    const tokens = cleanSegmentTokens(segment);
    if (tokens.join(" ").length > best.join(" ").length) {
      best = tokens;
    }
  }
  return best;
}

/** Stable lowercase matching key; empty string when nothing merchant-like remains. */
export function normalizeMerchantKey(raw: string): string {
  return bestSegmentTokens(raw).join(" ").toLowerCase();
}

/** Display name: title-cased, short all-caps brand tokens (KFC, IKEA→Ikea? no: ≤3) kept. */
export function canonicalMerchantName(raw: string): string {
  return bestSegmentTokens(raw)
    .map((token) => {
      if (token.length <= 3 && /^[A-Z]+$/.test(token)) return token;
      const lower = token.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
