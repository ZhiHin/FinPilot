/**
 * Stops the embedded development PostgreSQL (started by `npm run db:start`)
 * by running `pg_ctl stop` against the .pgdata directory.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(".pgdata");

function findPgCtl(): string | null {
  const platformPackages = [
    "@embedded-postgres/windows-x64",
    "@embedded-postgres/linux-x64",
    "@embedded-postgres/darwin-x64",
    "@embedded-postgres/darwin-arm64",
    "@embedded-postgres/linux-arm64",
  ];
  const binary = process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl";
  for (const pkg of platformPackages) {
    const candidate = path.resolve("node_modules", pkg, "native", "bin", binary);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

if (!fs.existsSync(path.join(DATA_DIR, "postmaster.pid"))) {
  console.log("No running embedded database found (.pgdata/postmaster.pid missing).");
  process.exit(0);
}

const pgCtl = findPgCtl();
if (!pgCtl) {
  console.error("Could not locate pg_ctl in node_modules/@embedded-postgres/*.");
  process.exit(1);
}

const result = spawnSync(pgCtl, ["stop", "-D", DATA_DIR, "-m", "fast"], { stdio: "inherit" });
process.exit(result.status ?? 1);
