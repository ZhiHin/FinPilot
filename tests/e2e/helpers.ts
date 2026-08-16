import { expect, type Page } from "@playwright/test";

export const TEST_USER_A = { email: "e2e-a@finpilot.test", password: "e2e-password-alpha" };
export const TEST_USER_B = { email: "e2e-b@finpilot.test", password: "e2e-password-bravo" };

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview/);
}

export async function signUp(
  page: Page,
  email: string,
  password: string,
  name?: string,
): Promise<void> {
  await page.goto("/sign-up");
  if (name) {
    await page.getByLabel("Name (optional)").fill(name);
  }
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
}

let unique = 0;

/** Unique per-run email so specs never collide across retries/runs. */
export function freshEmail(prefix: string): string {
  unique += 1;
  return `${prefix}-${Date.now()}-${unique}@finpilot.test`;
}
