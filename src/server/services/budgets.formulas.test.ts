import { describe, expect, test } from "vitest";

import {
  availableMinor,
  healthState,
  remainingMinor,
  rolloverOutMinor,
  unallocatedMinor,
  usageBp,
} from "./budgets";

describe("budget arithmetic (bigint minor units, single source of truth)", () => {
  test("Remaining = Planned − Posted spending", () => {
    expect(remainingMinor(60000, 40200)).toBe(19800);
    expect(remainingMinor(60000, 75000)).toBe(-15000); // overspend shows negative
  });

  test("Available with rollover = Planned + Rollover − Posted", () => {
    expect(availableMinor(60000, 12000)).toBe(72000);
    expect(availableMinor(60000, -5000)).toBe(55000); // negative carry reduces
    expect(remainingMinor(availableMinor(60000, 12000), 40200)).toBe(31800);
  });

  test("Budget usage rate = Posted / Available, in basis points", () => {
    expect(usageBp(40200, 60000)).toBe(6700);
    expect(usageBp(75000, 60000)).toBe(12500); // >100% allowed
  });

  test("zero or negative available budget yields null, never a misleading rate", () => {
    expect(usageBp(0, 0)).toBeNull();
    expect(usageBp(5000, 0)).toBeNull();
    expect(usageBp(5000, -1000)).toBeNull();
  });
});

describe("rollover rules (computed once, stored)", () => {
  test("unspent budget carries forward", () => {
    expect(
      rolloverOutMinor({ availableMinor: 60000, postedMinor: 40200, carryNegative: false }),
    ).toBe(19800);
  });

  test("overspend clamps to zero by default", () => {
    expect(
      rolloverOutMinor({ availableMinor: 60000, postedMinor: 75000, carryNegative: false }),
    ).toBe(0);
  });

  test("overspend carries as negative only when carryNegative is enabled", () => {
    expect(
      rolloverOutMinor({ availableMinor: 60000, postedMinor: 75000, carryNegative: true }),
    ).toBe(-15000);
  });
});

describe("zero-based budgets", () => {
  test("unallocated = expected income − total planned (negative = over-allocated)", () => {
    expect(unallocatedMinor(520000, 500000)).toBe(20000);
    expect(unallocatedMinor(520000, 560000)).toBe(-40000);
  });

  test("no expected income yields null (prompt the user, never fake a number)", () => {
    expect(unallocatedMinor(null, 500000)).toBeNull();
  });
});

describe("budget health states (deterministic thresholds, documented)", () => {
  const base = {
    availableMinor: 60000,
    postedMinor: 0,
    pendingMinor: 0,
    elapsedBp: 5000, // halfway through the cycle
    periodStart: "2026-08-01",
    today: "2026-08-16",
  };

  test("not_started before the period begins", () => {
    expect(healthState({ ...base, today: "2026-07-25" })).toBe("not_started");
  });

  test("no_activity when nothing was spent or is pending", () => {
    expect(healthState(base)).toBe("no_activity");
  });

  test("pending spending alone moves out of no_activity but stays on_track", () => {
    expect(healthState({ ...base, pendingMinor: 5000 })).toBe("on_track");
  });

  test("on_track when usage is at or below elapsed pace (+<10pp)", () => {
    // 50% elapsed, 55% used → 5pp ahead → still on track.
    expect(healthState({ ...base, postedMinor: 33000 })).toBe("on_track");
  });

  test("watch at ≥10pp ahead of pace", () => {
    // 50% elapsed, 62% used → 12pp ahead.
    expect(healthState({ ...base, postedMinor: 37200 })).toBe("watch");
  });

  test("at_risk at ≥20pp ahead of pace or ≥90% used", () => {
    // 50% elapsed, 72% used → 22pp ahead.
    expect(healthState({ ...base, postedMinor: 43200 })).toBe("at_risk");
    // 92% used at 90% elapsed → not ahead of pace, but nearly exhausted.
    expect(healthState({ ...base, elapsedBp: 9000, postedMinor: 55200 })).toBe("at_risk");
  });

  test("exceeded when posted spending passes the available budget", () => {
    expect(healthState({ ...base, postedMinor: 60001 })).toBe("exceeded");
  });

  test("zero available with any posted spending is exceeded", () => {
    expect(healthState({ ...base, availableMinor: 0, postedMinor: 100 })).toBe("exceeded");
  });
});
