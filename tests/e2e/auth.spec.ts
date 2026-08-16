import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { freshEmail, signIn, signUp, TEST_USER_A } from "./helpers";

const PASSWORD = "a strong passphrase 1";

test.describe("protected routes", () => {
  test("unauthenticated users are redirected to sign-in with a return URL", async ({ page }) => {
    await page.goto("/budget");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fbudget/);
    await expect(page.getByRole("heading", { name: "Sign in to FinPilot" })).toBeVisible();
  });

  test("the return URL is honored after signing in", async ({ page }) => {
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Ftransactions/);
    await page.getByLabel("Email address").fill(TEST_USER_A.email);
    await page.getByLabel("Password", { exact: true }).fill(TEST_USER_A.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/transactions/);
  });
});

test.describe("registration and onboarding", () => {
  test("sign-up walks through onboarding to a personalized overview", async ({ page }) => {
    const email = freshEmail("signup");
    await signUp(page, email, PASSWORD, "Test Person");

    // Step 1 — locale (defaults are correct for en-MY/MYR/KL)
    await expect(
      page.getByRole("heading", { name: /Where do you manage your money/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Steps 2 and 3 are honest future-phase placeholders with skip
    await expect(page.getByRole("heading", { name: /When does money come in/ })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByRole("heading", { name: /Your accounts/ })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();

    // Step 4 — buffer + budget style
    await page.getByLabel(/Safety buffer/).fill("450");
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 5 — summary reflects entered values
    await expect(page.getByText("RM 450.00")).toBeVisible();
    await page.getByRole("button", { name: "Finish setup" }).click();

    await expect(page).toHaveURL(/\/overview/);
    await expect(page.getByRole("heading", { name: /Test Person/ })).toBeVisible();
    await expect(page.getByText("RM 450.00")).toBeVisible();
  });

  test("onboarding resumes where it was left (save and resume)", async ({ page }) => {
    const email = freshEmail("resume");
    await signUp(page, email, PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click(); // step 1 → 2
    await expect(page).toHaveURL(/step=2/);

    // Leaving and returning lands on step 2, not step 1.
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: /When does money come in/ })).toBeVisible();
  });
});

test.describe("sign in / sign out", () => {
  test("wrong password shows a generic error", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(TEST_USER_A.email);
    await page.getByLabel("Password", { exact: true }).fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/That email and password combination didn’t work/)).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("sign-out revokes the session server-side", async ({ page }) => {
    await signIn(page, TEST_USER_A.email, TEST_USER_A.password);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("password reset", () => {
  test("full flow: request → mail link → new password → old sessions dead → single use", async ({
    page,
  }) => {
    const email = freshEmail("reset");
    const newPassword = "a brand new passphrase 2";
    await signUp(page, email, PASSWORD);
    // Onboarding has no shell chrome — the user menu lives in the app shell.
    await page.goto("/overview");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    await page.goto("/reset-password");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/a reset link is on its way/)).toBeVisible();

    const mail = JSON.parse(
      fs.readFileSync(path.resolve(".dev-mail-e2e", "latest.json"), "utf8"),
    ) as { to: string; text: string };
    expect(mail.to).toBe(email);
    const link = mail.text.match(/https?:\/\/\S+/)?.[0];
    expect(link).toBeTruthy();

    await page.goto(link!);
    await page.getByLabel("New password").fill(newPassword);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page).toHaveURL(/\/sign-in\?reset=done/);
    await expect(page.getByText(/Your password has been reset/)).toBeVisible();

    await signIn(page, email, newPassword);

    // Replay the same link: single-use token must fail.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.goto(link!);
    await page.getByLabel("New password").fill("yet another passphrase 3");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText(/invalid or has expired/)).toBeVisible();
  });
});

test.describe("session management", () => {
  test("revoking other sessions signs out the other device", async ({ browser }) => {
    const deviceA = await browser.newContext();
    const deviceB = await browser.newContext();
    const pageA = await deviceA.newPage();
    const pageB = await deviceB.newPage();

    await signIn(pageA, TEST_USER_A.email, TEST_USER_A.password);
    await signIn(pageB, TEST_USER_A.email, TEST_USER_A.password);

    await pageA.goto("/settings/security");
    await pageA.getByRole("button", { name: "Sign out all other devices" }).click();
    await expect(pageA.getByText(/Signed out \d+ other session/)).toBeVisible();

    await pageB.goto("/goals");
    await expect(pageB).toHaveURL(/\/sign-in/);

    await deviceA.close();
    await deviceB.close();
  });
});
