import { describe, expect, test } from "vitest";

import {
  computeGoalOutlook,
  estimatedCompletionMonth,
  monthsUntil,
  progressBp,
  requiredMonthlyMinor,
} from "./goals";

const TODAY = "2026-08-17";

describe("goal arithmetic", () => {
  test("Goal progress = saved ÷ target, in basis points", () => {
    expect(progressBp(930000, 1500000)).toBe(6200); // 62%
    expect(progressBp(0, 1500000)).toBe(0);
    expect(progressBp(1600000, 1500000)).toBe(10667); // >100% allowed
  });

  test("months until a target date count calendar-month boundaries", () => {
    expect(monthsUntil(TODAY, "2026-12-01")).toBe(4);
    expect(monthsUntil(TODAY, "2026-08-31")).toBe(0); // same month
    expect(monthsUntil(TODAY, "2027-08-01")).toBe(12);
    expect(monthsUntil(TODAY, "2026-06-01")).toBe(-2); // past
  });

  test("Required monthly = remaining ÷ remaining months (ceiling, minor units)", () => {
    expect(requiredMonthlyMinor(570000, 12)).toBe(47500);
    expect(requiredMonthlyMinor(100000, 3)).toBe(33334); // ceil, never under-asks
    // Due this month or overdue → the whole remainder is needed now.
    expect(requiredMonthlyMinor(100000, 0)).toBe(100000);
    expect(requiredMonthlyMinor(100000, -5)).toBe(100000);
  });

  test("estimated completion month at a contribution rate", () => {
    // 5,700.00 remaining at 480.00/month → 12 months → Aug 2027.
    expect(estimatedCompletionMonth(TODAY, 570000, 48000)).toBe("2027-08");
    // Already reached → this month.
    expect(estimatedCompletionMonth(TODAY, 0, 48000)).toBe("2026-08");
    // Zero or negative rate → no estimate, never a fake date.
    expect(estimatedCompletionMonth(TODAY, 570000, 0)).toBeNull();
    expect(estimatedCompletionMonth(TODAY, 570000, -100)).toBeNull();
  });
});

describe("computeGoalOutlook (also powers the what-if controls)", () => {
  const base = {
    targetMinor: 1500000,
    savedMinor: 930000,
    targetDate: "2027-08-31" as string | null,
    monthlyRateMinor: 48000,
    today: TODAY,
  };

  test("on track when the estimate lands in the target month or earlier (within a month)", () => {
    // Remaining 5,700 at 480/mo → done 2027-08, target 2027-08 → on_track.
    expect(computeGoalOutlook(base)).toMatchObject({
      progressBp: 6200,
      remainingMinor: 570000,
      requiredMonthlyMinor: 47500,
      estimatedCompletionMonth: "2027-08",
      timeStatus: "on_track",
    });
  });

  test("behind when the estimate passes the target month", () => {
    expect(computeGoalOutlook({ ...base, monthlyRateMinor: 30000 })).toMatchObject({
      estimatedCompletionMonth: "2028-03",
      timeStatus: "behind",
    });
  });

  test("ahead when the estimate beats the target month", () => {
    expect(computeGoalOutlook({ ...base, monthlyRateMinor: 100000 })).toMatchObject({
      estimatedCompletionMonth: "2027-02",
      timeStatus: "ahead",
    });
  });

  test("zero contribution rate with a target date is honestly behind, with no estimate", () => {
    expect(computeGoalOutlook({ ...base, monthlyRateMinor: 0 })).toMatchObject({
      estimatedCompletionMonth: null,
      timeStatus: "behind",
    });
  });

  test("completed the moment saved reaches the target (even past it)", () => {
    expect(computeGoalOutlook({ ...base, savedMinor: 1500000 })).toMatchObject({
      timeStatus: "completed",
      remainingMinor: 0,
      requiredMonthlyMinor: 0,
    });
    expect(computeGoalOutlook({ ...base, savedMinor: 1600000 }).progressBp).toBe(10667);
  });

  test("past target dates are overdue, and the full remainder is required now", () => {
    expect(computeGoalOutlook({ ...base, targetDate: "2026-06-30" })).toMatchObject({
      timeStatus: "overdue",
      requiredMonthlyMinor: 570000,
    });
  });

  test("no target date → progress only, estimate still offered when a rate exists", () => {
    expect(computeGoalOutlook({ ...base, targetDate: null })).toMatchObject({
      timeStatus: "no_target_date",
      requiredMonthlyMinor: null,
      estimatedCompletionMonth: "2027-08",
    });
  });
});
