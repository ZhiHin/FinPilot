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

test.describe("goals workspace (demo data)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password);
    await page.goto("/goals");
  });

  test("lists active goals with progress, statuses, and honest estimates", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Emergency fund" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Japan trip" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New laptop" })).toBeVisible();
    // Deterministic statuses as text badges, never color alone.
    await expect(page.getByText("On track").first()).toBeVisible();
    await expect(page.getByText("Behind").first()).toBeVisible();
    await expect(page.getByText("No target date").first()).toBeVisible();
    await expect(page.getByText("Needs monthly").first()).toBeVisible();
    await expect(page.getByText("Est. done").first()).toBeVisible();
    // The workspace is explicit that contributions never move money.
    await expect(page.getByText(/never move money/)).toBeVisible();
  });

  test("view chips switch between active, paused, completed, archived", async ({ page }) => {
    await page.getByRole("navigation", { name: "Goal views" }).getByText("Completed").click();
    await expect(page).toHaveURL(/view=completed/);
    await expect(page.getByText(/No completed goals/)).toBeVisible();
    await page.getByRole("navigation", { name: "Goal views" }).getByText("Active").click();
    await expect(page.getByRole("link", { name: "Emergency fund" })).toBeVisible();
  });

  test("goal detail: progress, milestones, stats, and contribution history", async ({ page }) => {
    await page.getByRole("link", { name: "Emergency fund" }).click();
    await expect(page).toHaveURL(/\/goals\/[0-9a-f-]+/);
    await expect(page.getByRole("heading", { name: "Emergency fund" })).toBeVisible();
    await expect(page.getByText("Remaining", { exact: true })).toBeVisible();
    await expect(page.getByText("Needs monthly")).toBeVisible();
    await expect(page.getByText("Est. completion")).toBeVisible();
    // Milestones list marks reached thresholds.
    await expect(page.getByRole("list", { name: "Milestones" })).toBeVisible();
    await expect(page.getByText("✓ 25.0%")).toBeVisible();
    await expect(page.getByText("✓ 50.0%")).toBeVisible();
    // History table with the seeded entries.
    const history = page.getByRole("table");
    await expect(history).toBeVisible();
    await expect(history.getByText("Starting balance moved from savings")).toBeVisible();
    await expect(page.getByText("Allocation").first()).toBeVisible();
  });

  test("recording a contribution is explicit that no money moves", async ({ page }) => {
    await page.getByRole("link", { name: "New laptop" }).click();
    await page.getByRole("button", { name: "Add contribution" }).click();
    await expect(page.getByText(/does not move money/)).toBeVisible();
    await page.getByRole("dialog").getByLabel("Amount", { exact: true }).fill("150");
    await page.getByRole("button", { name: "Record contribution" }).click();
    await expect(page.getByText(/no money was moved/)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    // Progress reflects the new entry: 2,000 + 150 = RM 2,150.00 saved.
    await expect(page.getByText("RM 2,150.00").first()).toBeVisible();
  });

  test("withdrawals require a reason and appear in history", async ({ page }) => {
    await page.getByRole("link", { name: "New laptop" }).click();
    await page.getByRole("button", { name: "Add contribution" }).click();
    await page.getByRole("dialog").getByLabel("Withdrawal / correction").check();
    await page.getByRole("dialog").getByLabel("Amount", { exact: true }).fill("50");
    await page.getByRole("dialog").getByLabel("Reason (required)").fill("Bought a keyboard early");
    await page.getByRole("button", { name: "Record withdrawal" }).click();
    await expect(page.getByText(/Withdrawal recorded/)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Bought a keyboard early")).toBeVisible();
    await expect(page.getByText("Withdrawal", { exact: true }).first()).toBeVisible();
  });

  test("what-if recalculates deterministically and never saves by itself", async ({ page }) => {
    await page.getByRole("link", { name: "Japan trip" }).click();
    const before = await page.getByText("Est. completion").locator("..").textContent();
    await page.getByLabel("Monthly contribution").fill("650");
    await page.getByRole("button", { name: "Recalculate" }).click();
    await expect(page).toHaveURL(/wifContribution=650/);
    await expect(page.getByText("This plan would be")).toBeVisible();
    // The saved goal is untouched: the header stats still show the old plan.
    const after = await page.getByText("Est. completion").locator("..").textContent();
    expect(after).toBe(before);
    await page.getByRole("link", { name: "Clear" }).click();
    await expect(page).not.toHaveURL(/wifContribution/);
  });

  test("pause and resume a goal", async ({ page }) => {
    await page.getByRole("link", { name: "Japan trip" }).click();
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText(/Goal paused/)).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByText(/Goal reactivated/)).toBeVisible();
  });

  test("create a goal through the dialog", async ({ page }) => {
    await page.getByRole("button", { name: "New goal" }).click();
    await page.getByLabel("Name").fill("Balik kampung fund");
    await page.getByLabel("Type").selectOption("travel");
    await page.getByLabel("Target amount").fill("1200");
    await page.getByRole("button", { name: "Create goal" }).click();
    await expect(page.getByText("Goal created.")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("link", { name: "Balik kampung fund" })).toBeVisible();
  });

  test("goals list and detail pass axe", async ({ page }) => {
    await expectNoSeriousViolations(page, "/goals (demo)");
    await page.getByRole("link", { name: "Emergency fund" }).click();
    await page.getByText("Contribution history").waitFor();
    await expectNoSeriousViolations(page, "/goals/[id] (demo)");
  });

  test("dashboard shows real budget and goal snapshots", async ({ page }) => {
    await page.goto("/overview");
    await expect(page.getByRole("heading", { name: "Budget this cycle" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Savings goals" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open budget" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open goals" })).toBeVisible();
    // Goal names link straight to their detail pages.
    await expect(page.getByRole("link", { name: "Emergency fund" })).toBeVisible();
  });
});
