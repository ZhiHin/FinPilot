/** Seeds deterministic e2e/integration users (idempotent). Never run in production. */
import pg from "pg";

import { createDb } from "../src/server/db/client";
import { seedTestUsers, TEST_USERS } from "../src/server/db/seeds/test-users";

import { assertSeedTargetIsSafe, loadEnv } from "./lib/env";

async function main() {
  loadEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  assertSeedTargetIsSafe(connectionString);
  const pool = new pg.Pool({ connectionString, max: 3 });
  try {
    await seedTestUsers(createDb(pool));
    console.log(`Test users ready: ${TEST_USERS.map((u) => u.email).join(", ")}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Test seed failed:", error);
  process.exit(1);
});
