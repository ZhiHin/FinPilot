import { describe, expect, test } from "vitest";

import { addDaysIso, formatIsoDate, isValidIsoDate, localDateInTz } from "./index";

describe("localDateInTz", () => {
  test("rolls to the next calendar day in Kuala Lumpur (UTC+8)", () => {
    expect(localDateInTz(new Date("2026-08-15T17:30:00Z"), "Asia/Kuala_Lumpur")).toBe("2026-08-16");
  });

  test("stays on the same day before the KL midnight boundary", () => {
    expect(localDateInTz(new Date("2026-08-15T15:59:00Z"), "Asia/Kuala_Lumpur")).toBe("2026-08-15");
  });
});

describe("addDaysIso", () => {
  test("crosses month boundaries", () => {
    expect(addDaysIso("2026-08-31", 1)).toBe("2026-09-01");
  });

  test("handles leap years", () => {
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
  });

  test("subtracts across year boundaries", () => {
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("isValidIsoDate", () => {
  test("accepts real calendar dates", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
  });

  test("rejects impossible dates and malformed strings", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-2-3")).toBe(false);
    expect(isValidIsoDate("not-a-date")).toBe(false);
  });
});

describe("formatIsoDate", () => {
  test("formats a calendar date for en-MY", () => {
    expect(formatIsoDate("2026-08-16", "en-MY")).toBe("16 Aug 2026");
  });
});
