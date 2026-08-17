import { describe, expect, test } from "vitest";

import { elapsedBp, nextWindow, prevWindow, resolveWindow, windowForStart } from ".";

const CAL = { type: "calendar_month" as const, anchor: null };
const PAYDAY_25 = { type: "payday" as const, anchor: { day: 25, weekendAdjust: true } };
const PAYDAY_25_RAW = { type: "payday" as const, anchor: { day: 25, weekendAdjust: false } };
const PAYDAY_LAST = {
  type: "payday" as const,
  anchor: { day: "last" as const, weekendAdjust: true },
};

describe("calendar-month cycles", () => {
  test("the window containing a date is its calendar month", () => {
    expect(resolveWindow(CAL, "2026-08-17")).toEqual({
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });
  });

  test("next and previous windows are adjacent months", () => {
    const aug = resolveWindow(CAL, "2026-08-17");
    expect(nextWindow(CAL, aug)).toEqual({ periodStart: "2026-09-01", periodEnd: "2026-09-30" });
    expect(prevWindow(CAL, aug)).toEqual({ periodStart: "2026-07-01", periodEnd: "2026-07-31" });
  });

  test("February and leap years are handled", () => {
    expect(resolveWindow(CAL, "2028-02-10")).toEqual({
      periodStart: "2028-02-01",
      periodEnd: "2028-02-29",
    });
  });
});

describe("payday cycles (day 25)", () => {
  // 25 Jul 2026 is a Saturday → weekend-adjusted payday is Friday 24 Jul.
  // 25 Aug 2026 is a Tuesday → unadjusted.
  test("weekend paydays move to the preceding Friday", () => {
    expect(resolveWindow(PAYDAY_25, "2026-08-17")).toEqual({
      periodStart: "2026-07-24",
      periodEnd: "2026-08-24",
    });
  });

  test("without weekend adjustment the raw day is used", () => {
    expect(resolveWindow(PAYDAY_25_RAW, "2026-08-17")).toEqual({
      periodStart: "2026-07-25",
      periodEnd: "2026-08-24",
    });
  });

  test("a date on payday itself starts a new window", () => {
    // 25 Aug 2026 (Tue) starts the window that runs to 24 Sep (25 Sep 2026 is a Friday).
    expect(resolveWindow(PAYDAY_25, "2026-08-25")).toEqual({
      periodStart: "2026-08-25",
      periodEnd: "2026-09-24",
    });
  });

  test("a date the day before an adjusted payday belongs to the earlier window", () => {
    // Adjusted July payday = 24 Jul, so 23 Jul is still in the June window
    // (25 Jun 2026 is a Thursday → unadjusted).
    expect(resolveWindow(PAYDAY_25, "2026-07-23")).toEqual({
      periodStart: "2026-06-25",
      periodEnd: "2026-07-23",
    });
  });

  test("next and previous windows chain without gaps or overlaps", () => {
    const current = resolveWindow(PAYDAY_25, "2026-08-17");
    const next = nextWindow(PAYDAY_25, current);
    const prev = prevWindow(PAYDAY_25, current);
    expect(next.periodStart).toBe("2026-08-25");
    expect(prev.periodEnd).toBe("2026-07-23");
    // Adjacency: each window starts the day after the previous one ends.
    expect(next.periodStart > current.periodEnd).toBe(true);
    expect(current.periodStart > prev.periodEnd).toBe(true);
  });

  test('"last day" anchors use the final day of each month', () => {
    // 31 Aug 2026 is a Monday → unadjusted; 30 Sep 2026 is a Wednesday.
    expect(resolveWindow(PAYDAY_LAST, "2026-09-15")).toEqual({
      periodStart: "2026-08-31",
      periodEnd: "2026-09-29",
    });
  });

  test("windowForStart reconstructs the same window from its start date", () => {
    const window = resolveWindow(PAYDAY_25, "2026-08-17");
    expect(windowForStart(PAYDAY_25, window.periodStart)).toEqual(window);
    const cal = resolveWindow(CAL, "2026-08-17");
    expect(windowForStart(CAL, cal.periodStart)).toEqual(cal);
  });
});

describe("elapsedBp", () => {
  test("proportion of the cycle that has passed, inclusive of today", () => {
    // 31-day August: day 17 → 17/31.
    expect(elapsedBp({ periodStart: "2026-08-01", periodEnd: "2026-08-31" }, "2026-08-17")).toBe(
      Math.round((17 * 10000) / 31),
    );
  });

  test("clamps before the start and after the end", () => {
    const window = { periodStart: "2026-08-01", periodEnd: "2026-08-31" };
    expect(elapsedBp(window, "2026-07-20")).toBe(0);
    expect(elapsedBp(window, "2026-09-05")).toBe(10000);
  });

  test("the final day of the cycle is 100%", () => {
    expect(elapsedBp({ periodStart: "2026-08-01", periodEnd: "2026-08-31" }, "2026-08-31")).toBe(
      10000,
    );
  });
});
