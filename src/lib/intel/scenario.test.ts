import { describe, expect, test } from "vitest";

import type { ForecastInputs, ProjectedOccurrence } from "@/lib/intel/forecast";
import {
  applyScenarioEvents,
  earliestSaferDate,
  simulateScenario,
  type SimEvent,
} from "@/lib/intel/scenario";

const WINDOW = { today: "2026-08-01", horizonEnd: "2026-10-30" };

const salary = (date: string): ProjectedOccurrence => ({
  date,
  amountMinor: 520000,
  toleranceMinor: 0,
  confirmed: true,
  direction: "inflow",
  patternId: "pat-salary",
});
const rent = (date: string): ProjectedOccurrence => ({
  date,
  amountMinor: 160000,
  toleranceMinor: 0,
  confirmed: true,
  direction: "outflow",
  patternId: "pat-rent",
});

const event = (
  partial: Partial<SimEvent> & Pick<SimEvent, "eventType" | "effectiveOn">,
): SimEvent => ({
  amountMinor: null,
  refs: {},
  params: {},
  ...partial,
});

describe("applyScenarioEvents", () => {
  test("one_time_expense adds a single confirmed outflow inside the window", () => {
    const out = applyScenarioEvents(
      [salary("2026-08-25")],
      [event({ eventType: "one_time_expense", effectiveOn: "2026-09-15", amountMinor: 280000 })],
      WINDOW,
    );
    const added = out.filter((o) => o.patternId === undefined);
    expect(added).toEqual([
      {
        date: "2026-09-15",
        amountMinor: 280000,
        toleranceMinor: 0,
        confirmed: true,
        direction: "outflow",
      },
    ]);
  });

  test("events dated outside the horizon add nothing", () => {
    const out = applyScenarioEvents(
      [],
      [event({ eventType: "one_time_expense", effectiveOn: "2027-01-01", amountMinor: 280000 })],
      WINDOW,
    );
    expect(out).toEqual([]);
  });

  test("income_change shifts only targeted inflows on/after the effective date", () => {
    const out = applyScenarioEvents(
      [salary("2026-08-25"), salary("2026-09-25"), rent("2026-09-01")],
      [
        event({
          eventType: "income_change",
          effectiveOn: "2026-09-01",
          amountMinor: -50000,
          refs: { patternId: "pat-salary" },
        }),
      ],
      WINDOW,
    );
    expect(out.find((o) => o.date === "2026-08-25")?.amountMinor).toBe(520000);
    expect(out.find((o) => o.date === "2026-09-25")?.amountMinor).toBe(470000);
    expect(out.find((o) => o.date === "2026-09-01")?.amountMinor).toBe(160000);
  });

  test("rent_change sets the new amount from the effective date and floors at zero", () => {
    const out = applyScenarioEvents(
      [rent("2026-08-05"), rent("2026-09-05")],
      [
        event({
          eventType: "rent_change",
          effectiveOn: "2026-09-01",
          refs: { patternId: "pat-rent" },
          params: { newAmountMinor: 185000 },
        }),
      ],
      WINDOW,
    );
    expect(out.find((o) => o.date === "2026-08-05")?.amountMinor).toBe(160000);
    expect(out.find((o) => o.date === "2026-09-05")?.amountMinor).toBe(185000);
  });

  test("cancel_recurring drops only that pattern's future occurrences", () => {
    const out = applyScenarioEvents(
      [rent("2026-08-05"), rent("2026-09-05"), salary("2026-09-25")],
      [
        event({
          eventType: "cancel_recurring",
          effectiveOn: "2026-09-01",
          refs: { patternId: "pat-rent" },
        }),
      ],
      WINDOW,
    );
    expect(out.map((o) => o.date).sort()).toEqual(["2026-08-05", "2026-09-25"]);
  });

  test("add_installment creates exactly `months` monthly outflows inside the horizon", () => {
    const out = applyScenarioEvents(
      [],
      [
        event({
          eventType: "add_installment",
          effectiveOn: "2026-08-15",
          amountMinor: 25000,
          params: { months: 6 },
        }),
      ],
      WINDOW,
    );
    // Only the occurrences inside the 90-day window materialize.
    expect(out.map((o) => o.date)).toEqual(["2026-08-15", "2026-09-15", "2026-10-15"]);
    expect(out.every((o) => o.amountMinor === 25000 && o.direction === "outflow")).toBe(true);
  });

  test("savings_change: positive delta is a monthly outflow, negative frees cash monthly", () => {
    const more = applyScenarioEvents(
      [],
      [event({ eventType: "savings_change", effectiveOn: "2026-08-10", amountMinor: 20000 })],
      WINDOW,
    );
    expect(more.map((o) => o.direction)).toEqual(["outflow", "outflow", "outflow"]);
    const less = applyScenarioEvents(
      [],
      [event({ eventType: "savings_change", effectiveOn: "2026-08-10", amountMinor: -20000 })],
      WINDOW,
    );
    expect(less.map((o) => o.direction)).toEqual(["inflow", "inflow", "inflow"]);
  });

  test("the input occurrence list is never mutated", () => {
    const input = [salary("2026-08-25")];
    applyScenarioEvents(
      input,
      [
        event({
          eventType: "income_change",
          effectiveOn: "2026-08-01",
          amountMinor: -100000,
        }),
      ],
      WINDOW,
    );
    expect(input[0].amountMinor).toBe(520000);
  });
});

describe("simulateScenario", () => {
  const base: ForecastInputs = {
    startBalanceMinor: 300000,
    today: "2026-08-01",
    horizonDays: 90,
    occurrences: [
      salary("2026-08-25"),
      salary("2026-09-25"),
      rent("2026-08-05"),
      rent("2026-09-05"),
    ],
    baseline: {
      expectedDailyMinor: 3000,
      conservativeDailyMinor: 4000,
      optimisticDailyMinor: 2000,
    },
  };

  test("with no events the scenario equals the baseline exactly", () => {
    const sim = simulateScenario(base, []);
    expect(sim.scenario.series).toEqual(sim.baseline.series);
    expect(sim.endDeltaMinor).toBe(0);
  });

  test("a one-time expense shifts the expected path by exactly its amount from that day", () => {
    const sim = simulateScenario(base, [
      event({ eventType: "one_time_expense", effectiveOn: "2026-09-15", amountMinor: 280000 }),
    ]);
    const before = sim.scenario.series.find((p) => p.date === "2026-09-14")!;
    const beforeBase = sim.baseline.series.find((p) => p.date === "2026-09-14")!;
    const after = sim.scenario.series.find((p) => p.date === "2026-09-15")!;
    const afterBase = sim.baseline.series.find((p) => p.date === "2026-09-15")!;
    expect(before.expectedMinor).toBe(beforeBase.expectedMinor);
    expect(afterBase.expectedMinor - after.expectedMinor).toBe(280000);
    expect(sim.endDeltaMinor).toBe(-280000);
  });

  test("band ordering holds for every scenario day (B2 preserved)", () => {
    const sim = simulateScenario(base, [
      event({ eventType: "one_time_expense", effectiveOn: "2026-08-20", amountMinor: 500000 }),
      event({
        eventType: "income_change",
        effectiveOn: "2026-09-01",
        amountMinor: -100000,
      }),
      event({
        eventType: "add_installment",
        effectiveOn: "2026-08-10",
        amountMinor: 30000,
        params: { months: 12 },
      }),
    ]);
    for (const point of sim.scenario.series) {
      expect(point.conservativeMinor).toBeLessThanOrEqual(point.expectedMinor);
      expect(point.expectedMinor).toBeLessThanOrEqual(point.optimisticMinor);
    }
  });

  test("lowest expected point reflects the event dip", () => {
    const sim = simulateScenario(base, [
      event({ eventType: "emergency_expense", effectiveOn: "2026-08-10", amountMinor: 400000 }),
    ]);
    expect(sim.scenario.lowestExpected.balanceMinor).toBeLessThan(
      sim.baseline.lowestExpected.balanceMinor,
    );
  });
});

describe("earliestSaferDate", () => {
  const series = [
    {
      date: "2026-08-02",
      conservativeMinor: 100000,
      expectedMinor: 120000,
      optimisticMinor: 130000,
    },
    {
      date: "2026-08-03",
      conservativeMinor: 80000,
      expectedMinor: 110000,
      optimisticMinor: 125000,
    },
    {
      date: "2026-08-04",
      conservativeMinor: 300000,
      expectedMinor: 320000,
      optimisticMinor: 330000,
    },
    {
      date: "2026-08-05",
      conservativeMinor: 290000,
      expectedMinor: 315000,
      optimisticMinor: 325000,
    },
  ];

  test("returns the first day whose remaining conservative path absorbs the purchase", () => {
    // Buying on 08-02 fails (dip to 80000 - 150000 < 0); from 08-04 the
    // suffix minimum is 290000, and 290000 - 150000 >= 100000 buffer.
    expect(earliestSaferDate(series, 150000, 100000)).toBe("2026-08-04");
  });

  test("returns null when no day in the horizon is safe", () => {
    expect(earliestSaferDate(series, 10000000, 0)).toBeNull();
  });
});
