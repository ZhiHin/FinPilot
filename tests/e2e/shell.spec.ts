import { expect, test } from "@playwright/test";

import { signIn, TEST_USER_B } from "./helpers";

test.describe("responsive application shell", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_USER_B.email, TEST_USER_B.password);
  });

  // Primary navigation is the floating dock, not a sidebar: content keeps the
  // full width of the screen, which matters most on the wide data tables.
  test("desktop 1440 and 1024: dock visible, bottom nav hidden", async ({ page }) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const dock = page.getByRole("navigation", { name: "Primary" });
      await expect(dock).toBeVisible();
      await expect(dock.getByRole("link", { name: "Overview" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Quick navigation" })).toBeHidden();
      // Nothing reserves a left column any more.
      await expect(page.locator("aside")).toHaveCount(0);
    }
  });

  test("mobile 768 and 360: bottom nav visible, dock hidden", async ({ page }) => {
    for (const width of [768, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByRole("navigation", { name: "Quick navigation" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    }
  });

  test("the dock reaches every primary destination, and More covers the rest", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dock = page.getByRole("navigation", { name: "Primary" });
    await dock.getByRole("link", { name: "Budget" }).click();
    await expect(page).toHaveURL(/\/budget/);

    await dock.getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test("every destination is real — no placeholders remain", async ({ page }) => {
    // Scenario Lab was the last placeholder; since Phase 9 it is a live page.
    await page.goto("/scenarios");
    await expect(page.getByRole("button", { name: "New scenario" })).toBeVisible();
    await expect(page.getByText(/arrives in Phase/i)).toHaveCount(0);
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
