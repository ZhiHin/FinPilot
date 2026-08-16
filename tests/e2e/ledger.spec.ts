import { expect, test, type Page } from "@playwright/test";

import { signIn, TEST_USER_A } from "./helpers";

const DEMO = { email: "aisyah.demo@finpilot.test", password: "demo-aisyah-2026" };

async function addExpense(
  page: Page,
  opts: { amount: string; merchant?: string; needsReview?: boolean },
): Promise<void> {
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount").fill(opts.amount);
  if (opts.merchant) {
    await dialog.getByLabel(/Merchant/).fill(opts.merchant);
  }
  if (opts.needsReview) {
    await dialog.getByLabel("Needs review").check();
  }
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog.getByText("Transaction added.")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("accounts and ledger journey (user A)", () => {
  test("create accounts and see balances and net position", async ({ page }) => {
    await signIn(page, TEST_USER_A.email, TEST_USER_A.password);
    await page.goto("/accounts");

    await page.getByRole("button", { name: "Add account" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Maybank");
    await dialog.getByLabel("Opening balance").fill("1000");
    await dialog.getByRole("button", { name: "Add account" }).click();
    await expect(dialog.getByText("Account created.")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    await page.getByRole("button", { name: "Add account" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("TnG");
    await dialog.getByLabel("Type").selectOption("ewallet");
    await dialog.getByLabel("Opening balance").fill("100");
    await dialog.getByRole("button", { name: "Add account" }).click();
    await expect(dialog.getByText("Account created.")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    await expect(page.getByRole("link", { name: /Maybank/ })).toBeVisible();
    await expect(page.getByText("RM 1,000.00")).toBeVisible();
    await expect(page.getByText("Net worth (MYR)")).toBeVisible();
    await expect(page.getByText("RM 1,100.00").first()).toBeVisible();
  });

  test("add an expense with merchant and category; summary reflects it", async ({ page }) => {
    await signIn(page, TEST_USER_A.email, TEST_USER_A.password);
    await page.goto("/transactions");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount").fill("32.50");
    await dialog.getByLabel(/Merchant/).fill("GrabFood KL");
    await dialog.getByLabel("Category").selectOption({ label: "Food delivery" });
    await dialog.getByRole("button", { name: "Add transaction" }).click();
    await expect(dialog.getByText("Transaction added.")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    await expect(page.getByText("Grabfood Kl").first()).toBeVisible();
    // Row amount + summary-bar expenses both show the figure.
    await expect(page.getByText("RM 32.50").nth(1)).toBeVisible();
  });

  test("transfers move balances but never income or expenses (invariant 1)", async ({ page }) => {
    await signIn(page, TEST_USER_A.email, TEST_USER_A.password);
    await page.goto("/transactions");
    const summaryBefore = await page
      .getByText(/Expenses/)
      .locator("..")
      .textContent();

    await page.getByRole("button", { name: "Transfer" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("From").selectOption({ label: "Maybank (MYR)" });
    await dialog.getByLabel("To").selectOption({ label: "TnG (MYR)" });
    await dialog.getByLabel("Amount").fill("100");
    await dialog.getByRole("button", { name: "Record transfer" }).click();
    await expect(dialog.getByText("Transfer recorded.")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    // Both legs appear, labeled as transfers.
    await expect(page.getByText("Transfer to TnG").first()).toBeVisible();
    await expect(page.getByText("Transfer from Maybank").first()).toBeVisible();
    // The expense summary is unchanged by the transfer.
    const summaryAfter = await page
      .getByText(/Expenses/)
      .locator("..")
      .textContent();
    expect(summaryAfter).toBe(summaryBefore);

    // Balances did move.
    await page.goto("/accounts");
    await expect(page.getByText("RM 867.50")).toBeVisible(); // 1000 − 32.50 − 100
    await expect(page.getByText("RM 200.00").first()).toBeVisible(); // 100 + 100
  });

  test("edit a transaction into splits; totals and history follow", async ({ page }) => {
    await signIn(page, TEST_USER_A.email, TEST_USER_A.password);
    await page.goto("/transactions");
    await page.getByText("Grabfood Kl").first().click();

    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("History")).toBeVisible();
    await drawer.getByLabel("Amount").fill("40.00");
    await drawer.getByRole("button", { name: "Add split" }).click();
    await drawer.getByLabel("Split 1 amount").fill("25.00");
    await drawer.getByLabel("Split 1 category").selectOption({ label: "Food & drink · Groceries" });
    await drawer.getByRole("button", { name: "Add split" }).click();
    await drawer.getByLabel("Split 2 amount").fill("15.00");
    await drawer
      .getByLabel("Split 2 category")
      .selectOption({ label: "Food & drink · Eating out" });
    await drawer.getByRole("button", { name: "Save changes" }).click();
    await expect(drawer.getByText("Transaction saved.")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByText("RM 40.00").first()).toBeVisible();
    await expect(page.getByText("Split").first()).toBeVisible();

    // History records the amount change.
    await page.getByText("Grabfood Kl").first().click();
    await expect(page.getByRole("dialog").getByText(/amountMinor: -3250 → -4000/)).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("review workflow: flag, filter, bulk-clear", async ({ page }) => {
    await signIn(page, TEST_USER_A.email, TEST_USER_A.password);
    await page.goto("/transactions");
    await addExpense(page, { amount: "7.77", merchant: "Review Me", needsReview: true });

    await page.goto("/transactions?view=review");
    await expect(page.getByText("Review Me").first()).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(page.getByText(/Updated \d+ transaction/)).toBeVisible();
    await expect(page.getByText("Review Me").first()).toBeHidden();
  });

  test("tag filter control narrows the list", async ({ page }) => {
    test.setTimeout(60_000); // walks three screens; first-compile can be slow in dev
    await signIn(page, TEST_USER_A.email, TEST_USER_A.password);

    // Create a tag, then a transaction carrying it.
    await page.goto("/settings/categories?tab=tags");
    await page.getByLabel("New tag").fill("holiday");
    await page.getByRole("button", { name: "Add tag" }).click();
    await expect(page.getByText("Tag created.")).toBeVisible();

    await page.goto("/transactions");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount").fill("9.99");
    await dialog.getByLabel(/Merchant/).fill("Tagged Spend");
    await dialog.getByText("holiday").click();
    await dialog.getByRole("button", { name: "Add transaction" }).click();
    await expect(dialog.getByText("Transaction added.")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    // Filter by the tag: only the tagged row remains.
    await page
      .getByRole("combobox", { name: "Tag", exact: true })
      .selectOption({ label: "holiday" });
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/tags=/);
    await expect(page.getByText("Tagged Spend").first()).toBeVisible();
    await expect(page.getByText("Grabfood Kl")).toHaveCount(0);
  });

  test("soft delete and restore round-trips through the Deleted view", async ({ page }) => {
    await signIn(page, TEST_USER_A.email, TEST_USER_A.password);
    await page.goto("/transactions");
    await addExpense(page, { amount: "5.55", merchant: "Delete Me" });

    await page.getByText("Delete Me").first().click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("button", { name: "Delete transaction" }).click();
    await expect(drawer.getByText(/deleted/i).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Delete Me").first()).toBeHidden();

    await page.goto("/transactions?view=deleted");
    await page.getByText("Delete Me").first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("dialog").getByText("Restored.")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/transactions");
    await expect(page.getByText("Delete Me").first()).toBeVisible();
  });
});

test.describe("demo dataset experience", () => {
  test("demo user sees a populated workspace with keyset pagination", async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password);
    await page.goto("/transactions");

    await expect(page.getByRole("table")).toBeVisible();
    const firstPageFirstRow = await page
      .getByRole("table")
      .locator("tbody tr")
      .first()
      .textContent();

    await page.getByRole("link", { name: "Next page →" }).click();
    await expect(page).toHaveURL(/cursor=/);
    const secondPageFirstRow = await page
      .getByRole("table")
      .locator("tbody tr")
      .first()
      .textContent();
    expect(secondPageFirstRow).not.toBe(firstPageFirstRow);

    await page.getByRole("link", { name: "Back to first page" }).click();
    await expect(page).not.toHaveURL(/cursor=/);
  });

  test("demo accounts page shows the seven accounts with per-currency positions", async ({
    page,
  }) => {
    await signIn(page, DEMO.email, DEMO.password);
    await page.goto("/accounts");
    for (const name of ["Maybank current", "TnG eWallet", "Visa credit card", "PTPTN loan"]) {
      await expect(page.getByText(name).first()).toBeVisible();
    }
    await expect(page.getByText("Net worth (MYR)")).toBeVisible();
    await expect(page.getByText("Liabilities")).toBeVisible();
  });

  test("mobile 360px shows cards instead of the table", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signIn(page, DEMO.email, DEMO.password);
    await page.goto("/transactions");
    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.locator("ul.lg\\:hidden li").first()).toBeVisible();
  });
});
