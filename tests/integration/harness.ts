import path from "node:path";

import pg from "pg";

/**
 * Integration tests run against a real embedded PostgreSQL 17 cluster
 * (started once in global-setup.ts, port 5434). Each test file clones its own
 * database from the migrated template so files are fully isolated.
 */
export const INT_PORT = 5434;
export const INT_USER = "finpilot";
export const INT_PASSWORD = "finpilot";
export const TEMPLATE_DB = "finpilot_int_template";
export const DATA_DIR = path.resolve(".pgdata-int");

export function connectionUrl(database = "postgres"): string {
  return `postgres://${INT_USER}:${INT_PASSWORD}@localhost:${INT_PORT}/${database}`;
}

let counter = 0;

export interface TestDatabase {
  url: string;
  pool: pg.Pool;
  drop: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  counter += 1;
  const name = `finpilot_int_${process.pid}_${counter}`;

  const admin = new pg.Client({ connectionString: connectionUrl() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`);
  await admin.end();

  const url = connectionUrl(name);
  const pool = new pg.Pool({ connectionString: url, max: 5 });

  return {
    url,
    pool,
    drop: async () => {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: connectionUrl() });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}
