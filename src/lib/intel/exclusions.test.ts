import { describe, expect, test } from "vitest";

import { subtractExclusions, windowsOverlap } from "@/lib/intel/exclusions";

const W = { start: "2026-06-01", end: "2026-06-30" };

describe("windowsOverlap", () => {
  test("shared edge days count as overlap; disjoint windows do not", () => {
    expect(windowsOverlap(W, { start: "2026-06-30", end: "2026-07-15" })).toBe(true);
    expect(windowsOverlap(W, { start: "2026-07-01", end: "2026-07-15" })).toBe(false);
    expect(windowsOverlap(W, { start: "2026-05-01", end: "2026-05-31" })).toBe(false);
  });
});

describe("subtractExclusions", () => {
  test("no overlapping exclusions returns the window unchanged", () => {
    expect(subtractExclusions(W, [{ start: "2026-07-05", end: "2026-07-09" }])).toEqual([W]);
  });

  test("an interior exclusion splits the window into two segments", () => {
    expect(subtractExclusions(W, [{ start: "2026-06-10", end: "2026-06-14" }])).toEqual([
      { start: "2026-06-01", end: "2026-06-09" },
      { start: "2026-06-15", end: "2026-06-30" },
    ]);
  });

  test("an exclusion covering the whole window empties it", () => {
    expect(subtractExclusions(W, [{ start: "2026-05-20", end: "2026-07-02" }])).toEqual([]);
  });

  test("edge-touching exclusions trim rather than split", () => {
    expect(subtractExclusions(W, [{ start: "2026-05-25", end: "2026-06-05" }])).toEqual([
      { start: "2026-06-06", end: "2026-06-30" },
    ]);
    expect(subtractExclusions(W, [{ start: "2026-06-28", end: "2026-06-30" }])).toEqual([
      { start: "2026-06-01", end: "2026-06-27" },
    ]);
  });

  test("multiple and overlapping exclusions merge correctly", () => {
    expect(
      subtractExclusions(W, [
        { start: "2026-06-03", end: "2026-06-05" },
        { start: "2026-06-05", end: "2026-06-08" },
        { start: "2026-06-20", end: "2026-06-22" },
      ]),
    ).toEqual([
      { start: "2026-06-01", end: "2026-06-02" },
      { start: "2026-06-09", end: "2026-06-19" },
      { start: "2026-06-23", end: "2026-06-30" },
    ]);
  });

  test("a single-day exclusion removes exactly that day", () => {
    expect(subtractExclusions(W, [{ start: "2026-06-15", end: "2026-06-15" }])).toEqual([
      { start: "2026-06-01", end: "2026-06-14" },
      { start: "2026-06-16", end: "2026-06-30" },
    ]);
  });
});
