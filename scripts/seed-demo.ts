/** Seeds the demo identity (idempotent). Requires a migrated DATABASE_URL. */
import pg from "pg";

import { createDb } from "../src/server/db/client";
import { DEMO_USER, seedDemo } from "../src/server/db/seeds/demo";

import { loadEnv } from "./lib/env";

async function main() {
  loadEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const pool = new pg.Pool({ connectionString, max: 3 });
  try {
    const { created } = await seedDemo(createDb(pool));
    console.log(
      created
        ? `Demo user created: ${DEMO_USER.email} (password: ${DEMO_USER.password})`
        : `Demo user already present: ${DEMO_USER.email} — nothing to do.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Demo seed failed:", error);
  process.exit(1);
});
