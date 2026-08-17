import { describe, expect, test } from "vitest";

import {
  enumerateMonths,
  isCompleteThrough,
  previousPeriod,
  resolvePeriod,
  shiftRangeMonthsBack,
  yearAgoPeriod,
} from ".";

const TODAY = "2026-08-17";

describe("resolvePeriod", () => {
  test("this-month runs from the 1st to today and is incomplete mid-month", () => {
    expect(resolvePeriod("this-month", TODAY)).toEqual({
      key: "this-month",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-17",
      incomplete: true,
    });
  });

  test("this-month is complete on the last day of the month", () => {
    expect(resolvePeriod("this-month", "2026-08-31").incomplete).toBe(false);
  });

  test("last-month is the full previous calendar month", () => {
    expect(resolvePeriod("last-month", TODAY)).toEqual({
      key: "last-month",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      incomplete: false,
    });
  });

  test("last-month handles January → December of previous year", () => {
    expect(resolvePeriod("last-month", "2026-01-05")).toMatchObject({
      dateFrom: "2025-12-01",
      dateTo: "2025-12-31",
    });
  });

  test("last-3-months is a rolling window including the current partial month", () => {
    expect(resolvePeriod("last-3-months", TODAY)).toMatchObject({
      dateFrom: "2026-06-01",
      dateTo: "2026-08-17",
      incomplete: true,
    });
  });

  test("this-year runs from Jan 1 to today", () => {
    expect(resolvePeriod("this-year", TODAY)).toMatchObject({
      dateFrom: "2026-01-01",
      dateTo: "2026-08-17",
      incomplete: true,
    });
  });

  test("last-12-months spans twelve calendar months ending today", () => {
    expect(resolvePeriod("last-12-months", TODAY)).toMatchObject({
      dateFrom: "2025-09-01",
      dateTo: "2026-08-17",
    });
  });

  test("unknown keys fall back to this-month", () => {
    expect(resolvePeriod("nonsense", TODAY).key).toBe("this-month");
  });
});

describe("previousPeriod", () => {
  test("a full calendar month compares to the previous calendar month", () => {
    expect(previousPeriod("2026-07-01", "2026-07-31")).toEqual({
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
    });
  });

  test("a multi-month window compares to the preceding window of the same month count", () => {
    expect(previousPeriod("2026-06-01", "2026-08-31")).toEqual({
      dateFrom: "2026-03-01",
      dateTo: "2026-05-31",
    });
  });

  test("month-to-date compares to the same days into the previous month", () => {
    expect(previousPeriod("2026-08-01", "2026-08-17")).toEqual({
      dateFrom: "2026-07-01",
      dateTo: "2026-07-17",
    });
  });

  test("month-to-date day is clamped to the shorter previous month", () => {
    // 31 March MTD → February caps at the 28th.
    expect(previousPeriod("2026-03-01", "2026-03-31")).toEqual({
      dateFrom: "2026-02-01",
      dateTo: "2026-02-28",
    });
  });

  test("an arbitrary range compares to the equal-day-length range immediately before it", () => {
    // 10 days → the 10 days ending the day before the range starts.
    expect(previousPeriod("2026-08-08", "2026-08-17")).toEqual({
      dateFrom: "2026-07-29",
      dateTo: "2026-08-07",
    });
  });
});

describe("yearAgoPeriod", () => {
  test("shifts both endpoints back one year", () => {
    expect(yearAgoPeriod("2026-08-01", "2026-08-17")).toEqual({
      dateFrom: "2025-08-01",
      dateTo: "2025-08-17",
    });
  });

  test("clamps Feb 29 to Feb 28 in non-leap years", () => {
    expect(yearAgoPeriod("2024-02-29", "2024-02-29")).toEqual({
      dateFrom: "2023-02-28",
      dateTo: "2023-02-28",
    });
  });
});

describe("enumerateMonths", () => {
  test("lists every calendar month covered by the range", () => {
    expect(enumerateMonths("2026-06-15", "2026-08-02")).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  test("spans year boundaries", () => {
    expect(enumerateMonths("2025-11-01", "2026-02-28")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  test("a single month yields one entry", () => {
    expect(enumerateMonths("2026-08-01", "2026-08-17")).toEqual(["2026-08"]);
  });
});

describe("shiftRangeMonthsBack", () => {
  test("covers the N calendar months ending with the given date's month", () => {
    expect(shiftRangeMonthsBack("2026-08-17", 6)).toEqual({
      dateFrom: "2026-03-01",
      dateTo: "2026-08-17",
    });
    expect(shiftRangeMonthsBack("2026-01-31", 2)).toEqual({
      dateFrom: "2025-12-01",
      dateTo: "2026-01-31",
    });
  });
});

describe("isCompleteThrough", () => {
  test("a period ending before today is complete", () => {
    expect(isCompleteThrough("2026-07-31", TODAY)).toBe(true);
  });
  test("a period ending today or later is incomplete", () => {
    expect(isCompleteThrough("2026-08-17", TODAY)).toBe(false);
    expect(isCompleteThrough("2026-09-30", TODAY)).toBe(false);
  });
});
