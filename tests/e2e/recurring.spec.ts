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

test.describe("recurring & subscriptions (demo data)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password);
    await page.goto("/recurring");
  });

  test("detection finds the seeded bills on first visit, labeled inferred", async ({ page }) => {
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    for (const name of ["Unifi", "Netflix", "Spotify", "Hotlink"]) {
      await expect(table.getByText(name, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Inferred").first()).toBeVisible();
    await expect(page.getByText(/deterministic rule/)).toBeVisible();
    // Confidence is text, not color.
    await expect(page.getByText(/High|Medium|Low/).first()).toBeVisible();
  });

  test("Spotify shows evidence-backed price change with acknowledge", async ({ page }) => {
    await expect(page.getByText(/Price change evidence/)).toBeVisible();
    await expect(page.getByText(/RM\s16\.90\s×5/)).toBeVisible();
    await expect(page.getByText(/RM\s23\.90/).first()).toBeVisible();
    await page.getByRole("button", { name: "Acknowledge price change" }).click();
    // Acknowledging retires the evidence row (it unmounts on revalidation).
    await expect(page.getByText(/Price change evidence/)).toBeHidden();
  });

  test("BNPL installment is an estimate until the user sets the total", async ({ page }) => {
    const row = page.getByRole("row").filter({ hasText: "Spaylater" }).first();
    await expect(row.getByText("BNPL estimate")).toBeVisible();
    await expect(row.getByText(/4 payment\(s\) observed — total unconfirmed/)).toBeVisible();
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Total payments").fill("6");
    await page.getByRole("button", { name: "Save pattern" }).click();
    await expect(page.getByText(/Pattern updated/)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(/4 of 6 payments — 2 left/)).toBeVisible();
  });

  test("confirming a pattern replaces its confidence with certainty", async ({ page }) => {
    const row = page.getByRole("row").filter({ hasText: "Unifi" }).first();
    await row.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: "Unifi" })
        .first()
        .getByText("Confirmed", { exact: true }),
    ).toBeVisible();
  });

  test("filters narrow the list; subscriptions filter shows subscription rows", async ({
    page,
  }) => {
    await page.getByRole("navigation", { name: "Filter" }).getByText("Subscriptions").click();
    await expect(page).toHaveURL(/filter=subscriptions/);
    const table = page.getByRole("table");
    await expect(table.getByText("Netflix", { exact: true }).first()).toBeVisible();
    await expect(table.getByText("Unifi", { exact: true })).toBeHidden();
  });

  test("calendar view renders a month grid with payday marker", async ({ page }) => {
    await page.getByRole("navigation", { name: "View" }).getByText("Calendar").click();
    await expect(page).toHaveURL(/view=calendar/);
    await expect(page.getByRole("table", { name: /Bill calendar/ })).toBeVisible();
    await page.getByRole("link", { name: "Next month →" }).click();
    // Next month contains the projected bills and the payday chip.
    await expect(page.getByText("Payday")).toBeVisible();
    await expect(
      page
        .getByRole("table", { name: /Bill calendar/ })
        .getByText("Unifi")
        .first(),
    ).toBeVisible();
  });

  test('"Not recurring" removes a pattern for good', async ({ page }) => {
    const row = page.getByRole("row").filter({ hasText: "Fitness First" }).first();
    await row.getByRole("button", { name: "Not recurring" }).click();
    // The row (and its inline banner) unmounts on success — assert the end state.
    await expect(page.getByRole("table").getByText("Fitness First", { exact: true })).toBeHidden();
    // Rescan does not resurrect it.
    await page.getByRole("button", { name: "Rescan transactions" }).click();
    await expect(page.getByText(/Scan complete/)).toBeVisible();
    await expect(page.getByRole("table").getByText("Fitness First", { exact: true })).toBeHidden();
  });

  test("mobile 360px shows pattern cards", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/recurring");
    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.locator("ul.lg\\:hidden").getByText("Netflix").first()).toBeVisible();
  });

  test("recurring list and calendar pass axe", async ({ page }) => {
    await expectNoSeriousViolations(page, "/recurring (demo)");
    await page.goto("/recurring?view=calendar");
    await page.getByRole("table", { name: /Bill calendar/ }).waitFor();
    await expectNoSeriousViolations(page, "/recurring calendar (demo)");
  });

  test("dashboard shows the upcoming-bills card", async ({ page }) => {
    await page.goto("/overview");
    await expect(page.getByRole("heading", { name: "Upcoming bills" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open recurring" })).toBeVisible();
  });
});
