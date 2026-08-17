import { describe, expect, test } from "vitest";

import {
  analyzeAmounts,
  annualizedMinor,
  classifyIntervals,
  confidenceBp,
  findClusters,
  inQuietHours,
  nextExpected,
  normalizeSeriesKey,
} from ".";

describe("normalizeSeriesKey", () => {
  test("uppercases, strips reference codes and digit runs, collapses spaces", () => {
    expect(normalizeSeriesKey("SPOTIFY P2E4A8")).toBe("SPOTIFY");
    expect(normalizeSeriesKey("SPAYLATER INSTALMENT 4821")).toBe("SPAYLATER INSTALMENT");
    expect(normalizeSeriesKey("Unifi  Home ")).toBe("UNIFI HOME");
    expect(normalizeSeriesKey("APPLE.COM/BILL ICLOUD")).toBe("APPLE.COM/BILL ICLOUD");
  });

  test("same series with varying refs normalizes identically", () => {
    expect(normalizeSeriesKey("SPOTIFY P2E4A8")).toBe(normalizeSeriesKey("SPOTIFY Q9Z112"));
  });
});

describe("classifyIntervals", () => {
  test("monthly bills classify with day-of-month drift tolerated", () => {
    expect(
      classifyIntervals(["2026-03-05", "2026-04-05", "2026-05-06", "2026-06-05", "2026-07-05"]),
    ).toMatchObject({ frequency: "monthly" });
  });

  test("weekly and biweekly bands", () => {
    expect(
      classifyIntervals(["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22"]),
    ).toMatchObject({ frequency: "weekly" });
    expect(
      classifyIntervals(["2026-06-01", "2026-06-15", "2026-06-29", "2026-07-13"]),
    ).toMatchObject({ frequency: "biweekly" });
  });

  test("quarterly needs three occurrences; annual accepts two", () => {
    expect(classifyIntervals(["2026-01-10", "2026-04-10", "2026-07-11"])).toMatchObject({
      frequency: "quarterly",
    });
    expect(classifyIntervals(["2025-08-20", "2026-08-20"])).toMatchObject({
      frequency: "annual",
    });
  });

  test("irregular gaps or too few occurrences return null", () => {
    expect(classifyIntervals(["2026-01-01", "2026-01-20", "2026-03-14"])).toBeNull();
    expect(classifyIntervals(["2026-01-01", "2026-02-01"])).toBeNull(); // 1 interval, not annual
    expect(classifyIntervals(["2026-05-05"])).toBeNull();
  });
});

describe("nextExpected", () => {
  test("monthly advances a month, clamping short months", () => {
    expect(nextExpected("2026-07-31", "monthly")).toBe("2026-08-31");
    expect(nextExpected("2026-01-31", "monthly")).toBe("2026-02-28");
  });

  test("weekly, biweekly, quarterly, annual", () => {
    expect(nextExpected("2026-08-10", "weekly")).toBe("2026-08-17");
    expect(nextExpected("2026-08-10", "biweekly")).toBe("2026-08-24");
    expect(nextExpected("2026-08-10", "quarterly")).toBe("2026-11-10");
    expect(nextExpected("2024-02-29", "annual")).toBe("2025-02-28");
  });
});

describe("analyzeAmounts (magnitudes in minor units, oldest → newest)", () => {
  test("stable series: typical is the amount, tight tolerance, no price change", () => {
    const result = analyzeAmounts([12900, 12900, 12900, 12900]);
    expect(result).toMatchObject({ typicalMinor: 12900, stable: true });
    expect(result.priceChange).toBeUndefined();
    expect(result.toleranceMinor).toBe(1290); // 10% default floor
  });

  test("a sustained new price is evidence-backed, not noise", () => {
    // RM 16.90 ×5 → RM 23.90 ×2 (the Spotify story).
    const result = analyzeAmounts([1690, 1690, 1690, 1690, 1690, 2390, 2390]);
    expect(result.typicalMinor).toBe(2390);
    expect(result.priceChange).toEqual({
      previousMinor: 1690,
      currentMinor: 2390,
      previousCount: 5,
      currentCount: 2,
    });
  });

  test("a single deviating charge is NOT a price change", () => {
    const result = analyzeAmounts([1690, 1690, 1690, 1690, 2390]);
    expect(result.priceChange).toBeUndefined();
  });

  test("noisy series is flagged unstable with a spread tolerance", () => {
    const result = analyzeAmounts([5000, 9000, 14000, 6500]);
    expect(result.stable).toBe(false);
    expect(result.toleranceMinor).toBeGreaterThan(3000);
  });
});

describe("confidenceBp (documented deterministic formula, capped below certainty)", () => {
  test("more observations, tighter intervals, stable amounts → higher confidence", () => {
    const high = confidenceBp({ occurrences: 8, intervalDeviationDays: 1, amountStable: true });
    const low = confidenceBp({ occurrences: 3, intervalDeviationDays: 5, amountStable: false });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(9500); // only user confirmation is certain
    expect(low).toBeGreaterThanOrEqual(4000);
  });
});

describe("annualizedMinor", () => {
  test("multiplies by cycle count", () => {
    expect(annualizedMinor(2390, "monthly")).toBe(28680);
    expect(annualizedMinor(10000, "weekly")).toBe(520000);
    expect(annualizedMinor(30000, "quarterly")).toBe(120000);
    expect(annualizedMinor(138000, "annual")).toBe(138000);
  });
});

describe("findClusters", () => {
  test("three bills within five days form a cluster with a total", () => {
    const clusters = findClusters(
      [
        { date: "2026-09-01", amountMinor: 160000 },
        { date: "2026-09-03", amountMinor: 12900 },
        { date: "2026-09-05", amountMinor: 6000 },
        { date: "2026-09-20", amountMinor: 5490 },
      ],
      5,
      3,
    );
    expect(clusters).toEqual([
      { start: "2026-09-01", end: "2026-09-05", count: 3, totalMinor: 178900 },
    ]);
  });

  test("fewer than the minimum is no cluster", () => {
    expect(
      findClusters(
        [
          { date: "2026-09-01", amountMinor: 1000 },
          { date: "2026-09-02", amountMinor: 1000 },
        ],
        5,
        3,
      ),
    ).toEqual([]);
  });
});

describe("inQuietHours", () => {
  test("windows crossing midnight", () => {
    expect(inQuietHours("23:15", "22:00", "08:00")).toBe(true);
    expect(inQuietHours("07:59", "22:00", "08:00")).toBe(true);
    expect(inQuietHours("12:00", "22:00", "08:00")).toBe(false);
  });

  test("same-day windows and unset hours", () => {
    expect(inQuietHours("13:00", "12:00", "14:00")).toBe(true);
    expect(inQuietHours("15:00", "12:00", "14:00")).toBe(false);
    expect(inQuietHours("03:00", null, null)).toBe(false);
  });
});
