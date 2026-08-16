import fs from "node:fs";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

import { connectionUrl, DATA_DIR, INT_PASSWORD, INT_PORT, INT_USER, TEMPLATE_DB } from "./harness";

const MIGRATIONS_FOLDER = path.resolve("src/server/db/migrations");

export default async function setup(): Promise<() => Promise<void>> {
  const cluster = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: INT_PORT,
    user: INT_USER,
    password: INT_PASSWORD,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });

  if (!fs.existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    await cluster.initialise();
  }
  try {
    await cluster.start();
  } catch (error) {
    throw new Error(
      `Could not start the embedded integration PostgreSQL on port ${INT_PORT}. ` +
        `If a previous run crashed, delete ${DATA_DIR} and check for orphaned postgres processes. ` +
        `Original error: ${String(error)}`,
    );
  }

  try {
    // Fresh, fully migrated template database for this run.
    const admin = new pg.Client({ connectionString: connectionUrl() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
    await admin.end();

    const client = new pg.Client({ connectionString: connectionUrl(TEMPLATE_DB) });
    await client.connect();
    try {
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await client.end();
    }
  } catch (error) {
    await cluster.stop().catch(() => {});
    throw error;
  }

  return async () => {
    await cluster.stop();
  };
}
