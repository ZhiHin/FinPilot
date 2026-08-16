/**
 * Applies all pending SQL migrations (src/server/db/migrations) to DATABASE_URL.
 * Forward-only: shipped migrations are never edited (ADR-017; ERD doc §5).
 */
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { loadEnv } from "./lib/env";

async function main() {
  loadEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await migrate(drizzle(client), {
      migrationsFolder: path.resolve("src/server/db/migrations"),
    });
    const { rows } = await client.query(
      `select hash, created_at from drizzle.__drizzle_migrations order by created_at`,
    );
    console.log(`Migrations up to date — ${rows.length} applied.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
