import { and, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "../client";
import { users } from "../schema";

export type UserRow = typeof users.$inferSelect;

export interface CreateUserInput {
  id: string;
  email: string;
  passwordHash: string;
}

export const usersRepo = {
  async create(db: Db, input: CreateUserInput): Promise<UserRow> {
    const [row] = await db.insert(users).values(input).returning();
    return row;
  },

  /** Auth-time lookup; citext makes the match case-insensitive. */
  async findByEmail(db: Db, email: string): Promise<UserRow | null> {
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  },

  async findById(db: Db, userId: string): Promise<UserRow | null> {
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  },

  async updateDisplayName(db: Db, userId: string, displayName: string | null): Promise<boolean> {
    const result = await db
      .update(users)
      .set({ displayName, updatedAt: sql`now()` })
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .returning({ id: users.id });
    return result.length > 0;
  },

  async updatePasswordHash(db: Db, userId: string, passwordHash: string): Promise<boolean> {
    const result = await db
      .update(users)
      .set({ passwordHash, updatedAt: sql`now()` })
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .returning({ id: users.id });
    return result.length > 0;
  },

  /** Staged deletion state machine (Phase 10): active <-> pending_purge. */
  async setStatus(
    db: Db,
    userId: string,
    input: { status: "active" | "deactivated" | "pending_purge"; purgeAfter: Date | null },
  ): Promise<boolean> {
    const result = await db
      .update(users)
      .set({ status: input.status, purgeAfter: input.purgeAfter, updatedAt: sql`now()` })
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .returning({ id: users.id });
    return result.length > 0;
  },

  /** Users whose recovery window has ended and are due for the purge job. */
  async listDueForPurge(db: Db, now: Date): Promise<UserRow[]> {
    return db
      .select()
      .from(users)
      .where(
        and(
          eq(users.status, "pending_purge"),
          isNull(users.deletedAt),
          sql`${users.purgeAfter} <= ${now}`,
        ),
      );
  },
} as const;
