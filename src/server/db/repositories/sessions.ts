import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";

import type { Db } from "../client";
import { sessions } from "../schema";

export type SessionRow = typeof sessions.$inferSelect;

export interface CreateSessionInput {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ipHash?: string | null;
  userAgent?: string | null;
}

export const sessionsRepo = {
  async create(db: Db, input: CreateSessionInput): Promise<SessionRow> {
    const [row] = await db.insert(sessions).values(input).returning();
    return row;
  },

  /** Auth-time lookup: only unrevoked, unexpired sessions match. */
  async findValidByTokenHash(db: Db, tokenHash: string): Promise<SessionRow | null> {
    const [row] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async touchLastSeen(db: Db, sessionId: string): Promise<void> {
    await db
      .update(sessions)
      .set({ lastSeenAt: sql`now()` })
      .where(eq(sessions.id, sessionId));
  },

  /** Sliding expiry: refresh last-seen and push the expiry forward (idle timeout). */
  async extend(db: Db, sessionId: string, expiresAt: Date): Promise<void> {
    await db
      .update(sessions)
      .set({ lastSeenAt: sql`now()`, expiresAt })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  },

  /**
   * Revokes one session, scoped to its owner. A tampered sessionId belonging to
   * another user matches nothing and returns false.
   */
  async revokeById(db: Db, args: { userId: string; sessionId: string }): Promise<boolean> {
    const result = await db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(sessions.id, args.sessionId),
          eq(sessions.userId, args.userId),
          isNull(sessions.revokedAt),
        ),
      )
      .returning({ id: sessions.id });
    return result.length > 0;
  },

  async revokeAllForUser(
    db: Db,
    userId: string,
    opts: { exceptSessionId?: string } = {},
  ): Promise<number> {
    const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
    if (opts.exceptSessionId) {
      conditions.push(ne(sessions.id, opts.exceptSessionId));
    }
    const result = await db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(...conditions))
      .returning({ id: sessions.id });
    return result.length;
  },

  async listActiveForUser(db: Db, userId: string): Promise<SessionRow[]> {
    return db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt));
  },

  async deleteExpired(db: Db): Promise<number> {
    const result = await db
      .delete(sessions)
      .where(sql`${sessions.expiresAt} < now() - interval '30 days'`)
      .returning({ id: sessions.id });
    return result.length;
  },
} as const;
