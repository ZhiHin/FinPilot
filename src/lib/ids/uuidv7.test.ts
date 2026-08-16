import { describe, expect, test } from "vitest";

import { uuidv7 } from "./index";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  test("produces RFC-9562 v7 formatted ids", () => {
    const id = uuidv7();
    expect(id).toMatch(UUID_V7_PATTERN);
  });

  test("embeds the millisecond timestamp in the first 48 bits", () => {
    const now = 1_723_800_000_000;
    const id = uuidv7({ now: () => now, random: () => 0 });
    const hex = id.replaceAll("-", "");
    expect(hex.slice(0, 12)).toBe(now.toString(16).padStart(12, "0"));
  });

  test("is deterministic with injected clock and rng", () => {
    const opts = { now: () => 1000, random: () => 0.5 };
    expect(uuidv7(opts)).toBe(uuidv7(opts));
  });

  test("sorts by generation time", () => {
    const a = uuidv7({ now: () => 1_000, random: () => 0 });
    const b = uuidv7({ now: () => 2_000, random: () => 0 });
    expect(a < b).toBe(true);
  });

  test("generates unique ids in a burst", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });
});
