import type { ZodType } from "zod";

/** Opaque keyset-pagination cursors: base64url JSON, Zod-validated on decode. */

export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor<T>(cursor: string, schema: ZodType<T>): T | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
