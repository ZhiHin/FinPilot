import { describe, expect, test } from "vitest";

import { allocateMinor, assertSafeMinor, formatMinor, parseAmountToMinor, sumMinor } from "./index";

// ICU (the ground truth for display formatting) separates "RM" from the digits with a
// non-breaking space (U+00A0) so amounts never wrap after the symbol.
const NBSP = " ";

describe("formatMinor", () => {
  test("formats positive MYR minor units with RM symbol and grouping", () => {
    expect(formatMinor(852000, "MYR")).toBe(`RM${NBSP}8,520.00`);
    expect(formatMinor(123456, "MYR")).toBe(`RM${NBSP}1,234.56`);
  });

  test("formats zero", () => {
    expect(formatMinor(0, "MYR")).toBe(`RM${NBSP}0.00`);
  });

  test("formats negative amounts with a leading minus", () => {
    expect(formatMinor(-3250, "MYR")).toBe(`-RM${NBSP}32.50`);
  });

  test("keeps exact cents for large amounts", () => {
    expect(formatMinor(999999999999, "MYR")).toBe(`RM${NBSP}9,999,999,999.99`);
  });

  test("rejects unsafe or fractional minor units", () => {
    expect(() => formatMinor(1.5, "MYR")).toThrow();
    expect(() => formatMinor(Number.MAX_SAFE_INTEGER + 1, "MYR")).toThrow();
  });
});

describe("parseAmountToMinor", () => {
  test("parses plain and grouped decimal strings", () => {
    expect(parseAmountToMinor("1,234.56")).toBe(123456);
    expect(parseAmountToMinor("8520")).toBe(852000);
    expect(parseAmountToMinor("32.5")).toBe(3250);
  });

  test("accepts an RM prefix and surrounding whitespace", () => {
    expect(parseAmountToMinor(" RM 1,234.56 ")).toBe(123456);
    expect(parseAmountToMinor("RM0.99")).toBe(99);
  });

  test("parses negative amounts", () => {
    expect(parseAmountToMinor("-32.50")).toBe(-3250);
    expect(parseAmountToMinor("-RM 32.50")).toBe(-3250);
  });

  test("rejects more than two decimal places", () => {
    expect(parseAmountToMinor("32.505")).toBeNull();
  });

  test("rejects garbage", () => {
    expect(parseAmountToMinor("")).toBeNull();
    expect(parseAmountToMinor("abc")).toBeNull();
    expect(parseAmountToMinor("12.3.4")).toBeNull();
    expect(parseAmountToMinor("1,23.45")).toBeNull();
  });
});

describe("sumMinor", () => {
  test("sums signed minor units", () => {
    expect(sumMinor([100, 200, -50])).toBe(250);
  });

  test("sums empty list to zero", () => {
    expect(sumMinor([])).toBe(0);
  });

  test("throws when the sum leaves the safe-integer range", () => {
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
});

describe("allocateMinor", () => {
  test("distributes remainder to earliest shares (largest remainder)", () => {
    expect(allocateMinor(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateMinor(101, [50, 50])).toEqual([51, 50]);
  });

  test("always sums exactly to the total", () => {
    const parts = allocateMinor(999, [3, 7, 11]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(999);
  });

  test("handles negative totals symmetrically", () => {
    expect(allocateMinor(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });

  test("rejects ratios that are all zero or negative", () => {
    expect(() => allocateMinor(100, [0, 0])).toThrow();
    expect(() => allocateMinor(100, [-1, 2])).toThrow();
    expect(() => allocateMinor(100, [])).toThrow();
  });
});

describe("assertSafeMinor", () => {
  test("accepts safe integers", () => {
    expect(() => assertSafeMinor(0)).not.toThrow();
    expect(() => assertSafeMinor(-42)).not.toThrow();
  });

  test("rejects fractions, NaN, and unsafe magnitudes", () => {
    expect(() => assertSafeMinor(1.01)).toThrow();
    expect(() => assertSafeMinor(Number.NaN)).toThrow();
    expect(() => assertSafeMinor(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});
