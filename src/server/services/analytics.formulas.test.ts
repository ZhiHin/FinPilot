import { describe, expect, test } from "vitest";

import { changeBp, savingsMinor, savingsRateBp } from "./analytics";

describe("savings formulas (the only implementation in the codebase)", () => {
  test("savings = income − expense", () => {
    expect(savingsMinor(500000, 125000)).toBe(375000);
    expect(savingsMinor(0, 125000)).toBe(-125000);
  });

  test("savings rate in basis points", () => {
    expect(savingsRateBp(500000, 375000)).toBe(7500); // 75.00%
    expect(savingsRateBp(300000, 150000)).toBe(5000);
    expect(savingsRateBp(300000, -60000)).toBe(-2000); // overspending → negative rate
  });

  test("zero or negative income yields null, never a percentage", () => {
    expect(savingsRateBp(0, -50000)).toBeNull();
    expect(savingsRateBp(-10000, -10000)).toBeNull();
  });
});

describe("comparison change", () => {
  test("percentage change vs baseline in basis points", () => {
    expect(changeBp(110000, 100000)).toBe(1000); // +10.00%
    expect(changeBp(90000, 100000)).toBe(-1000);
    expect(changeBp(50000, -100000)).toBe(15000); // baseline negative: magnitude-based
  });

  test("zero baseline yields null so the UI can say 'no previous activity'", () => {
    expect(changeBp(50000, 0)).toBeNull();
  });
});
