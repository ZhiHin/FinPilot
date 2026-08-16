import { describe, expect, test } from "vitest";

import { t } from "./index";

describe("t", () => {
  test("returns the en-MY message for a known key", () => {
    expect(t("app.name")).toBe("FinPilot");
  });

  test("interpolates named parameters", () => {
    expect(t("common.greeting", { name: "Aisyah" })).toContain("Aisyah");
  });

  test("falls back to the key for unknown messages", () => {
    // @ts-expect-error — deliberately unknown key
    expect(t("does.not.exist")).toBe("does.not.exist");
  });
});
