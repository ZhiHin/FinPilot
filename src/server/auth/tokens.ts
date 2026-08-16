import { createHash, createHmac, randomBytes } from "node:crypto";

/** 256-bit opaque token, base64url — used for sessions and password resets. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hash stored at rest instead of the raw token (DB leak ≠ session theft). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Keyed hash for identifiers we must correlate but never store raw
 * (emails for rate limiting, IP addresses for audit). Normalized so
 * "  Aisyah@Example.com " and "aisyah@example.com" collide intentionally.
 */
export function hashIdentifier(identifier: string, secret: string): string {
  const normalized = identifier.trim().toLowerCase();
  return createHmac("sha256", secret).update(normalized).digest("hex");
}
