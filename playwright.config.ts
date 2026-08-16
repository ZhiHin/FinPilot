import { defineConfig, devices } from "@playwright/test";

// E2E runs against a dedicated embedded PostgreSQL instance (port 5435, started in
// tests/e2e/global-setup.ts) and a dev server on port 3100, fully isolated from the
// developer's own database and dev server.
const E2E_ENV = {
  DATABASE_URL: "postgres://finpilot:finpilot@localhost:5435/finpilot_e2e",
  AUTH_SECRET: "e2e-only-secret-not-for-production-use",
  DEV_MAIL_DIR: ".dev-mail-e2e",
  APP_BASE_URL: "http://localhost:3100",
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    // Starts embedded PostgreSQL (5435) + migrations + seeds + next dev (3100)
    // in one process tree; /api/health passes only when the database is up.
    command: "npx tsx scripts/e2e-server.ts",
    url: "http://localhost:3100/api/health",
    reuseExistingServer: false,
    timeout: 240_000,
    env: E2E_ENV,
  },
});
