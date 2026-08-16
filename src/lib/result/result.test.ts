import { describe, expect, test } from "vitest";

import { err, isErr, isOk, ok } from "./index";

describe("result envelope", () => {
  test("ok wraps data", () => {
    const r = ok({ id: "abc" });
    expect(r).toEqual({ ok: true, data: { id: "abc" } });
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
  });

  test("err wraps a user-safe error", () => {
    const r = err("invalid_input", "Please check the form.");
    expect(r).toEqual({
      ok: false,
      error: { code: "invalid_input", message: "Please check the form." },
    });
    expect(isErr(r)).toBe(true);
  });

  test("err carries optional field errors", () => {
    const r = err("invalid_input", "Please check the form.", {
      email: ["Enter a valid email address."],
    });
    if (isErr(r)) {
      expect(r.error.fieldErrors?.email).toEqual(["Enter a valid email address."]);
    } else {
      throw new Error("expected err");
    }
  });
});
