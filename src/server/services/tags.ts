import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { uuidv7 } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";

import type { Db } from "../db/client";
import { tags } from "../db/schema";
import { pgErrorCode, UNIQUE_VIOLATION } from "./shared";

export type TagRow = typeof tags.$inferSelect;

export const tagsService = {
  async create(
    db: Db,
    userId: string,
    input: { name: string; color?: string | null },
  ): Promise<Result<TagRow>> {
    try {
      const [row] = await db
        .insert(tags)
        .values({ id: uuidv7(), userId, name: input.name.trim(), color: input.color ?? null })
        .returning();
      return ok(row);
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        return err("conflict", "Please check the form.", {
          name: ["You already have a tag with this name."],
        });
      }
      throw error;
    }
  },

  async list(db: Db, userId: string): Promise<TagRow[]> {
    return db
      .select()
      .from(tags)
      .where(and(eq(tags.userId, userId), isNull(tags.deletedAt)))
      .orderBy(asc(tags.name));
  },

  async update(
    db: Db,
    userId: string,
    tagId: string,
    patch: { name?: string; color?: string | null },
  ): Promise<Result<TagRow>> {
    try {
      const [row] = await db
        .update(tags)
        .set({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          updatedAt: sql`now()`,
        })
        .where(and(eq(tags.id, tagId), eq(tags.userId, userId), isNull(tags.deletedAt)))
        .returning();
      if (!row) return err("not_found", "That tag doesn’t exist.");
      return ok(row);
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        return err("conflict", "Please check the form.", {
          name: ["You already have a tag with this name."],
        });
      }
      throw error;
    }
  },

  async softDelete(db: Db, userId: string, tagId: string): Promise<Result<{ deleted: true }>> {
    const [row] = await db
      .update(tags)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(tags.id, tagId), eq(tags.userId, userId), isNull(tags.deletedAt)))
      .returning();
    if (!row) return err("not_found", "That tag doesn’t exist.");
    return ok({ deleted: true as const });
  },
} as const;
