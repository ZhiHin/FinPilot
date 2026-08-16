/**
 * Starts the project-managed embedded PostgreSQL 17 for development on port 5433.
 * Data persists in .pgdata/. The server runs while this script runs — keep the
 * terminal open (Ctrl+C to stop) or run `npm run db:stop` from another shell.
 *
 * DBeaver: connect to localhost:5433, database `finpilot`, user/password finpilot/finpilot.
 */
import fs from "node:fs";
import path from "node:path";

import EmbeddedPostgres from "embedded-postgres";

const DATA_DIR = path.resolve(".pgdata");
const PORT = 5433;
const USER = "finpilot";
const PASSWORD = "finpilot";
const DATABASE = "finpilot";

async function main() {
  const cluster = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: USER,
    password: PASSWORD,
    persistent: true,
    onLog: () => {},
    onError: () => {},
  });

  if (!fs.existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    console.log("Initialising PostgreSQL data directory (.pgdata)…");
    await cluster.initialise();
  }

  await cluster.start();

  const client = cluster.getPgClient("postgres");
  await client.connect();
  const exists = await client.query("select 1 from pg_database where datname = $1", [DATABASE]);
  if (exists.rowCount === 0) {
    await client.query(`create database ${DATABASE}`);
    console.log(`Created database "${DATABASE}".`);
  }
  await client.end();

  console.log(`PostgreSQL 17 running on port ${PORT}.`);
  console.log(`  DATABASE_URL=postgres://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`);
  console.log("  Press Ctrl+C to stop (or `npm run db:stop` from another terminal).");

  const shutdown = async () => {
    console.log("\nStopping PostgreSQL…");
    await cluster.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // Keep the process (and therefore the database) alive.
  setInterval(() => {}, 1 << 30);
}

main().catch((error) => {
  console.error("Failed to start the embedded database:", error);
  console.error(`If a previous run crashed, delete ${DATA_DIR} and try again.`);
  process.exit(1);
});
