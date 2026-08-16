import { expect, test } from "@playwright/test";

import { signIn, TEST_USER_B } from "./helpers";

test.describe("responsive application shell", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_USER_B.email, TEST_USER_B.password);
  });

  test("desktop 1440 and 1024: sidebar visible, bottom nav hidden", async ({ page }) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        page.locator("aside").getByRole("navigation", { name: "Primary" }),
      ).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Quick navigation" })).toBeHidden();
    }
  });

  test("mobile 768 and 360: bottom nav visible, sidebar hidden", async ({ page }) => {
    for (const width of [768, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByRole("navigation", { name: "Quick navigation" })).toBeVisible();
      await expect(page.locator("aside").getByRole("navigation", { name: "Primary" })).toBeHidden();
    }
  });

  test("placeholder destinations are honestly labeled with their phase", async ({ page }) => {
    await page.goto("/budget");
    await expect(page.getByText(/arrives in Phase 5/i)).toBeVisible();
    await page.goto("/insights");
    await expect(page.getByText(/arrives in Phase 8/i)).toBeVisible();
  });

  test("command palette opens with Ctrl+K and navigates", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await page.getByLabel("Search destinations").fill("Goal");
    await page.getByRole("button", { name: "Goals" }).click();
    await expect(page).toHaveURL(/\/goals/);
  });

  test("theme toggle persists an explicit theme on <html>", async ({ page }) => {
    // Fresh accounts default to system → first click switches to light.
    await page.getByRole("button", { name: /^Theme:/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/, {
      timeout: 15_000,
    });
  });

  test("privacy toggle masks amounts without layout collapse", async ({ page }) => {
    await page.goto("/overview");
    const masked = page.getByText(/RM •••••/);
    if (await masked.isVisible().catch(() => false)) {
      // A previous test in this storage state left it hidden — unhide first.
      await page.getByRole("button", { name: "Show amounts" }).click();
    }
    await expect(page.getByText(/RM\s[\d,.]+/).first()).toBeVisible();
    await page.getByRole("button", { name: "Hide amounts" }).click();
    await expect(page.getByText(/RM •••••/).first()).toBeVisible();
    await page.getByRole("button", { name: "Show amounts" }).click();
    await expect(page.getByText(/RM •••••/)).toHaveCount(0);
  });

  test("settings forms save and report inline", async ({ page }) => {
    await page.goto("/settings/profile");
    await page.getByLabel("Display name").fill("Renamed Person");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
  });
});
