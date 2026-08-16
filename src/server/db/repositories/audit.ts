import { and, count, desc, eq, gt } from "drizzle-orm";

import type { Db } from "../client";
import { auditLogs } from "../schema";

export type AuditRow = typeof auditLogs.$inferSelect;

export interface AuditEvent {
  id: string;
  userId?: string | null;
  actor: "user" | "system" | "ai";
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Redacted before/after payload — never raw financial detail or secrets. */
  diff?: unknown;
  ipHash?: string | null;
  subjectHash?: string | null;
  userAgent?: string | null;
}

export const auditRepo = {
  async record(db: Db, event: AuditEvent): Promise<void> {
    await db.insert(auditLogs).values(event);
  },

  /** Change history for one entity, scoped to its owner (drawer "History" section). */
  async listForEntity(
    db: Db,
    userId: string,
    entityType: string,
    entityId: string,
    limit = 20,
  ): Promise<AuditRow[]> {
    return db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, userId),
          eq(auditLogs.entityType, entityType),
          eq(auditLogs.entityId, entityId),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  },

  /**
   * Counts recent events of a type for rate limiting, keyed by subjectHash
   * (salted identifier) and/or ipHash. audit_logs is the storage so limits
   * stay within the approved Phase 1 tables and survive restarts.
   */
  async countRecentEvents(
    db: Db,
    args: { eventType: string; since: Date; subjectHash?: string; ipHash?: string },
  ): Promise<number> {
    const conditions = [
      eq(auditLogs.eventType, args.eventType),
      gt(auditLogs.createdAt, args.since),
    ];
    if (args.subjectHash !== undefined) {
      conditions.push(eq(auditLogs.subjectHash, args.subjectHash));
    }
    if (args.ipHash !== undefined) {
      conditions.push(eq(auditLogs.ipHash, args.ipHash));
    }
    const [row] = await db
      .select({ value: count() })
      .from(auditLogs)
      .where(and(...conditions));
    return row?.value ?? 0;
  },
} as const;
