import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { freshEmail, signIn, signUp } from "./helpers";

const FIXTURE = path.resolve("tests", "fixtures", "statements", "maybank.csv");
const PASSWORD = "a strong passphrase 1";

async function expectNoSeriousViolations(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious,
    `${context}: ${serious.map((v) => `${v.id}: ${v.nodes.length} nodes`).join("; ")}`,
  ).toEqual([]);
}

test.describe.configure({ mode: "serial" });

let firstJobUrl: string | null = null;
let importUserEmail: string | null = null;

test.describe("CSV import wizard", () => {
  test("upload → map → review → confirm → results, end to end", async ({ page }) => {
    test.setTimeout(120_000);
    const email = freshEmail("import");
    importUserEmail = email;
    await signUp(page, email, PASSWORD);

    // One account to import into.
    await page.goto("/accounts");
    await page.getByRole("button", { name: "Add account" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Import Acct");
    await dialog.getByRole("button", { name: "Add account" }).click();
    await expect(dialog.getByText("Account created.")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    // Upload.
    await page.goto("/imports/new");
    await expectNoSeriousViolations(page, "/imports/new");
    await page.locator('input[name="file"]').setInputFiles(FIXTURE);
    await page.getByRole("button", { name: "Upload & continue" }).click();

    // Mapping step with suggestion + preview; save a reusable profile.
    await expect(page).toHaveURL(/\/imports\//);
    firstJobUrl = page.url();
    await expect(page.getByText("Map fields")).toBeVisible();
    await expect(page.getByText("SALARY CREDIT ADV DESIGN")).toBeVisible();
    await expectNoSeriousViolations(page, "import mapping step");
    await page.getByLabel(/Save this mapping/).fill("Maybank test profile");
    await page.getByRole("button", { name: "Check rows" }).click();

    // Background validation → review.
    await expect(page.getByText("6 will import")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("0 possible duplicates", { exact: false })).toBeVisible();
    await expectNoSeriousViolations(page, "import review step");
    await expect(
      page.getByText("Nothing is written to your ledger until you confirm."),
    ).toBeVisible();

    // Confirm → background commit → results.
    await page.getByRole("button", { name: /Import 6 transaction/ }).click();
    await expect(page.getByText("Added")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("Needs review").first()).toBeVisible();

    // The ledger reflects exactly the statement.
    await page.goto("/accounts");
    await expect(page.getByText("RM 4,966.90").first()).toBeVisible();
    await page.goto("/transactions");
    await expect(page.getByText("SALARY CREDIT ADV DESIGN").first()).toBeVisible();
  });

  test("re-importing the same statement is flagged as duplicates via the saved profile", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, importUserEmail!, PASSWORD);
    await page.goto("/imports/new");
    await page.locator('input[name="file"]').setInputFiles(FIXTURE);
    await page.getByRole("button", { name: "Upload & continue" }).click();

    await expect(page.getByText("Map fields")).toBeVisible();
    await page
      .getByLabel("Start from a template or saved profile")
      .selectOption({ label: "Maybank test profile" });
    await page.getByRole("button", { name: "Check rows" }).click();

    await expect(page.getByText("0 will import")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("6 possible duplicates", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Cancel import" }).click();
    await expect(page).toHaveURL(/\/imports$/);
  });

  test("import history lists both jobs; axe-clean", async ({ page }) => {
    await signIn(page, importUserEmail!, PASSWORD);
    await page.goto("/imports");
    await expect(page.getByText("Completed").first()).toBeVisible();
    await expect(page.getByText("maybank.csv").first()).toBeVisible();
    await expect(page.getByText("Maybank test profile")).toBeVisible();
    await expectNoSeriousViolations(page, "/imports history");
  });

  test("undo soft-deletes the imported transactions, restorable from Deleted", async ({ page }) => {
    test.setTimeout(60_000);
    expect(firstJobUrl).not.toBeNull();
    await signIn(page, importUserEmail!, PASSWORD);
    await page.goto(firstJobUrl!);
    await page.getByRole("button", { name: "Undo this import" }).click();
    // Revalidation swaps the page to the server-rendered undone state.
    await expect(page.getByText(/This import was undone/)).toBeVisible({ timeout: 15_000 });

    await page.goto("/transactions?view=deleted");
    await expect(page.getByText("SALARY CREDIT ADV DESIGN").first()).toBeVisible();
    await page.goto("/accounts");
    await expect(page.getByText("RM 0.00").first()).toBeVisible();
  });
});
