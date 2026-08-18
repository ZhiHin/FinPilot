import { eq, sql } from "drizzle-orm";

import { uuidv7 } from "@/lib/ids";
import { hashIdentifier } from "@/server/auth/tokens";
import type { Db } from "@/server/db/client";
import { usersRepo } from "@/server/db/repositories/users";
import { auditLogs, users } from "@/server/db/schema";

/**
 * Final stage of staged account deletion (Phase 10, spec V4 / PDPA retention):
 * hard-deletes every user whose recovery window has ended. All owned rows go
 * via ON DELETE CASCADE (verified per-table by the deletion integration
 * tests); audit_logs and ai_requests keep their rows with user_id set NULL —
 * security forensics and aggregate spend telemetry that contain no personal
 * data beyond salted hashes. The purge audit record itself carries only the
 * salted subject hash, never the email.
 *
 * Idempotent: a purged user no longer matches the due query, and re-running
 * on an empty set is a no-op — safe under pg-boss retries.
 */

export interface PurgeResult {
  purged: number;
}

async function countOwnedRows(db: Db, userId: string): Promise<Record<string, number>> {
  const tables = await db.execute<{ table_name: string }>(sql`
    select distinct table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'user_id'
    order by table_name
  `);
  const counts: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    const result = await db.execute<{ n: string }>(
      sql`select count(*)::bigint as n from ${sql.identifier(table_name)} where user_id = ${userId}`,
    );
    const n = Number(result.rows[0]?.n ?? 0);
    if (n > 0) counts[table_name] = n;
  }
  return counts;
}

export async function runAccountPurge(
  db: Db,
  options: { secret: string; now?: Date },
): Promise<PurgeResult> {
  const now = options.now ?? new Date();
  const due = await usersRepo.listDueForPurge(db, now);

  let purged = 0;
  for (const user of due) {
    const rowCounts = await countOwnedRows(db, user.id);
    await db.transaction(async (tx) => {
      await tx.delete(users).where(eq(users.id, user.id));
      await tx.insert(auditLogs).values({
        id: uuidv7(),
        userId: null,
        actor: "system",
        eventType: "account.purged",
        entityType: "user",
        entityId: user.id,
        subjectHash: hashIdentifier(user.email, options.secret),
        diff: {
          purgeAfter: user.purgeAfter?.toISOString() ?? null,
          rowCounts,
        },
      });
    });
    purged += 1;
  }
  return { purged };
}
