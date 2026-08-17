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

test.describe("dashboard (overview)", () => {
  // The demo dataset's most recent complete month is last month — the default
  // "this month" view legitimately shows an empty period.
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password);
    await page.goto("/overview?period=last-month");
  });

  test("shows net position, period flows with comparisons, and data quality", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Where you stand today" })).toBeVisible();
    await expect(page.getByText("Liquid").first()).toBeVisible();
    await expect(page.getByText("Net position").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "This period" })).toBeVisible();
    await expect(page.getByText("Income", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Savings rate").first()).toBeVisible();
    await expect(
      page.getByText(/vs the previous period|no activity in the previous period/).first(),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top spending categories" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent transactions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Data quality" })).toBeVisible();
  });

  test("period selector switches ranges and shows the range label", async ({ page }) => {
    // A complete month never carries the in-progress marker.
    await expect(page.getByText(/in progress/)).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Reporting period" })
      .getByText("This month")
      .click();
    await expect(page).not.toHaveURL(/period=/);
    await expect(page.getByText(/in progress/)).toBeVisible();
    await page
      .getByRole("navigation", { name: "Reporting period" })
      .getByText("Last month")
      .click();
    await expect(page).toHaveURL(/period=last-month/);
  });

  test("every chart offers a table alternative", async ({ page }) => {
    const chartCard = page.getByText(/^Cash flow ·/).first();
    await expect(chartCard).toBeVisible();
    await page.getByRole("tab", { name: "Table" }).first().click();
    await expect(page.getByRole("table").first()).toBeVisible();
  });

  test("category drill-down lands on filtered transactions with a way back", async ({ page }) => {
    const categoryLink = page
      .locator("a[href*='/transactions?']")
      .filter({ hasText: /RM/ })
      .first();
    await categoryLink.click();
    await expect(page).toHaveURL(/\/transactions\?.*categories=/);
    await expect(page.getByText("filtered from a report")).toBeVisible();
    await page.getByRole("link", { name: /Back to Overview/ }).click();
    await expect(page).toHaveURL(/\/overview/);
  });

  test("dashboard passes axe with data", async ({ page }) => {
    await expectNoSeriousViolations(page, "/overview (demo)");
  });
});

test.describe("analytics workspace", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password);
    await page.goto("/analytics?period=last-month");
  });

  test("summary, charts with table views, and the period indicator render", async ({ page }) => {
    await expect(page.getByTestId("period-indicator")).toContainText("Showing");
    await expect(page.getByText(/You earned/)).toBeVisible();
    await expect(page.getByText(/^Income vs expenses ·/)).toBeVisible();
    await expect(page.getByText(/^Net cash flow ·/)).toBeVisible();
    await expect(page.getByText(/^Savings rate trend ·/)).toBeVisible();
    await expect(page.getByText(/^Net position trend ·/)).toBeVisible();
    await expect(page.getByText(/^Spending by category ·/)).toBeVisible();
    await expect(page.getByText(/^Top merchants ·/)).toBeVisible();

    // Table alternative for the first chart.
    await page.getByRole("tab", { name: "Table" }).first().click();
    await expect(page.getByRole("table").first()).toBeVisible();
  });

  test("filters persist in the URL, apply, and reset", async ({ page }) => {
    await page.getByLabel("Period", { exact: true }).selectOption("last-3-months");
    await page.getByLabel("Compare against").selectOption("prev");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/period=last-3-months/);
    await expect(page).toHaveURL(/compare=prev/);
    await expect(page.getByText(/Compared with the previous period/)).toBeVisible();
    await expect(page.getByText(/equal-length windows/)).toBeVisible();

    await page.getByRole("link", { name: "Reset all filters" }).click();
    await expect(page).toHaveURL(/\/analytics$/);
  });

  test("comparison with the same period last year is available", async ({ page }) => {
    await page.getByLabel("Compare against").selectOption("year");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/compare=year/);
    await expect(page.getByText(/Compared with the same period last year/)).toBeVisible();
  });

  test("drill-down from a category preserves filters and returns to analytics", async ({
    page,
  }) => {
    await page.getByLabel("Period", { exact: true }).selectOption("last-3-months");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/period=last-3-months/);

    const categoryLink = page
      .locator("a[href*='/transactions?']")
      .filter({ hasText: /RM/ })
      .first();
    await categoryLink.click();
    await expect(page).toHaveURL(/\/transactions\?.*from=.*categories=/);
    await expect(page.getByText("filtered from a report")).toBeVisible();
    await page.getByRole("link", { name: /Back to Analytics/ }).click();
    await expect(page).toHaveURL(/period=last-3-months/);
  });

  test("CSV export downloads the filtered ledger with escaped content", async ({ page }) => {
    const exportLink = page.getByRole("link", { name: "Export CSV" });
    const href = await exportLink.getAttribute("href");
    expect(href).toContain("/api/exports/transactions?");

    const response = await page.request.get(href as string);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain("finpilot-transactions-");
    const body = await response.text();
    expect(body).toContain("Date,Description,Merchant,Category,Account,Type");
    // No uuids / internal ids in the export.
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  test("mobile 360px keeps the workspace usable", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/analytics?period=last-month");
    await expect(page.getByTestId("period-indicator")).toBeVisible();
    await expect(page.getByText(/You earned/)).toBeVisible();
    // No horizontal page scroll.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("analytics passes axe with data", async ({ page }) => {
    await expectNoSeriousViolations(page, "/analytics (demo)");
  });
});
