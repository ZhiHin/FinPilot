import { describe, expect, test } from "vitest";

import { extractClaims, verifyNumericClaims } from "./verify";

const NBSP = " ";

describe("extractClaims", () => {
  test("finds RM amounts (plain and NBSP-formatted) and percentages", () => {
    const claims = extractClaims(
      `Food rose from RM${NBSP}300.00 to RM 410.50 (+36%), about 12.3% of income.`,
    );
    expect(claims.amountsMinor).toEqual([30000, 41050]);
    expect(claims.pctBp).toEqual([3600, 1230]);
  });

  test("handles negatives and thousands grouping", () => {
    const claims = extractClaims(`Balance dips to -RM${NBSP}1,234.56 (a 100% drop).`);
    expect(claims.amountsMinor).toEqual([-123456]);
    expect(claims.pctBp).toEqual([10000]);
  });

  test("plain integers without currency or percent are not claims", () => {
    const claims = extractClaims("Over 3 charges in 2 months.");
    expect(claims.amountsMinor).toEqual([]);
    expect(claims.pctBp).toEqual([]);
  });
});

describe("verifyNumericClaims (spec B5 — every claim must match verified math)", () => {
  const verified = { amountsMinor: [30000, 41050, 11050], pctBp: [3683] };

  test("text whose numbers all match the verified set passes", () => {
    const result = verifyNumericClaims(
      `Spending rose from RM 300.00 to RM 410.50 — RM 110.50 more (37%).`,
      verified,
    );
    expect(result.ok).toBe(true);
  });

  test("a fabricated amount fails verification (golden wrong-number fixture)", () => {
    const result = verifyNumericClaims(`Spending rose to RM 999.99 this month.`, verified);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatch(/999\.99/);
  });

  test("a fabricated percentage fails verification", () => {
    const result = verifyNumericClaims(`That is an 80% increase.`, verified);
    expect(result.ok).toBe(false);
  });

  test("percent claims tolerate display rounding only", () => {
    // Verified 36.83% — "37%" (rounded) passes, "38%" does not.
    expect(verifyNumericClaims("Up 37% overall.", verified).ok).toBe(true);
    expect(verifyNumericClaims("Up 38% overall.", verified).ok).toBe(false);
  });

  test("text with no numeric claims passes trivially", () => {
    expect(verifyNumericClaims("Spending went up noticeably.", verified).ok).toBe(true);
  });
});
