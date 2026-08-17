import { describe, expect, test } from "vitest";

import { computeSafeToSpend, type StsInputs } from "./sts";

const BASE: StsInputs = {
  liquidMinor: 852000, // RM 8,520 liquid
  today: "2026-08-17",
  payday: "2026-08-25",
  expectedIncome: [],
  bills: [
    { name: "Netflix", amountMinor: 5490, toleranceMinor: 0, confirmed: true },
    { name: "iCloud", amountMinor: 1190, toleranceMinor: 200, confirmed: false },
  ],
  budgetCommittalMinor: 20000,
  goalContributionsDueMinor: 48000,
  safetyBufferMinor: 30000,
};

describe("computeSafeToSpend — the binding deterministic definition", () => {
  test("itemization equals the ledger math exactly (backlog acceptance)", () => {
    const result = computeSafeToSpend(BASE);
    const b = result.breakdown;
    expect(
      b.liquidMinor +
        b.incomeExpectedMinor -
        b.confirmedBillsMinor -
        b.predictedBillsMinor -
        b.budgetCommittalMinor -
        b.goalContributionsDueMinor -
        b.safetyBufferMinor,
    ).toBe(result.expected.untilPaydayMinor);
    expect(b.confirmedBillsMinor).toBe(5490);
    expect(b.predictedBillsMinor).toBe(1190);
    // 852000 − 5490 − 1190 − 20000 − 48000 − 30000 = 747,320
    expect(result.expected.untilPaydayMinor).toBe(747320);
  });

  test("bands are ordered conservative ≤ expected ≤ optimistic (B2)", () => {
    const result = computeSafeToSpend({
      ...BASE,
      expectedIncome: [
        { name: "Freelance", amountMinor: 130000, toleranceMinor: 20000, confirmed: false },
      ],
    });
    expect(result.conservative.untilPaydayMinor).toBeLessThanOrEqual(
      result.expected.untilPaydayMinor,
    );
    expect(result.expected.untilPaydayMinor).toBeLessThanOrEqual(
      result.optimistic.untilPaydayMinor,
    );
    // Conservative drops inferred income (130,000) and pads inferred bills by
    // their tolerance (+200).
    expect(result.expected.untilPaydayMinor - result.conservative.untilPaydayMinor).toBe(130200);
    // Optimistic adds income tolerance (+20,000) and trims inferred bills (−200).
    expect(result.optimistic.untilPaydayMinor - result.expected.untilPaydayMinor).toBe(20200);
  });

  test("uncertain income/bills produce a range; certainty collapses it (B1)", () => {
    const certain = computeSafeToSpend({
      ...BASE,
      bills: [{ name: "Netflix", amountMinor: 5490, toleranceMinor: 0, confirmed: true }],
    });
    expect(certain.isRange).toBe(false);
    const uncertain = computeSafeToSpend(BASE); // inferred iCloud has tolerance
    expect(uncertain.isRange).toBe(true);
  });

  test("today's figure divides the window and front-loads bills", () => {
    const result = computeSafeToSpend(BASE);
    // Window 17–24 Aug = 8 days including today.
    expect(result.daysToPayday).toBe(8);
    expect(result.expected.todayMinor).toBe(Math.floor(747320 / 8));
  });

  test("overcommitment is shown honestly as negative, never clamped", () => {
    const result = computeSafeToSpend({ ...BASE, liquidMinor: 50000 });
    expect(result.expected.untilPaydayMinor).toBeLessThan(0);
    expect(result.expected.todayMinor).toBeLessThan(0);
  });

  test("payday today or tomorrow keeps a minimum one-day window", () => {
    const result = computeSafeToSpend({ ...BASE, payday: "2026-08-18" });
    expect(result.daysToPayday).toBe(1);
    expect(result.expected.todayMinor).toBe(result.expected.untilPaydayMinor);
  });
});
