import { describe, expect, test } from "vitest";

import { ANOMALY_MIN_DELTA_MINOR, detectSpendAnomaly, robustZ } from "./anomaly";
import {
  computeCashFlowForecast,
  projectOccurrences,
  robustBaseline,
  type ForecastInputs,
} from "./forecast";

describe("projectOccurrences", () => {
  test("projects monthly patterns across the horizon, excluding the start day", () => {
    const occurrences = projectOccurrences(
      [
        {
          nextExpectedOn: "2026-09-01",
          frequency: "monthly",
          typicalAmountMinor: 160000,
          amountToleranceMinor: 0,
          confirmed: true,
          direction: "outflow",
        },
      ],
      "2026-08-17",
      "2026-11-16",
    );
    expect(occurrences.map((o) => o.date)).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
  });

  test("weekly patterns produce every occurrence; custom is skipped", () => {
    const weekly = projectOccurrences(
      [
        {
          nextExpectedOn: "2026-08-20",
          frequency: "weekly",
          typicalAmountMinor: 5000,
          amountToleranceMinor: 500,
          confirmed: false,
          direction: "outflow",
        },
        {
          nextExpectedOn: "2026-08-21",
          frequency: "custom",
          typicalAmountMinor: 1,
          amountToleranceMinor: 0,
          confirmed: false,
          direction: "outflow",
        },
      ],
      "2026-08-17",
      "2026-09-16",
    );
    expect(weekly.map((o) => o.date)).toEqual([
      "2026-08-20",
      "2026-08-27",
      "2026-09-03",
      "2026-09-10",
    ]);
  });
});

describe("robustBaseline", () => {
  test("median/percentile weekly sums become daily bands", () => {
    // Weekly non-recurring outflows: 700, 1400, 2100, 2800 (RM).
    const bands = robustBaseline([70000, 140000, 210000, 280000]);
    expect(bands.expectedDailyMinor).toBe(25000); // median 175,000 ÷ 7
    expect(bands.conservativeDailyMinor).toBeGreaterThan(bands.expectedDailyMinor);
    expect(bands.optimisticDailyMinor).toBeLessThan(bands.expectedDailyMinor);
  });

  test("no history yields zero baselines, never fake spending", () => {
    expect(robustBaseline([])).toEqual({
      expectedDailyMinor: 0,
      conservativeDailyMinor: 0,
      optimisticDailyMinor: 0,
    });
  });
});

describe("computeCashFlowForecast", () => {
  const INPUTS: ForecastInputs = {
    startBalanceMinor: 852000,
    today: "2026-08-17",
    horizonDays: 30,
    occurrences: [
      {
        date: "2026-08-25",
        amountMinor: 520000,
        toleranceMinor: 0,
        confirmed: true,
        direction: "inflow",
      },
      {
        date: "2026-09-01",
        amountMinor: 160000,
        toleranceMinor: 0,
        confirmed: true,
        direction: "outflow",
      },
      {
        date: "2026-09-05",
        amountMinor: 12900,
        toleranceMinor: 1300,
        confirmed: false,
        direction: "outflow",
      },
    ],
    baseline: {
      expectedDailyMinor: 8000,
      conservativeDailyMinor: 11000,
      optimisticDailyMinor: 5000,
    },
  };

  test("produces one point per day with bands ordered every single day (B2)", () => {
    const result = computeCashFlowForecast(INPUTS);
    expect(result.series.length).toBe(30);
    for (const point of result.series) {
      expect(point.conservativeMinor).toBeLessThanOrEqual(point.expectedMinor);
      expect(point.expectedMinor).toBeLessThanOrEqual(point.optimisticMinor);
    }
  });

  test("the expected path is exact arithmetic (every figure traceable)", () => {
    const result = computeCashFlowForecast(INPUTS);
    // Day 1 (18 Aug): 852,000 − 8,000 baseline = 844,000.
    expect(result.series[0]).toMatchObject({ date: "2026-08-18", expectedMinor: 844000 });
    // Payday 25 Aug: 852,000 − 8×8,000 + 520,000 = 1,308,000.
    const payday = result.series.find((p) => p.date === "2026-08-25");
    expect(payday?.expectedMinor).toBe(852000 - 8 * 8000 + 520000);
  });

  test("lowest points track the dip before payday", () => {
    const result = computeCashFlowForecast(INPUTS);
    expect(result.lowestExpected.date).toBe("2026-08-24"); // day before salary
    expect(result.lowestConservative.balanceMinor).toBeLessThanOrEqual(
      result.lowestExpected.balanceMinor,
    );
  });
});

describe("anomaly detection (robust z against the user's own baseline)", () => {
  test("a genuine spike over a stable baseline is flagged", () => {
    const verdict = detectSpendAnomaly(80000, [30000, 32000, 29000, 31000, 30500, 30000]);
    expect(verdict.isAnomaly).toBe(true);
    expect(verdict.z).toBeGreaterThan(3);
    expect(verdict.deltaMinor).toBeGreaterThanOrEqual(ANOMALY_MIN_DELTA_MINOR);
  });

  test("statistical outliers with tiny absolute deltas stay quiet", () => {
    // z is huge but the delta is RM 90 — below the material floor.
    const verdict = detectSpendAnomaly(10000, [1000, 1100, 1050, 950, 1000]);
    expect(verdict.deltaMinor).toBeLessThan(ANOMALY_MIN_DELTA_MINOR);
    expect(verdict.isAnomaly).toBe(false);
  });

  test("too little history means no verdict, never a guess", () => {
    expect(robustZ(50000, [30000, 31000])).toBeNull();
    expect(detectSpendAnomaly(50000, [30000, 31000]).isAnomaly).toBe(false);
  });

  test("decreases never alert", () => {
    const verdict = detectSpendAnomaly(1000, [30000, 32000, 29000, 31000, 30000]);
    expect(verdict.isAnomaly).toBe(false);
  });

  test("zero-variance history uses the fallback scale instead of dividing by zero", () => {
    const verdict = detectSpendAnomaly(90000, [30000, 30000, 30000, 30000]);
    expect(Number.isFinite(verdict.z!)).toBe(true);
    expect(verdict.isAnomaly).toBe(true);
  });
});
