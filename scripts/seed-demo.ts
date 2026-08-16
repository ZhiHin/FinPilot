/** Seeds the demo identity (idempotent). Requires a migrated DATABASE_URL. */
import pg from "pg";

import { createDb } from "../src/server/db/client";
import { DEMO_USER, seedDemo } from "../src/server/db/seeds/demo";
import { seedDemoFinancial } from "../src/server/db/seeds/demo-financial";

import { assertSeedTargetIsSafe, loadEnv } from "./lib/env";

async function main() {
  loadEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  assertSeedTargetIsSafe(connectionString);
  const pool = new pg.Pool({ connectionString, max: 3 });
  try {
    const db = createDb(pool);
    const identity = await seedDemo(db);
    console.log(
      identity.created
        ? `Demo user created: ${DEMO_USER.email} (password: ${DEMO_USER.password})`
        : `Demo user already present: ${DEMO_USER.email}.`,
    );
    const financial = await seedDemoFinancial(db);
    console.log(
      financial.created
        ? `Demo financial dataset created: ${financial.transactionCount} transactions across ${financial.months.length} months.`
        : "Demo financial dataset already present — nothing to do.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Demo seed failed:", error);
  process.exit(1);
});
