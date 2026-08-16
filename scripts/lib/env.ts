import fs from "node:fs";
import path from "node:path";

/**
 * Guard for seed scripts: synthetic demo/test data is development-only.
 * Refuses non-local database hosts and production NODE_ENV unless the operator
 * explicitly sets ALLOW_REMOTE_SEED=yes (a deliberate, auditable override).
 */
export function assertSeedTargetIsSafe(connectionString: string): void {
  if (process.env.ALLOW_REMOTE_SEED === "yes") return;
  const problems: string[] = [];
  if (process.env.NODE_ENV === "production") {
    problems.push("NODE_ENV is 'production'");
  }
  try {
    const host = new URL(connectionString).hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
      problems.push(`database host '${host}' is not local`);
    }
  } catch {
    problems.push("DATABASE_URL could not be parsed");
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to seed synthetic demo/test data: ${problems.join("; ")}. ` +
        `Seeds are development-only. Set ALLOW_REMOTE_SEED=yes to override deliberately.`,
    );
  }
}

/** Minimal .env loader for CLI scripts (Next.js loads .env itself). */
export function loadEnv(file = ".env"): void {
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8").replace(/^﻿/, "");
  for (const line of content.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^"(.*)"$/, "$1");
  }
}
