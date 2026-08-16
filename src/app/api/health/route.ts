import { sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";

/** Liveness + database connectivity. No auth, no data exposure. */
export async function GET(): Promise<Response> {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true, db: "up" });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}
