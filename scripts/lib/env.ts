import fs from "node:fs";
import path from "node:path";

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
