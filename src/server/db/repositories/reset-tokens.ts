import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { Db } from "../client";
import { passwordResetTokens } from "../schema";

export type ResetTokenRow = typeof passwordResetTokens.$inferSelect;

export const resetTokensRepo = {
  async create(
    db: Db,
    input: { id: string; userId: string; tokenHash: string; expiresAt: Date },
  ): Promise<ResetTokenRow> {
    const [row] = await db.insert(passwordResetTokens).values(input).returning();
    return row;
  },

  /** Only unused, unexpired tokens match. */
  async findValidByTokenHash(db: Db, tokenHash: string): Promise<ResetTokenRow | null> {
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, sql`now()`),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  /** Single-use: marking consumed only succeeds once. */
  async consume(db: Db, tokenId: string): Promise<boolean> {
    const result = await db
      .update(passwordResetTokens)
      .set({ usedAt: sql`now()` })
      .where(and(eq(passwordResetTokens.id, tokenId), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    return result.length > 0;
  },

  /** Invalidate all outstanding tokens (on successful reset or password change). */
  async invalidateAllForUser(db: Db, userId: string): Promise<void> {
    await db
      .update(passwordResetTokens)
      .set({ usedAt: sql`now()` })
      .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
  },
} as const;
