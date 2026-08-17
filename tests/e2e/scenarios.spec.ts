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

function futureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

/** Create a scenario with one one-time purchase and save it under `name`. */
async function buildScenario(page: Page, name: string, amount: string, onDate: string) {
  await page.goto("/scenarios");
  await page.getByRole("button", { name: "New scenario" }).click();
  await expect(page).toHaveURL(/\/scenarios\/[0-9a-f-]+/);
  await page.locator("#event-date").fill(onDate);
  await page.locator("#event-amount").fill(amount);
  await page.getByRole("button", { name: "Add event" }).click();
  await expect(page.locator("li").filter({ hasText: "One-time purchase" }).first()).toBeVisible();
  await page.locator("#scenario-name").fill(name);
  await page.getByRole("button", { name: "Save scenario" }).click();
  await expect(page.getByRole("button", { name: "Update name/notes" })).toBeVisible();
}

test.describe("Scenario Lab (demo data)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password);
  });

  test("Journey 4: build, inspect, and save a laptop scenario — real records untouched", async ({
    page,
  }) => {
    // Prime recurring patterns so the projection includes bills/income.
    await page.goto("/recurring");
    await page.getByRole("table").waitFor();

    // Snapshot real balances before any scenario work.
    await page.goto("/accounts");
    const balancesBefore = await page.locator("main").innerText();

    await page.goto("/scenarios");
    await expect(page.getByText(/never change your records/)).toBeVisible();
    await page.getByRole("button", { name: "New scenario" }).click();
    await expect(page).toHaveURL(/\/scenarios\/[0-9a-f-]+/);
    await expect(page.getByText(/Draft — give it a name/)).toBeVisible();
    await expect(page.getByText("No events yet", { exact: false })).toBeVisible();

    // One-time RM 2,800 purchase three weeks out.
    await page.locator("#event-date").fill(futureDate(21));
    await page.locator("#event-amount").fill("2800");
    await page.getByRole("button", { name: "Add event" }).click();
    const eventRow = page.locator("li").filter({ hasText: "One-time purchase" }).first();
    await expect(eventRow).toBeVisible();
    await expect(eventRow.getByText(/RM\s2,800\.00 on/)).toBeVisible();

    // Centre: projection with band + baseline; table alternative present.
    await expect(page.getByText(/^Projected balance ·/)).toBeVisible();
    await page
      .getByRole("tablist", { name: /Projected balance/ })
      .getByRole("tab", { name: "Table" })
      .click();
    await expect(page.getByRole("columnheader", { name: "Baseline" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Conservative" })).toBeVisible();

    // Right: impact summary with lowest balance and the safer-date sentence.
    await expect(page.getByText("Lowest expected balance")).toBeVisible();
    await expect(page.getByText(/Safer purchase date:/)).toBeVisible();
    await expect(page.getByText("End-of-horizon difference")).toBeVisible();

    // Explicit save.
    await page.locator("#scenario-name").fill("Laptop — Sept");
    await page.getByRole("button", { name: "Save scenario" }).click();
    await expect(page.getByRole("button", { name: "Update name/notes" })).toBeVisible();

    // Real records: byte-identical account balances.
    await page.goto("/accounts");
    expect(await page.locator("main").innerText()).toBe(balancesBefore);

    // The saved scenario appears in the list.
    await page.goto("/scenarios");
    await expect(page.getByRole("link", { name: "Laptop — Sept" })).toBeVisible();
    await expect(page.getByText("Saved").first()).toBeVisible();
  });

  test("compare renders two impact columns over one shared chart", async ({ page }) => {
    await buildScenario(page, "Laptop — Nov", "2800", futureDate(75));

    await page.goto("/scenarios");
    await page.locator("#compare-a").selectOption({ label: "Laptop — Sept" });
    await page.locator("#compare-b").selectOption({ label: "Laptop — Nov" });
    await page.getByRole("button", { name: "Compare A vs B" }).click();

    await expect(page).toHaveURL(/\/scenarios\/compare\?/);
    await expect(page.getByText("Compare scenarios")).toBeVisible();
    await expect(page.getByRole("heading", { name: "A · Laptop — Sept" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "B · Laptop — Nov" })).toBeVisible();
    await expect(page.getByText(/^Projected balance · A vs B/)).toBeVisible();
  });

  test("scenario pages pass axe", async ({ page }) => {
    await page.goto("/scenarios");
    await expectNoSeriousViolations(page, "/scenarios");
    await page.getByRole("link", { name: "Laptop — Sept" }).click();
    await expect(page.getByText("Scenario inputs")).toBeVisible();
    await expectNoSeriousViolations(page, "/scenarios/[id]");
  });

  test("mobile 360px keeps the editor usable", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/scenarios");
    await page.getByRole("link", { name: "Laptop — Sept" }).click();
    await expect(page.getByText("Scenario inputs")).toBeVisible();
    await expect(page.getByText("Lowest expected balance")).toBeVisible();
  });
});

test.describe("Decision Journal (demo data)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password);
    await page.goto("/journal");
  });

  test("the seeded one-off travel period is annotated and excluded (Journey 7)", async ({
    page,
  }) => {
    const entry = page.locator("li").filter({ hasText: "Travel — family wedding" });
    await expect(entry).toBeVisible();
    await expect(entry.getByText("Excluded from baselines")).toBeVisible();
    await expect(entry.getByText("Life event")).toBeVisible();
  });

  test("a decision entry gets an outcome review when due (Journey 6)", async ({ page }) => {
    await page.locator("#entry-kind").selectOption("decision");
    await page.locator("#entry-title").fill("Cancelled duplicate storage");
    await page.locator("#entry-start").fill("2026-05-01");
    await page.locator("#entry-saving").fill("12");
    await page.locator("#entry-review").fill("2026-08-01");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Journal entry saved.")).toBeVisible();

    // The past review date lands it in "Outcome reviews due".
    await page.goto("/journal");
    const review = page
      .locator("section")
      .filter({ hasText: "Outcome reviews due" })
      .locator("div")
      .filter({ hasText: "Cancelled duplicate storage" })
      .first();
    await expect(review).toBeVisible();
    await review.getByLabel("Did it happen?").selectOption("partly");
    await review.getByRole("button", { name: "Record outcome" }).click();
    // End state, not the transient banner: revalidation drops the entry out
    // of the due section entirely once the outcome is recorded.
    await expect(
      page
        .locator("section")
        .filter({ hasText: "Outcome reviews due" })
        .getByText("Cancelled duplicate storage"),
    ).toHaveCount(0, { timeout: 15000 });

    await page.goto("/journal");
    const entry = page.locator("li").filter({ hasText: "Cancelled duplicate storage" });
    await expect(entry.getByText("Outcome: partly")).toBeVisible();
  });

  test("deleting an entry removes it permanently", async ({ page }) => {
    await page.locator("#entry-kind").selectOption("note");
    await page.locator("#entry-title").fill("Temporary note");
    await page.locator("#entry-start").fill("2026-08-01");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Journal entry saved.")).toBeVisible();

    await page.goto("/journal");
    const entry = page.locator("li").filter({ hasText: "Temporary note" });
    await expect(entry).toBeVisible();
    await entry.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("li").filter({ hasText: "Temporary note" })).toHaveCount(0, {
      timeout: 15000,
    });
    await page.reload();
    await expect(page.locator("li").filter({ hasText: "Temporary note" })).toHaveCount(0);
  });

  test("journal passes axe (desktop and 360px)", async ({ page }) => {
    await expectNoSeriousViolations(page, "/journal");
    await page.setViewportSize({ width: 360, height: 740 });
    await expectNoSeriousViolations(page, "/journal @360");
  });
});
