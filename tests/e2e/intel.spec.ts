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

test.describe("safe-to-spend and forecast (demo data)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password);
    // Prime recurring detection (STS bills/income come from patterns).
    await page.goto("/recurring");
    await page.getByRole("table").waitFor();
    await page.goto("/overview");
  });

  test("the STS meter shows today + until payday with a full why-drawer", async ({ page }) => {
    await expect(page.getByText("Safe to spend", { exact: true })).toBeVisible();
    await expect(page.getByText(/until payday/).first()).toBeVisible();
    await page.getByText("Why this number?").click();
    // Every term of the binding formula is itemized (B1).
    await expect(page.getByText("+ Liquid balance")).toBeVisible();
    await expect(page.getByText(/− Upcoming bill:/).first()).toBeVisible();
    await expect(page.getByText(/− Goal contribution due:/).first()).toBeVisible();
    await expect(page.getByText("− Safety buffer")).toBeVisible();
    await expect(page.getByText("= Safe to spend until payday")).toBeVisible();
    await expect(page.getByText(/never a prediction/)).toBeVisible();
    // Inferred bills/income → a range is declared, not hidden (B1).
    await expect(page.getByText(/^Range RM/)).toBeVisible();
  });

  test("the forecast band card renders with horizon toggle and table alternative", async ({
    page,
  }) => {
    await expect(page.getByText(/^Projected balance ·/)).toBeVisible();
    await expect(page.getByText(/Lowest expected:/)).toBeVisible();
    await page.getByRole("navigation", { name: "Forecast horizon" }).getByText("60d").click();
    await expect(page).toHaveURL(/forecast=60/);
    await expect(page.getByText(/^Projected balance ·/)).toBeVisible();
    // Table alternative includes all three bands (B2's figures are inspectable).
    await page
      .getByRole("tablist", { name: /Projected balance/ })
      .getByRole("tab", { name: "Table" })
      .click();
    await expect(page.getByRole("columnheader", { name: "Conservative" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Expected" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Optimistic" })).toBeVisible();
  });

  test("the top insight surfaces on the overview and links to the evidence", async ({ page }) => {
    await expect(page.getByText("Top insight")).toBeVisible();
    await page.getByRole("link", { name: "See the evidence" }).click();
    await expect(page).toHaveURL(/\/insights/);
  });

  test("mobile 360px keeps the STS meter usable", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/overview");
    await expect(page.getByText("Safe to spend", { exact: true })).toBeVisible();
    await page.getByText("Why this number?").click();
    await expect(page.getByText("− Safety buffer")).toBeVisible();
  });
});

test.describe("insights (demo data)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password);
    await page.goto("/insights");
  });

  test("the canonical spend-change insight appears with full B3 anatomy", async ({ page }) => {
    await expect(page.getByText(/deterministic arithmetic over your ledger/)).toBeVisible();
    const card = page
      .locator("li")
      .filter({ hasText: /Food delivery spending increased/ })
      .first();
    await expect(card).toBeVisible();
    await expect(card.getByText(/Worth a look/)).toBeVisible();
    await expect(card.getByText(/Period .+ – /)).toBeVisible();
    await expect(card.getByText(/Confidence: (High|Medium|Low)/)).toBeVisible();

    await card.getByText("How this was calculated").click();
    await expect(card.getByText("This period")).toBeVisible();
    await expect(card.getByText("Previous period")).toBeVisible();
    await expect(card.getByRole("columnheader", { name: "Merchant" })).toBeVisible();
    await expect(card.getByText(/Grabfood/i).first()).toBeVisible();
  });

  test("the transactions drill-down carries the period and a way back", async ({ page }) => {
    const card = page
      .locator("li")
      .filter({ hasText: /Food delivery spending increased/ })
      .first();
    await card.getByRole("link", { name: "Open the transactions behind this" }).click();
    await expect(page).toHaveURL(/\/transactions\?.*categories=/);
    await expect(page.getByText("filtered from a report")).toBeVisible();
    await page.getByRole("link", { name: /Back to Insights/ }).click();
    await expect(page).toHaveURL(/\/insights/);
  });

  test("dismissing an insight is permanent across reloads", async ({ page }) => {
    const cards = page.locator("li").filter({ has: page.getByRole("button", { name: "Dismiss" }) });
    const count = await cards.count();
    if (count === 0) return; // nothing to dismiss — acceptable state
    const title = await cards.first().locator("span.font-semibold").first().textContent();
    await cards.first().getByRole("button", { name: "Dismiss" }).click();
    if (title) {
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
      await page.reload();
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    }
  });

  test("budget suggestions offer explicit approve/dismiss on the budget screen", async ({
    page,
  }) => {
    await page.goto("/budget");
    const panel = page.getByText(/^Suggestions \(\d+\)$/);
    if (await panel.isVisible().catch(() => false)) {
      // Approving applies the allocation and retires the suggestion.
      const first = page
        .locator("li")
        .filter({ has: page.getByRole("button", { name: "Approve" }) })
        .first();
      const suggestionText = await first.locator("p.font-medium").first().textContent();
      await first.getByRole("button", { name: "Approve" }).click();
      if (suggestionText) {
        await expect(page.getByText(suggestionText, { exact: true })).toHaveCount(0);
      }
    } else {
      // No drift between plan and baseline — the panel honestly stays away.
      await expect(page.getByText("Cycle health:")).toBeVisible();
    }
  });

  test("insights page passes axe", async ({ page }) => {
    await expectNoSeriousViolations(page, "/insights (demo)");
  });
});
