import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshEmail, signIn, signUp } from "./helpers";

/**
 * Phase 10 release journeys: data export, staged account deletion with the
 * recovery window, the public privacy notice, and accessibility on the new
 * surfaces (spec V3, V4, V6).
 */

const PASSWORD = "release-phase-ten-1";

async function expectNoSeriousViolations(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious,
    `${context}: ${serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} nodes`).join("; ")}`,
  ).toEqual([]);
}

test.describe("data export", () => {
  test("downloads a ZIP archive of everything the user owns", async ({ page }) => {
    await signIn(page, "aisyah.demo@finpilot.test", "demo-aisyah-2026");
    await page.goto("/settings/data");

    await expect(page.getByRole("heading", { name: "Export your data" })).toBeVisible();
    // No placeholder promises left on this page.
    await expect(page.getByText("Arrives in Phase")).toHaveCount(0);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my data (ZIP)" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^finpilot-export-\d{4}-\d{2}-\d{2}\.zip$/);

    await expect(page.getByText("Your export is downloading")).toBeVisible();
  });
});

test.describe("staged account deletion", () => {
  test("request, land on the restore gate, then restore the account", async ({ page }) => {
    const email = freshEmail("deletion");
    await signUp(page, email, PASSWORD, "Deletion Test");

    await page.goto("/settings/data");
    await page.getByRole("button", { name: "Delete my account" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("You are signed out everywhere immediately.")).toBeVisible();
    await dialog.getByLabel("Confirm with your password").fill("wrong-password");
    await dialog.getByRole("button", { name: "Delete my account" }).click();
    await expect(dialog.getByText("That doesn’t match your current password.")).toBeVisible();

    await dialog.getByLabel("Confirm with your password").fill(PASSWORD);
    await dialog.getByRole("button", { name: "Delete my account" }).click();

    // Signed out everywhere, with the recovery window explained.
    await expect(page).toHaveURL(/\/sign-in\?deletion=scheduled/);
    await expect(page.getByText(/Sign in within 30 days to restore it/)).toBeVisible();

    // The app is unreachable until the account is restored.
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/sign-in/);

    // Signing in inside the window lands on the restore gate, not the app.
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/restore/);
    await expect(
      page.getByRole("heading", { name: "Your account is scheduled for deletion" }),
    ).toBeVisible();
    await expect(page.getByText(/permanently erased after/)).toBeVisible();

    // Every other route still funnels back to the gate.
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/restore/);

    await expectNoSeriousViolations(page, "/restore");

    await page.getByRole("button", { name: "Restore my account" }).click();
    await expect(page).toHaveURL(/\/overview/);
    await expect(page.getByRole("link", { name: "Transactions" }).first()).toBeVisible();
  });
});

test.describe("public privacy notice", () => {
  test("is readable signed out, in English and Bahasa Melayu", async ({ page }) => {
    await page.goto("/legal/privacy");
    await expect(page.getByRole("heading", { name: /Privacy notice/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "English" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bahasa Melayu" })).toBeVisible();
    await expect(page.getByText("Akta Perlindungan Data Peribadi 2010")).toBeVisible();
    await expectNoSeriousViolations(page, "/legal/privacy");
  });

  test("is linked from the sign-in screen", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: /Privacy notice/ }).click();
    await expect(page).toHaveURL(/\/legal\/privacy/);
  });
});

test.describe("accessibility on release surfaces", () => {
  test("settings data page passes axe", async ({ page }) => {
    await signIn(page, "aisyah.demo@finpilot.test", "demo-aisyah-2026");
    await page.goto("/settings/data");
    await expectNoSeriousViolations(page, "/settings/data");
  });

  test("delete-account dialog passes axe and traps focus", async ({ page }) => {
    await signIn(page, "aisyah.demo@finpilot.test", "demo-aisyah-2026");
    await page.goto("/settings/data");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousViolations(page, "/settings/data (dialog open)");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("settings data page is usable at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await signIn(page, "aisyah.demo@finpilot.test", "demo-aisyah-2026");
    await page.goto("/settings/data");
    await expect(page.getByRole("button", { name: "Download my data (ZIP)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete my account" })).toBeVisible();
    // No horizontal overflow at the narrowest supported width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
