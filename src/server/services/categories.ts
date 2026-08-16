import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { uuidv7 } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";

import type { Db } from "../db/client";
import { categories, categoryGroups } from "../db/schema";
import { pgErrorCode, UNIQUE_VIOLATION } from "./shared";

export type CategoryRow = typeof categories.$inferSelect;
export type CategoryGroupRow = typeof categoryGroups.$inferSelect;

export interface GroupWithCategories extends CategoryGroupRow {
  categories: CategoryRow[];
}

/**
 * Default Malaysian category template (spec §7 flavor). Seeded per user so
 * everything is user-editable; marked is_system for later phases.
 */
const DEFAULT_TEMPLATE: Array<{ name: string; kind: "income" | "expense"; categories: string[] }> =
  [
    {
      name: "Income",
      kind: "income",
      categories: ["Salary", "Freelance & side income", "Interest & dividends", "Other income"],
    },
    {
      name: "Housing",
      kind: "expense",
      categories: ["Rent", "Utilities", "Internet & phone", "Home & furniture"],
    },
    {
      name: "Food & drink",
      kind: "expense",
      categories: ["Groceries", "Eating out", "Food delivery", "Coffee & snacks"],
    },
    {
      name: "Transport",
      kind: "expense",
      categories: [
        "Petrol",
        "E-hailing",
        "Public transport",
        "Parking & tolls",
        "Vehicle maintenance",
      ],
    },
    {
      name: "Shopping",
      kind: "expense",
      categories: ["Clothing & shoes", "Electronics", "Online shopping", "Gifts"],
    },
    {
      name: "Health & fitness",
      kind: "expense",
      categories: ["Pharmacy", "Doctor & dental", "Insurance", "Fitness"],
    },
    {
      name: "Entertainment",
      kind: "expense",
      categories: ["Streaming & subscriptions", "Movies & events", "Hobbies", "Travel"],
    },
    {
      name: "Family & education",
      kind: "expense",
      categories: ["Education", "Childcare & family", "Pets"],
    },
    {
      name: "Money & fees",
      kind: "expense",
      categories: ["Bank fees & charges", "Loan payment", "Credit card payment", "Taxes & zakat"],
    },
    { name: "Other", kind: "expense", categories: ["Cash withdrawal", "Miscellaneous"] },
  ];

export const categoriesService = {
  /** Idempotent per-user seeding of the default template. */
  async ensureDefaults(db: Db, userId: string): Promise<{ created: boolean }> {
    const existing = await db
      .select({ id: categoryGroups.id })
      .from(categoryGroups)
      .where(eq(categoryGroups.userId, userId))
      .limit(1);
    if (existing.length > 0) return { created: false };

    await db.transaction(async (tx) => {
      for (const [index, group] of DEFAULT_TEMPLATE.entries()) {
        const groupId = uuidv7();
        await tx.insert(categoryGroups).values({
          id: groupId,
          userId,
          name: group.name,
          kind: group.kind,
          sortOrder: index,
        });
        await tx.insert(categories).values(
          group.categories.map((name) => ({
            id: uuidv7(),
            userId,
            groupId,
            name,
            isSystem: true,
          })),
        );
      }
    });
    return { created: true };
  },

  async listGroups(
    db: Db,
    userId: string,
    opts: { includeArchived?: boolean } = {},
  ): Promise<GroupWithCategories[]> {
    const groupConditions = [eq(categoryGroups.userId, userId)];
    if (!opts.includeArchived) groupConditions.push(isNull(categoryGroups.archivedAt));
    const groups = await db
      .select()
      .from(categoryGroups)
      .where(and(...groupConditions))
      .orderBy(asc(categoryGroups.sortOrder), asc(categoryGroups.name));

    const catConditions = [eq(categories.userId, userId)];
    if (!opts.includeArchived) catConditions.push(isNull(categories.archivedAt));
    const cats = await db
      .select()
      .from(categories)
      .where(and(...catConditions))
      .orderBy(asc(categories.name));

    const byGroup = new Map<string, CategoryRow[]>();
    for (const cat of cats) {
      const bucket = byGroup.get(cat.groupId) ?? [];
      bucket.push(cat);
      byGroup.set(cat.groupId, bucket);
    }
    return groups.map((g) => ({ ...g, categories: byGroup.get(g.id) ?? [] }));
  },

  async createGroup(
    db: Db,
    userId: string,
    input: { name: string; kind: "income" | "expense" },
  ): Promise<Result<CategoryGroupRow>> {
    try {
      const [row] = await db
        .insert(categoryGroups)
        .values({ id: uuidv7(), userId, name: input.name.trim(), kind: input.kind, sortOrder: 99 })
        .returning();
      return ok(row);
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        return err("conflict", "Please check the form.", {
          name: ["A group with this name already exists."],
        });
      }
      throw error;
    }
  },

  async createCategory(
    db: Db,
    userId: string,
    input: { groupId: string; name: string; icon?: string | null; color?: string | null },
  ): Promise<Result<CategoryRow>> {
    // Fail closed: the target group must belong to the caller.
    const [group] = await db
      .select({ id: categoryGroups.id })
      .from(categoryGroups)
      .where(and(eq(categoryGroups.id, input.groupId), eq(categoryGroups.userId, userId)))
      .limit(1);
    if (!group) return err("not_found", "That category group doesn’t exist.");

    try {
      const [row] = await db
        .insert(categories)
        .values({
          id: uuidv7(),
          userId,
          groupId: input.groupId,
          name: input.name.trim(),
          icon: input.icon ?? null,
          color: input.color ?? null,
        })
        .returning();
      return ok(row);
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        return err("conflict", "Please check the form.", {
          name: ["This group already has a category with this name."],
        });
      }
      throw error;
    }
  },

  async updateCategory(
    db: Db,
    userId: string,
    categoryId: string,
    patch: { name?: string; icon?: string | null; color?: string | null },
  ): Promise<Result<CategoryRow>> {
    try {
      const [row] = await db
        .update(categories)
        .set({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          updatedAt: sql`now()`,
        })
        .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
        .returning();
      if (!row) return err("not_found", "That category doesn’t exist.");
      return ok(row);
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        return err("conflict", "Please check the form.", {
          name: ["This group already has a category with this name."],
        });
      }
      throw error;
    }
  },

  async setCategoryArchived(
    db: Db,
    userId: string,
    categoryId: string,
    archived: boolean,
  ): Promise<Result<CategoryRow>> {
    const [row] = await db
      .update(categories)
      .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .returning();
    if (!row) return err("not_found", "That category doesn’t exist.");
    return ok(row);
  },

  /** Archiving a group archives its categories too — history stays intact (invariant 6). */
  async archiveGroup(db: Db, userId: string, groupId: string): Promise<Result<{ archived: true }>> {
    return db.transaction(async (tx) => {
      const [group] = await tx
        .update(categoryGroups)
        .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(categoryGroups.id, groupId),
            eq(categoryGroups.userId, userId),
            isNull(categoryGroups.archivedAt),
          ),
        )
        .returning();
      if (!group) return err("not_found", "That category group doesn’t exist.");
      await tx
        .update(categories)
        .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(categories.groupId, groupId),
            eq(categories.userId, userId),
            isNull(categories.archivedAt),
          ),
        );
      return ok({ archived: true as const });
    });
  },
} as const;
