import { and, asc, eq, ilike, sql } from "drizzle-orm";

import { uuidv7 } from "@/lib/ids";
import { canonicalMerchantName, normalizeMerchantKey } from "@/lib/merchants";
import { err, ok, type Result } from "@/lib/result";

import type { Db } from "../db/client";
import { categories, merchants } from "../db/schema";
import { pgErrorCode, UNIQUE_VIOLATION } from "./shared";

export type MerchantRow = typeof merchants.$inferSelect;

export const merchantsService = {
  /**
   * Resolves a raw statement/user descriptor to the user's merchant, creating
   * it on first sight and collecting raw variants as aliases. The original
   * description is never modified — it lives on the transaction.
   */
  async findOrCreate(db: Db, userId: string, rawName: string): Promise<MerchantRow | null> {
    const key = normalizeMerchantKey(rawName);
    if (key === "") return null;
    const raw = rawName.trim();

    const [existing] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.userId, userId), eq(merchants.normalizedKey, key)))
      .limit(1);
    if (existing) {
      const aliases = (existing.aliases as string[]) ?? [];
      if (!aliases.includes(raw)) {
        const [updated] = await db
          .update(merchants)
          .set({ aliases: [...aliases, raw].slice(-20), updatedAt: sql`now()` })
          .where(eq(merchants.id, existing.id))
          .returning();
        return updated;
      }
      return existing;
    }

    try {
      const [created] = await db
        .insert(merchants)
        .values({
          id: uuidv7(),
          userId,
          canonicalName: canonicalMerchantName(rawName) || raw,
          normalizedKey: key,
          aliases: [raw],
        })
        .returning();
      return created;
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        // Concurrent creation of the same merchant: re-read the winner.
        const [winner] = await db
          .select()
          .from(merchants)
          .where(and(eq(merchants.userId, userId), eq(merchants.normalizedKey, key)))
          .limit(1);
        return winner ?? null;
      }
      throw error;
    }
  },

  async list(db: Db, userId: string, search?: string): Promise<MerchantRow[]> {
    const conditions = [eq(merchants.userId, userId)];
    if (search?.trim()) {
      conditions.push(ilike(merchants.canonicalName, `%${search.trim()}%`));
    }
    return db
      .select()
      .from(merchants)
      .where(and(...conditions))
      .orderBy(asc(merchants.canonicalName));
  },

  async update(
    db: Db,
    userId: string,
    merchantId: string,
    patch: { canonicalName?: string; defaultCategoryId?: string | null },
  ): Promise<Result<MerchantRow>> {
    if (patch.defaultCategoryId) {
      // Fail closed: the default category must belong to the caller.
      const [category] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, patch.defaultCategoryId), eq(categories.userId, userId)))
        .limit(1);
      if (!category) return err("not_found", "That category doesn’t exist.");
    }
    const [row] = await db
      .update(merchants)
      .set({
        ...(patch.canonicalName !== undefined ? { canonicalName: patch.canonicalName.trim() } : {}),
        ...(patch.defaultCategoryId !== undefined
          ? { defaultCategoryId: patch.defaultCategoryId }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(and(eq(merchants.id, merchantId), eq(merchants.userId, userId)))
      .returning();
    if (!row) return err("not_found", "That merchant doesn’t exist.");
    return ok(row);
  },
} as const;
