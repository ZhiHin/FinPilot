import { sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";

const startedAt = Date.now();

/**
 * Liveness + readiness for monitors (Phase 10 observability, docs/ops/
 * observability.md). No auth by design, so the payload is strictly
 * non-sensitive: up/down flags, applied-migration count, queue backlog
 * counts, uptime. Never user data, never configuration values.
 */
export async function GET(): Promise<Response> {
  const db = getDb();

  let dbUp = false;
  let migrations: number | null = null;
  let queue: { pending: number; failed: number } | null = null;

  try {
    await db.execute(sql`select 1`);
    dbUp = true;
  } catch {
    // db stays marked down
  }

  if (dbUp) {
    try {
      const result = await db.execute<{ n: string }>(
        sql`select count(*)::bigint as n from drizzle.__drizzle_migrations`,
      );
      migrations = Number(result.rows[0]?.n ?? 0);
    } catch {
      // migrations table absent — reported as null
    }
    try {
      const result = await db.execute<{ pending: string; failed: string }>(sql`
        select count(*) filter (where state in ('created', 'retry', 'active'))::bigint as pending,
               count(*) filter (where state = 'failed')::bigint as failed
        from pgboss.job
      `);
      queue = {
        pending: Number(result.rows[0]?.pending ?? 0),
        failed: Number(result.rows[0]?.failed ?? 0),
      };
    } catch {
      // queue schema absent (workers not started yet) — reported as null
    }
  }

  const body = {
    ok: dbUp,
    db: dbUp ? "up" : "down",
    migrations,
    queue,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
  return Response.json(body, {
    status: dbUp ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
