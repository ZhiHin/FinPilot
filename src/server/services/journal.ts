import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { isValidIsoDate } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";
import type { Db } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import { journalEntries, journalLinks, scenarios, transactions } from "@/server/db/schema";

/**
 * Money Decision Journal (spec feature 5, Journeys 6-7): annotate periods and
 * decisions with context. Entries never alter the ledger. Entries marked
 * `exclude_from_baselines` deterministically remove their period from anomaly,
 * budget-suggestion, and forecast baselines (spec V2 — intelService consumes
 * `exclusionWindows`). Expected outcomes get a review prompt on `review_on`
 * ("did the saving happen?") whose verdict is recorded append-style in
 * `outcome_review`.
 */

export type JournalEntryRow = typeof journalEntries.$inferSelect;
export type JournalLinkRow = typeof journalLinks.$inferSelect;

const isoDate = z.string().refine(isValidIsoDate, "Invalid date.");

const entrySchema = z
  .object({
    kind: z.enum(["life_event", "decision", "note"]),
    title: z.string().trim().min(1, "Title is required.").max(120),
    body: z.string().trim().max(2000).optional(),
    startsOn: isoDate,
    endsOn: isoDate.nullable().optional(),
    excludeFromBaselines: z.boolean().default(false),
    expectedSavingMinor: z.number().int().nullable().optional(),
    reviewOn: isoDate.nullable().optional(),
    scenarioId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, {
    message: "End date must not be before the start date.",
    path: ["endsOn"],
  });

export type JournalEntryInput = z.input<typeof entrySchema>;

export interface ExclusionWindow {
  entryId: string;
  title: string;
  start: string;
  /** Inclusive; single-day entries use start. */
  end: string;
}

export interface JournalEntryView extends JournalEntryRow {
  links: JournalLinkRow[];
  reviewDue: boolean;
}

async function assertScenarioOwned(db: Db, userId: string, scenarioId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(
      and(eq(scenarios.id, scenarioId), eq(scenarios.userId, userId), isNull(scenarios.deletedAt)),
    )
    .limit(1);
  return Boolean(row);
}

export const journalService = {
  async list(db: Db, userId: string, today: string): Promise<JournalEntryView[]> {
    const rows = await db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.userId, userId), isNull(journalEntries.deletedAt)))
      .orderBy(desc(journalEntries.startsOn), desc(journalEntries.createdAt));
    const links = await db
      .select()
      .from(journalLinks)
      .where(eq(journalLinks.userId, userId))
      .orderBy(asc(journalLinks.createdAt));
    const byEntry = new Map<string, JournalLinkRow[]>();
    for (const link of links) {
      const list = byEntry.get(link.journalEntryId) ?? [];
      list.push(link);
      byEntry.set(link.journalEntryId, list);
    }
    return rows.map((row) => ({
      ...row,
      links: byEntry.get(row.id) ?? [],
      reviewDue: Boolean(row.reviewOn && row.reviewOn <= today && !row.outcomeReview),
    }));
  },

  async create(db: Db, userId: string, input: JournalEntryInput): Promise<Result<{ id: string }>> {
    const parsed = entrySchema.safeParse(input);
    if (!parsed.success) {
      return err("invalid_input", parsed.error.issues[0]?.message ?? "Invalid entry.");
    }
    const value = parsed.data;
    if (value.scenarioId && !(await assertScenarioOwned(db, userId, value.scenarioId))) {
      return err("not_found", "Scenario not found.");
    }
    const id = uuidv7();
    await db.insert(journalEntries).values({
      id,
      userId,
      kind: value.kind,
      title: value.title,
      body: value.body || null,
      startsOn: value.startsOn,
      endsOn: value.endsOn ?? null,
      excludeFromBaselines: value.excludeFromBaselines,
      expectedOutcome:
        value.expectedSavingMinor != null ? { saveMinorPerMonth: value.expectedSavingMinor } : null,
      reviewOn: value.reviewOn ?? null,
    });
    if (value.scenarioId) {
      await db.insert(journalLinks).values({
        id: uuidv7(),
        journalEntryId: id,
        userId,
        entityType: "scenario",
        entityId: value.scenarioId,
      });
    }
    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: "journal.entry_created",
      entityType: "journal_entry",
      entityId: id,
      diff: { kind: value.kind, excludeFromBaselines: value.excludeFromBaselines },
    });
    return ok({ id });
  },

  async update(
    db: Db,
    userId: string,
    entryId: string,
    input: JournalEntryInput,
  ): Promise<Result<{ id: string }>> {
    const parsed = entrySchema.safeParse(input);
    if (!parsed.success) {
      return err("invalid_input", parsed.error.issues[0]?.message ?? "Invalid entry.");
    }
    const value = parsed.data;
    const [existing] = await db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.id, entryId),
          eq(journalEntries.userId, userId),
          isNull(journalEntries.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return err("not_found", "Journal entry not found.");
    await db
      .update(journalEntries)
      .set({
        kind: value.kind,
        title: value.title,
        body: value.body || null,
        startsOn: value.startsOn,
        endsOn: value.endsOn ?? null,
        excludeFromBaselines: value.excludeFromBaselines,
        expectedOutcome:
          value.expectedSavingMinor != null
            ? { saveMinorPerMonth: value.expectedSavingMinor }
            : null,
        reviewOn: value.reviewOn ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(journalEntries.id, entryId), eq(journalEntries.userId, userId)));
    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: "journal.entry_updated",
      entityType: "journal_entry",
      entityId: entryId,
      diff: { excludeFromBaselines: value.excludeFromBaselines },
    });
    return ok({ id: entryId });
  },

  async softDelete(db: Db, userId: string, entryId: string): Promise<Result<null>> {
    const updated = await db
      .update(journalEntries)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(journalEntries.id, entryId),
          eq(journalEntries.userId, userId),
          isNull(journalEntries.deletedAt),
        ),
      )
      .returning({ id: journalEntries.id });
    if (updated.length === 0) return err("not_found", "Journal entry not found.");
    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: "journal.entry_deleted",
      entityType: "journal_entry",
      entityId: entryId,
    });
    return ok(null);
  },

  /** Link a transaction to an entry (annotation/context; ownership enforced). */
  async linkTransaction(
    db: Db,
    userId: string,
    entryId: string,
    transactionId: string,
  ): Promise<Result<null>> {
    const [entry] = await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.id, entryId),
          eq(journalEntries.userId, userId),
          isNull(journalEntries.deletedAt),
        ),
      )
      .limit(1);
    if (!entry) return err("not_found", "Journal entry not found.");
    const [txn] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1);
    if (!txn) return err("not_found", "Transaction not found.");
    try {
      await db.insert(journalLinks).values({
        id: uuidv7(),
        journalEntryId: entryId,
        userId,
        entityType: "transaction",
        entityId: transactionId,
      });
    } catch {
      // Already linked — the unique index held; linking is idempotent.
    }
    return ok(null);
  },

  /** Record the outcome review ("did the expected saving happen?"). */
  async recordOutcome(
    db: Db,
    userId: string,
    entryId: string,
    input: { verdict: "happened" | "partly" | "no"; note?: string },
  ): Promise<Result<null>> {
    const verdicts = new Set(["happened", "partly", "no"]);
    if (!verdicts.has(input.verdict)) return err("invalid_input", "Invalid verdict.");
    const note = (input.note ?? "").trim().slice(0, 500);
    const updated = await db
      .update(journalEntries)
      .set({
        outcomeReview: {
          verdict: input.verdict,
          note: note || null,
          reviewedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(journalEntries.id, entryId),
          eq(journalEntries.userId, userId),
          isNull(journalEntries.deletedAt),
        ),
      )
      .returning({ id: journalEntries.id });
    if (updated.length === 0) return err("not_found", "Journal entry not found.");
    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: "journal.outcome_reviewed",
      entityType: "journal_entry",
      entityId: entryId,
      diff: { verdict: input.verdict },
    });
    return ok(null);
  },

  /**
   * Live excluding periods for the intelligence baselines (spec V2). Single-
   * day entries exclude just their start date; open-ended entries never occur
   * (ends_on defaults to starts_on here, by construction).
   */
  async exclusionWindows(db: Db, userId: string): Promise<ExclusionWindow[]> {
    const rows = await db
      .select({
        id: journalEntries.id,
        title: journalEntries.title,
        startsOn: journalEntries.startsOn,
        endsOn: journalEntries.endsOn,
      })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.userId, userId),
          eq(journalEntries.excludeFromBaselines, true),
          isNull(journalEntries.deletedAt),
        ),
      )
      .orderBy(asc(journalEntries.startsOn));
    return rows.map((row) => ({
      entryId: row.id,
      title: row.title,
      start: row.startsOn,
      end: row.endsOn ?? row.startsOn,
    }));
  },
};
