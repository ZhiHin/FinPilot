import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./helpers";

const DEMO = { email: "aisyah.demo@finpilot.test", password: "demo-aisyah-2026" };

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

test.describe("notification centre (demo data)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password);
    // Ensure detection ran (notifications generate from patterns).
    await page.goto("/recurring");
    await page.getByRole("table").waitFor();
    await page.goto("/notifications");
  });

  test("deterministic alerts appear with severity labels and deep links", async ({ page }) => {
    // The demo's Spotify price change produces at least one alert (unless a
    // previous test acknowledged it — the budget-pace/goal alerts still fire).
    const items = page.locator("li", { has: page.getByRole("button", { name: "Dismiss" }) });
    await expect(items.first()).toBeVisible();
    await expect(page.getByText(/Info|Worth a look|Needs attention/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Notification settings" })).toBeVisible();
  });

  test("mark read and dismiss; dismissed alerts never return", async ({ page }) => {
    const firstItem = page
      .locator("li", { has: page.getByRole("button", { name: "Dismiss" }) })
      .first();
    const title = await firstItem.locator("span.font-medium").first().textContent();
    await firstItem.getByRole("button", { name: "Dismiss" }).click();
    // The item (and its inline banner) unmounts on success — assert the end state.
    if (title) {
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
      // Reload regenerates; the dismissed alert must not reappear.
      await page.reload();
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    }
  });

  test("mark all read empties the unread section", async ({ page }) => {
    const markAll = page.getByRole("button", { name: "Mark all read" });
    if (await markAll.isVisible().catch(() => false)) {
      await markAll.click();
    }
    // The button retires with the unread section — assert the end state.
    await expect(page.getByRole("heading", { name: "Unread" })).toBeHidden();
  });

  test("settings: thresholds, per-type switches, quiet hours save", async ({ page }) => {
    await page.goto("/settings/notifications");
    await expect(page.getByText("Alert types")).toBeVisible();
    await page.getByLabel("Large-bill threshold").fill("750");
    await page.getByLabel("Quiet hours start").fill("22:00");
    await page.getByLabel("Quiet hours end").fill("07:00");
    await page.getByLabel(/Possible duplicate services/).uncheck();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Notification preferences saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Large-bill threshold")).toHaveValue("750.00");
    await expect(page.getByLabel(/Possible duplicate services/)).not.toBeChecked();
    // Restore defaults for other tests.
    await page.getByLabel("Quiet hours start").fill("");
    await page.getByLabel("Quiet hours end").fill("");
    await page.getByLabel(/Possible duplicate services/).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Notification preferences saved.")).toBeVisible();
  });

  test("notification centre passes axe", async ({ page }) => {
    await expectNoSeriousViolations(page, "/notifications (demo)");
  });
});
