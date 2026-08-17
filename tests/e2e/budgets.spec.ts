import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshEmail, signIn, signUp } from "./helpers";

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

test.describe("budget workspace (demo data)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password);
    await page.goto("/budget");
  });

  test("renders the payday cycle with totals, category rows, and health labels", async ({
    page,
  }) => {
    await expect(page.getByText(/Monthly essentials/)).toBeVisible();
    await expect(page.getByText(/payday cycle/)).toBeVisible();
    for (const label of ["Planned", "Spent (posted)", "Remaining", "Pending"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    for (const category of ["Groceries", "Eating out", "Petrol"]) {
      await expect(table.getByText(category, { exact: true }).first()).toBeVisible();
    }
    // Health is text, never color alone.
    await expect(
      page.getByText(/On track|Watch|At risk|Exceeded|No activity|Not started/).first(),
    ).toBeVisible();
    await expect(page.getByText("Cycle health:")).toBeVisible();
    // Deterministic-pace explainer, never presented as a prediction.
    await expect(page.getByText(/deterministic rule, not a prediction/)).toBeVisible();
  });

  test("navigates to the previous period and back", async ({ page }) => {
    await page.getByRole("link", { name: "← Previous" }).click();
    await expect(page).toHaveURL(/period=/);
    await expect(page.getByRole("table").getByText("Groceries", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Next →" }).click();
    await expect(page.getByRole("table").getByText("Groceries", { exact: true })).toBeVisible();
  });

  test("edits an allocation through the dialog", async ({ page }) => {
    const groceriesRow = page.getByRole("row").filter({ hasText: "Groceries" });
    await groceriesRow.getByRole("button", { name: "Edit" }).click();
    const planned = page.getByLabel("Planned amount");
    await planned.fill("800");
    await page.getByRole("button", { name: "Save allocation" }).click();
    await expect(page.getByText("Allocation saved.")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(
      page.getByRole("row").filter({ hasText: "Groceries" }).getByText("RM 800.00"),
    ).toBeVisible();
  });

  test("allocates a new category", async ({ page }) => {
    await page.getByRole("button", { name: "Allocate category" }).first().click();
    await page
      .getByLabel("Category", { exact: true })
      .selectOption({ label: "Public transport — Transport" });
    await page.getByLabel("Planned amount").fill("120");
    await page.getByRole("button", { name: "Add allocation" }).click();
    await expect(page.getByText("Allocation saved.")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("table").getByText("Public transport")).toBeVisible();
  });

  test("copy previous period restores a removed allocation", async ({ page }) => {
    // Remove Coffee & snacks… (the row — and its dialog — vanish on success).
    const coffeeRow = page.getByRole("row").filter({ hasText: "Coffee & snacks" });
    await coffeeRow.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Remove this allocation" }).click();
    await expect(page.getByRole("table").getByText("Coffee & snacks")).toBeHidden();
    await page.keyboard.press("Escape"); // dismiss the (now orphaned) dialog if present
    // …then copy it back from the previous cycle.
    await page.getByRole("button", { name: "Copy previous period" }).click();
    await expect(page.getByText(/Copied 1 allocation/)).toBeVisible();
    await expect(page.getByRole("table").getByText("Coffee & snacks")).toBeVisible();
  });

  test("category names drill down to filtered transactions with a way back", async ({ page }) => {
    await page.getByRole("table").getByRole("link", { name: "Groceries" }).click();
    await expect(page).toHaveURL(/\/transactions\?.*categories=/);
    await expect(page.getByText("filtered from a report")).toBeVisible();
    await page.getByRole("link", { name: /Back to Budget/ }).click();
    await expect(page).toHaveURL(/\/budget/);
  });

  test("mobile 360px shows allocation cards instead of the table", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/budget");
    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.locator("ul.lg\\:hidden").getByText("Groceries").first()).toBeVisible();
  });

  test("budget workspace passes axe", async ({ page }) => {
    await expectNoSeriousViolations(page, "/budget (demo)");
  });
});

test.describe("creating a budget (fresh user)", () => {
  test("zero-based budget: create, set expected income, watch unallocated", async ({ page }) => {
    await signUp(page, freshEmail("budget"), "a strong passphrase 1", "Budget Person");
    await page.goto("/budget");

    // First-run create form.
    await expect(page.getByText("Create your budget")).toBeVisible();
    await page.getByLabel("Name").fill("Fresh start");
    await page.getByLabel("Mode", { exact: true }).selectOption("zero_based");
    await page.getByLabel("Cycle", { exact: true }).selectOption("calendar_month");
    await page.getByRole("button", { name: "Create budget" }).click();
    // Revalidation swaps the create form for the live workspace.
    await page.goto("/budget");
    await expect(page.getByText(/Fresh start/)).toBeVisible();
    // Zero-based prompt until income is set.
    await expect(page.getByText(/set this cycle.+expected income/i)).toBeVisible();
    await page.getByRole("button", { name: "Income & notes" }).click();
    await page.getByLabel("Expected income this cycle").fill("5000");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Period details saved.")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(/Unallocated income/)).toBeVisible();
    await expect(page.getByText("RM 5,000.00").first()).toBeVisible();

    // Allocate part of it; the unallocated banner shrinks accordingly.
    await page.getByRole("button", { name: "Allocate category" }).first().click();
    await page
      .getByLabel("Category", { exact: true })
      .selectOption({ label: "Groceries — Food & drink" });
    await page.getByLabel("Planned amount").fill("1500");
    await page.getByRole("button", { name: "Add allocation" }).click();
    await expect(page.getByText("Allocation saved.")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("RM 3,500.00").first()).toBeVisible();

    // Empty-state niceties: new budget has no spending yet.
    await expect(page.getByText(/No activity|On track/).first()).toBeVisible();
  });
});
