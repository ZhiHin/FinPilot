/**
 * E2E web-server wrapper (invoked by playwright.config.ts webServer):
 * starts a fresh embedded PostgreSQL on port 5435, migrates, seeds the
 * deterministic test users, then runs `next dev --port 3100`. Everything lives
 * in this one process tree, so Playwright's shutdown kills database and server
 * together. Playwright's readiness probe on /api/health only passes once the
 * database is actually up.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

import { createDb } from "../src/server/db/client";
import { seedDemoFinancial } from "../src/server/db/seeds/demo-financial";
import { seedTestUsers } from "../src/server/db/seeds/test-users";

const DATA_DIR = path.resolve(".pgdata-e2e");
const PORT = 5435;
const USER = "finpilot";
const PASSWORD = "finpilot";
const DATABASE = "finpilot_e2e";

async function main() {
  fs.rmSync(path.resolve(".dev-mail-e2e"), { recursive: true, force: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  const cluster = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: USER,
    password: PASSWORD,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await cluster.initialise();
  await cluster.start();

  const admin = new pg.Client({
    connectionString: `postgres://${USER}:${PASSWORD}@localhost:${PORT}/postgres`,
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${DATABASE}`);
  await admin.end();

  const url = `postgres://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: path.resolve("src/server/db/migrations") });
  } finally {
    await client.end();
  }

  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const db = createDb(pool);
  await seedTestUsers(db);
  await seedDemoFinancial(db);
  await pool.end();

  console.log(`[e2e-server] database ready on :${PORT}; starting next dev on :3100`);

  const nextBin = path.resolve("node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "--port", "3100"], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    void cluster.stop().finally(() => process.exit(code ?? 0));
  });
}

main().catch((error) => {
  console.error("[e2e-server] failed:", error);
  process.exit(1);
});
