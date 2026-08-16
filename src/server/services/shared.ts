/** Cross-service helpers. Services are framework-free (architecture doc §2). */

export const UNIQUE_VIOLATION = "23505";

/** Postgres error code, whether the driver error is raw or wrapped by drizzle. */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as { code?: string; cause?: { code?: string } };
  return typeof e.code === "string" ? e.code : e.cause?.code;
}
