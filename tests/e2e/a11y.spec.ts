import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signIn, TEST_USER_B } from "./helpers";

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

test.describe("accessibility (axe)", () => {
  test("sign-in page", async ({ page }) => {
    await page.goto("/sign-in");
    await expectNoSeriousViolations(page, "/sign-in");
  });

  test("sign-up page", async ({ page }) => {
    await page.goto("/sign-up");
    await expectNoSeriousViolations(page, "/sign-up");
  });

  test("component gallery (light)", async ({ page }) => {
    await page.goto("/dev/components");
    await expectNoSeriousViolations(page, "/dev/components");
  });

  test.describe("authenticated screens", () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, TEST_USER_B.email, TEST_USER_B.password);
    });

    test("overview", async ({ page }) => {
      await page.goto("/overview");
      await expectNoSeriousViolations(page, "/overview");
    });

    test("settings profile", async ({ page }) => {
      await page.goto("/settings/profile");
      await expectNoSeriousViolations(page, "/settings/profile");
    });

    test("settings security", async ({ page }) => {
      await page.goto("/settings/security");
      await expectNoSeriousViolations(page, "/settings/security");
    });

    test("onboarding step 1", async ({ page }) => {
      await page.goto("/onboarding?step=1");
      await expectNoSeriousViolations(page, "/onboarding step 1");
    });

    test("placeholder page", async ({ page }) => {
      await page.goto("/budget");
      await expectNoSeriousViolations(page, "/budget placeholder");
    });

    test("accounts", async ({ page }) => {
      await page.goto("/accounts");
      await expectNoSeriousViolations(page, "/accounts");
    });

    test("categories settings", async ({ page }) => {
      await page.goto("/settings/categories");
      await expectNoSeriousViolations(page, "/settings/categories");
    });
  });

  test.describe("demo-data screens", () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, "aisyah.demo@finpilot.test", "demo-aisyah-2026");
    });

    test("transactions workspace with data", async ({ page }) => {
      await page.goto("/transactions");
      await expectNoSeriousViolations(page, "/transactions (demo)");
    });

    test("account detail with data", async ({ page }) => {
      await page.goto("/accounts");
      await page.getByText("Maybank current").first().click();
      await page.getByText("Reconcile against a statement").waitFor();
      await expectNoSeriousViolations(page, "/accounts/[id] (demo)");
    });
  });
});
