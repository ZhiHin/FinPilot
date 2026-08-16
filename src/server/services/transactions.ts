import { and, eq, getTableColumns, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { decodeCursor, encodeCursor } from "@/lib/cursor";
import { uuidv7 } from "@/lib/ids";
import { assertSafeMinor } from "@/lib/money";
import { err, ok, type Result } from "@/lib/result";

import type { Db } from "../db/client";
import { auditRepo } from "../db/repositories/audit";
import {
  accounts,
  categories,
  merchants,
  tags,
  transactionLinks,
  transactionSplits,
  transactionTags,
  transactions,
} from "../db/schema";
import { merchantsService } from "./merchants";
import { pgErrorCode, UNIQUE_VIOLATION } from "./shared";

export type TransactionRow = typeof transactions.$inferSelect;
export type TransactionType = TransactionRow["type"];
export type SplitRow = typeof transactionSplits.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * DOCUMENTED REPORTING RULES (invariants 1, 4, 5):
 * - Income/expense summaries include only POSTED, non-excluded, non-deleted rows.
 * - income = Σ amount where type = 'income'.
 * - expense = Σ(−amount) where type = 'expense' MINUS Σ amount where type = 'refund'
 *   (a refund reduces spending; it is never income — invariant 4).
 * - transfer / adjustment / debt_payment rows never enter income or expense (invariant 1).
 * - Account BALANCES include all posted non-deleted rows (excluded ones too — the money
 *   moved); pending rows are reported separately and deleted rows nowhere.
 * - Every aggregate is grouped by currency; no cross-currency total exists (invariant 8).
 */

export interface SplitInput {
  categoryId: string;
  amountMinor: number;
  note?: string | null;
  isReimbursable?: boolean;
}

export interface CreateTransactionInput {
  accountId: string;
  type: Exclude<TransactionType, "transfer">;
  /** Signed minor units (negative = outflow). Sign must match the type. */
  amountMinor: number;
  txnDate: string;
  description?: string;
  merchantName?: string;
  categoryId?: string | null;
  tagIds?: string[];
  status?: "pending" | "posted";
  isExcluded?: boolean;
  needsReview?: boolean;
  notes?: string | null;
  isReimbursable?: boolean;
  splits?: SplitInput[];
}

export interface TransactionDetail {
  transaction: TransactionRow;
  splits: SplitRow[];
  tags: Array<{ id: string; name: string; color: string | null }>;
  merchant: { id: string; canonicalName: string } | null;
  accountName: string;
  links: Array<{
    id: string;
    linkType: "transfer_pair" | "refund_of" | "duplicate_of" | "installment_of";
    direction: "from" | "to";
    otherTransactionId: string;
    otherDescription: string;
    otherAmountMinor: number;
    otherDeleted: boolean;
  }>;
}

export interface ListQuery {
  accountIds?: string[];
  categoryIds?: string[];
  tagIds?: string[];
  types?: TransactionType[];
  statuses?: Array<"pending" | "posted">;
  review?: "needs_review" | "reviewed";
  excluded?: boolean;
  deleted?: boolean;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
  cursor?: string;
  limit?: number;
}

export interface TransactionListItem {
  id: string;
  userId: string;
  accountId: string;
  accountName: string;
  type: TransactionType;
  status: "pending" | "posted";
  isExcluded: boolean;
  needsReview: boolean;
  amountMinor: number;
  currency: string;
  txnDate: string;
  descriptionOriginal: string;
  merchantName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  version: number;
  deletedAt: Date | null;
  hasSplits: boolean;
  isTransferLeg: boolean;
  tagNames: string[];
}

const cursorSchema = z.object({ k: z.string(), id: z.string().uuid() });

const SIGN_RULES: Record<string, (amount: number) => boolean> = {
  expense: (a) => a < 0,
  income: (a) => a > 0,
  refund: (a) => a > 0,
  debt_payment: (a) => a !== 0,
  adjustment: () => true,
};

function invalid(message: string, fieldErrors?: Record<string, string[]>) {
  return err("invalid_input", message, fieldErrors);
}

function mapDbInvariantError(error: unknown): Result<never> | null {
  const message =
    error instanceof Error
      ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`
      : "";
  if (/splits/i.test(message)) {
    return invalid("Split amounts must add up exactly to the transaction amount.");
  }
  if (/currency/i.test(message)) {
    return invalid("This transaction’s currency must match its account.");
  }
  return null;
}

/** Fail closed: every referenced id must belong to the caller or the whole op is rejected. */
async function assertOwned(
  db: Db | Tx,
  table: "accounts" | "categories" | "tags" | "transactions",
  userId: string,
  ids: string[],
): Promise<boolean> {
  if (ids.length === 0) return true;
  const unique = [...new Set(ids)];
  const tableRef = { accounts, categories, tags, transactions }[table];
  const rows = await (db as Db)
    .select({ id: tableRef.id })
    .from(tableRef)
    .where(and(eq(tableRef.userId, userId), inArray(tableRef.id, unique)));
  return rows.length === unique.length;
}

async function replaceTags(tx: Tx, userId: string, transactionId: string, tagIds: string[]) {
  await tx.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId));
  if (tagIds.length > 0) {
    await tx
      .insert(transactionTags)
      .values(tagIds.map((tagId) => ({ transactionId, tagId, userId })));
  }
}

async function replaceSplits(tx: Tx, userId: string, transactionId: string, splits: SplitInput[]) {
  await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, transactionId));
  if (splits.length > 0) {
    await tx.insert(transactionSplits).values(
      splits.map((split) => ({
        id: uuidv7(),
        transactionId,
        userId,
        categoryId: split.categoryId,
        amountMinor: split.amountMinor,
        note: split.note ?? null,
        isReimbursable: split.isReimbursable ?? false,
      })),
    );
  }
}

async function findTransferCounterpartId(
  db: Db | Tx,
  userId: string,
  transactionId: string,
): Promise<string | null> {
  const [link] = await (db as Db)
    .select()
    .from(transactionLinks)
    .where(
      and(
        eq(transactionLinks.userId, userId),
        eq(transactionLinks.linkType, "transfer_pair"),
        or(
          eq(transactionLinks.fromTransactionId, transactionId),
          eq(transactionLinks.toTransactionId, transactionId),
        ),
      ),
    )
    .limit(1);
  if (!link) return null;
  return link.fromTransactionId === transactionId ? link.toTransactionId : link.fromTransactionId;
}

const IMPORTANT_FIELDS = [
  "amountMinor",
  "txnDate",
  "accountId",
  "categoryId",
  "status",
  "isExcluded",
] as const;

export const transactionsService = {
  async create(
    db: Db,
    userId: string,
    input: CreateTransactionInput,
  ): Promise<Result<TransactionDetail>> {
    assertSafeMinor(input.amountMinor);
    if ((input.type as string) === "transfer") {
      return invalid("Transfers are created between two accounts, not as single entries.");
    }
    const signOk = SIGN_RULES[input.type];
    if (!signOk || !signOk(input.amountMinor)) {
      return invalid("Please check the form.", {
        amount: ["The amount’s sign doesn’t match this transaction type."],
      });
    }
    for (const split of input.splits ?? []) {
      assertSafeMinor(split.amountMinor);
    }
    if ((input.splits?.length ?? 0) > 20) {
      return invalid("A transaction can have at most 20 splits.");
    }

    const [account] = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, input.accountId),
          eq(accounts.userId, userId),
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1);
    if (!account) return err("not_found", "That account doesn’t exist.");

    const categoryIds = [
      ...(input.categoryId ? [input.categoryId] : []),
      ...(input.splits?.map((s) => s.categoryId) ?? []),
    ];
    if (!(await assertOwned(db, "categories", userId, categoryIds))) {
      return err("not_found", "That category doesn’t exist.");
    }
    if (!(await assertOwned(db, "tags", userId, input.tagIds ?? []))) {
      return err("not_found", "That tag doesn’t exist.");
    }

    let merchantId: string | null = null;
    let categoryId = input.categoryId ?? null;
    let categorizationSource: TransactionRow["categorizationSource"] = "user";
    if (input.merchantName?.trim()) {
      const merchant = await merchantsService.findOrCreate(db, userId, input.merchantName);
      merchantId = merchant?.id ?? null;
      if (!categoryId && merchant?.defaultCategoryId) {
        categoryId = merchant.defaultCategoryId;
        categorizationSource = "default";
      }
    }
    if (!categoryId) categorizationSource = "user";

    const id = uuidv7();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(transactions).values({
          id,
          userId,
          accountId: input.accountId,
          type: input.type,
          status: input.status ?? "posted",
          isExcluded: input.isExcluded ?? false,
          needsReview: input.needsReview ?? false,
          amountMinor: input.amountMinor,
          currency: account.currency,
          txnDate: input.txnDate,
          postedAt: (input.status ?? "posted") === "posted" ? sql`now()` : null,
          descriptionOriginal: input.description?.trim() ?? "",
          merchantId,
          categoryId,
          categorizationSource,
          notes: input.notes ?? null,
          isReimbursable: input.isReimbursable ?? false,
        });
        if (input.splits?.length) {
          await replaceSplits(tx, userId, id, input.splits);
        }
        if (input.tagIds?.length) {
          await replaceTags(tx, userId, id, input.tagIds);
        }
        await auditRepo.record(tx as unknown as Db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: "transaction.created",
          entityType: "transaction",
          entityId: id,
          diff: { type: input.type, amountMinor: input.amountMinor, accountId: input.accountId },
        });
      });
    } catch (error) {
      const mapped = mapDbInvariantError(error);
      if (mapped) return mapped;
      throw error;
    }
    const detail = await this.getDetail(db, userId, id);
    return detail ? ok(detail) : err("internal", "Something went wrong. Please try again.");
  },

  async getDetail(
    db: Db,
    userId: string,
    transactionId: string,
  ): Promise<TransactionDetail | null> {
    const [row] = await db
      .select({
        transaction: getTableColumns(transactions),
        accountName: accounts.name,
        merchantId: merchants.id,
        merchantName: merchants.canonicalName,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
      .limit(1);
    if (!row) return null;

    const splits = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, transactionId));

    const tagRows = await db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(transactionTags)
      .innerJoin(tags, eq(tags.id, transactionTags.tagId))
      .where(eq(transactionTags.transactionId, transactionId));

    const other = sql<string>`case when ${transactionLinks.fromTransactionId} = ${transactionId} then ${transactionLinks.toTransactionId} else ${transactionLinks.fromTransactionId} end`;
    const linkRows = await db
      .select({
        id: transactionLinks.id,
        linkType: transactionLinks.linkType,
        fromTransactionId: transactionLinks.fromTransactionId,
        otherTransactionId: sql<string>`${other}`,
        otherDescription: sql<string>`(select description_original from transactions where id = ${other})`,
        otherAmountMinor:
          sql<number>`(select amount_minor from transactions where id = ${other})::bigint`.mapWith(
            Number,
          ),
        otherDeleted: sql<boolean>`(select deleted_at is not null from transactions where id = ${other})`,
      })
      .from(transactionLinks)
      .where(
        and(
          eq(transactionLinks.userId, userId),
          or(
            eq(transactionLinks.fromTransactionId, transactionId),
            eq(transactionLinks.toTransactionId, transactionId),
          ),
        ),
      );

    return {
      transaction: row.transaction,
      splits,
      tags: tagRows,
      merchant: row.merchantId ? { id: row.merchantId, canonicalName: row.merchantName! } : null,
      accountName: row.accountName,
      links: linkRows.map((l) => ({
        id: l.id,
        linkType: l.linkType,
        direction: l.fromTransactionId === transactionId ? "from" : "to",
        otherTransactionId: l.otherTransactionId,
        otherDescription: l.otherDescription,
        otherAmountMinor: l.otherAmountMinor,
        otherDeleted: l.otherDeleted,
      })),
    };
  },

  async update(
    db: Db,
    userId: string,
    transactionId: string,
    patch: Partial<{
      accountId: string;
      amountMinor: number;
      txnDate: string;
      description: string;
      merchantName: string | null;
      categoryId: string | null;
      tagIds: string[];
      status: "pending" | "posted";
      isExcluded: boolean;
      needsReview: boolean;
      notes: string | null;
      isReimbursable: boolean;
      splits: SplitInput[] | null;
    }>,
    expectedVersion: number,
  ): Promise<Result<TransactionDetail>> {
    const existing = await this.getDetail(db, userId, transactionId);
    if (!existing || existing.transaction.deletedAt) {
      return err("not_found", "That transaction doesn’t exist.");
    }
    const current = existing.transaction;
    if (current.version !== expectedVersion) {
      return err("conflict", "This transaction changed in another tab. Refresh and try again.");
    }

    const isTransferLeg = current.type === "transfer";
    if (isTransferLeg) {
      const forbidden = [
        "accountId",
        "amountMinor",
        "txnDate",
        "categoryId",
        "splits",
        "description",
        "merchantName",
        "status",
      ] as const;
      for (const key of forbidden) {
        if (patch[key] !== undefined) {
          return invalid(
            "Transfer legs can’t be edited this way — delete the transfer and create it again.",
          );
        }
      }
    }

    if (patch.amountMinor !== undefined) {
      assertSafeMinor(patch.amountMinor);
      if (!SIGN_RULES[current.type]?.(patch.amountMinor)) {
        return invalid("Please check the form.", {
          amount: ["The amount’s sign doesn’t match this transaction type."],
        });
      }
    }

    let nextAccount: typeof accounts.$inferSelect | null = null;
    if (patch.accountId !== undefined && patch.accountId !== current.accountId) {
      const [account] = await db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.id, patch.accountId),
            eq(accounts.userId, userId),
            isNull(accounts.deletedAt),
          ),
        )
        .limit(1);
      if (!account) return err("not_found", "That account doesn’t exist.");
      if (account.currency !== current.currency) {
        return invalid("Moving a transaction between currencies isn’t supported.");
      }
      nextAccount = account;
    }

    const categoryIds = [
      ...(patch.categoryId ? [patch.categoryId] : []),
      ...(patch.splits?.map((s) => s.categoryId) ?? []),
    ];
    if (!(await assertOwned(db, "categories", userId, categoryIds))) {
      return err("not_found", "That category doesn’t exist.");
    }
    if (!(await assertOwned(db, "tags", userId, patch.tagIds ?? []))) {
      return err("not_found", "That tag doesn’t exist.");
    }
    for (const split of patch.splits ?? []) assertSafeMinor(split.amountMinor);

    let merchantId = current.merchantId;
    if (patch.merchantName !== undefined) {
      merchantId = patch.merchantName?.trim()
        ? ((await merchantsService.findOrCreate(db, userId, patch.merchantName))?.id ?? null)
        : null;
    }

    try {
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(transactions)
          .set({
            ...(patch.accountId !== undefined ? { accountId: patch.accountId } : {}),
            ...(nextAccount ? { currency: nextAccount.currency } : {}),
            ...(patch.amountMinor !== undefined ? { amountMinor: patch.amountMinor } : {}),
            ...(patch.txnDate !== undefined ? { txnDate: patch.txnDate } : {}),
            ...(patch.description !== undefined
              ? { descriptionOriginal: patch.description.trim() }
              : {}),
            ...(patch.merchantName !== undefined ? { merchantId } : {}),
            ...(patch.categoryId !== undefined
              ? { categoryId: patch.categoryId, categorizationSource: "user" as const }
              : {}),
            ...(patch.status !== undefined
              ? {
                  status: patch.status,
                  postedAt: patch.status === "posted" ? sql`now()` : null,
                }
              : {}),
            ...(patch.isExcluded !== undefined ? { isExcluded: patch.isExcluded } : {}),
            ...(patch.needsReview !== undefined ? { needsReview: patch.needsReview } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
            ...(patch.isReimbursable !== undefined ? { isReimbursable: patch.isReimbursable } : {}),
            version: sql`${transactions.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(transactions.id, transactionId),
              eq(transactions.userId, userId),
              eq(transactions.version, expectedVersion),
            ),
          )
          .returning({ id: transactions.id });
        if (!updated) {
          throw Object.assign(new Error("version-conflict"), { versionConflict: true });
        }

        if (patch.splits !== undefined) {
          await replaceSplits(tx, userId, transactionId, patch.splits ?? []);
        }
        if (patch.tagIds !== undefined) {
          await replaceTags(tx, userId, transactionId, patch.tagIds);
        }

        const diff: Record<string, { from: unknown; to: unknown }> = {};
        for (const field of IMPORTANT_FIELDS) {
          const next = (patch as Record<string, unknown>)[field];
          if (next !== undefined && next !== (current as Record<string, unknown>)[field]) {
            diff[field] = { from: (current as Record<string, unknown>)[field], to: next };
          }
        }
        await auditRepo.record(tx as unknown as Db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: "transaction.updated",
          entityType: "transaction",
          entityId: transactionId,
          diff,
        });
      });
    } catch (error) {
      if ((error as { versionConflict?: boolean }).versionConflict) {
        return err("conflict", "This transaction changed in another tab. Refresh and try again.");
      }
      const mapped = mapDbInvariantError(error);
      if (mapped) return mapped;
      throw error;
    }
    const detail = await this.getDetail(db, userId, transactionId);
    return detail ? ok(detail) : err("internal", "Something went wrong. Please try again.");
  },

  /** Soft delete; a transfer leg always takes its counterpart with it (invariant 2). */
  async softDelete(
    db: Db,
    userId: string,
    transactionId: string,
  ): Promise<Result<{ deletedIds: string[] }>> {
    const detail = await this.getDetail(db, userId, transactionId);
    if (!detail || detail.transaction.deletedAt) {
      return err("not_found", "That transaction doesn’t exist.");
    }
    const counterpart = await findTransferCounterpartId(db, userId, transactionId);
    const ids = counterpart ? [transactionId, counterpart] : [transactionId];
    await db.transaction(async (tx) => {
      await tx
        .update(transactions)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(inArray(transactions.id, ids), eq(transactions.userId, userId)));
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "transaction.deleted",
        entityType: "transaction",
        entityId: transactionId,
        diff: { deletedIds: ids },
      });
    });
    return ok({ deletedIds: ids });
  },

  async restore(
    db: Db,
    userId: string,
    transactionId: string,
  ): Promise<Result<{ restoredIds: string[] }>> {
    const detail = await this.getDetail(db, userId, transactionId);
    if (!detail || !detail.transaction.deletedAt) {
      return err("not_found", "That transaction isn’t deleted.");
    }
    const counterpart = await findTransferCounterpartId(db, userId, transactionId);
    const ids = counterpart ? [transactionId, counterpart] : [transactionId];
    await db.transaction(async (tx) => {
      await tx
        .update(transactions)
        .set({ deletedAt: null, updatedAt: sql`now()` })
        .where(and(inArray(transactions.id, ids), eq(transactions.userId, userId)));
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "transaction.restored",
        entityType: "transaction",
        entityId: transactionId,
        diff: { restoredIds: ids },
      });
    });
    return ok({ restoredIds: ids });
  },

  /** Linked double entry: two legs + link created atomically (invariants 1, 2, 9). */
  async createTransfer(
    db: Db,
    userId: string,
    input: {
      fromAccountId: string;
      toAccountId: string;
      /** Positive magnitude. */
      amountMinor: number;
      txnDate: string;
      notes?: string | null;
    },
  ): Promise<Result<{ fromTransactionId: string; toTransactionId: string; linkId: string }>> {
    assertSafeMinor(input.amountMinor);
    if (input.amountMinor <= 0) {
      return invalid("Please check the form.", { amount: ["Enter an amount above zero."] });
    }
    if (input.fromAccountId === input.toAccountId) {
      return invalid("Pick two different accounts for a transfer.");
    }
    const rows = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          inArray(accounts.id, [input.fromAccountId, input.toAccountId]),
          isNull(accounts.deletedAt),
        ),
      );
    if (rows.length !== 2) return err("not_found", "That account doesn’t exist.");
    const from = rows.find((r) => r.id === input.fromAccountId)!;
    const to = rows.find((r) => r.id === input.toAccountId)!;
    if (from.currency !== to.currency) {
      return invalid(
        "Transfers between different currencies aren’t supported — currencies are never converted silently.",
      );
    }

    const fromTransactionId = uuidv7();
    const toTransactionId = uuidv7();
    const linkId = uuidv7();
    await db.transaction(async (tx) => {
      await tx.insert(transactions).values([
        {
          id: fromTransactionId,
          userId,
          accountId: from.id,
          type: "transfer" as const,
          amountMinor: -input.amountMinor,
          currency: from.currency,
          txnDate: input.txnDate,
          postedAt: sql`now()`,
          descriptionOriginal: `Transfer to ${to.name}`,
          notes: input.notes ?? null,
        },
        {
          id: toTransactionId,
          userId,
          accountId: to.id,
          type: "transfer" as const,
          amountMinor: input.amountMinor,
          currency: to.currency,
          txnDate: input.txnDate,
          postedAt: sql`now()`,
          descriptionOriginal: `Transfer from ${from.name}`,
          notes: input.notes ?? null,
        },
      ]);
      await tx.insert(transactionLinks).values({
        id: linkId,
        userId,
        linkType: "transfer_pair",
        fromTransactionId,
        toTransactionId,
      });
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "transfer.created",
        entityType: "transaction",
        entityId: fromTransactionId,
        diff: { amountMinor: input.amountMinor, from: from.id, to: to.id },
      });
    });
    return ok({ fromTransactionId, toTransactionId, linkId });
  },

  async linkRefund(
    db: Db,
    userId: string,
    input: { refundTransactionId: string; purchaseTransactionId: string },
  ): Promise<Result<{ linkId: string }>> {
    const refund = await this.getDetail(db, userId, input.refundTransactionId);
    const purchase = await this.getDetail(db, userId, input.purchaseTransactionId);
    if (!refund || !purchase) return err("not_found", "That transaction doesn’t exist.");
    if (refund.transaction.type !== "refund") {
      return invalid("Only refund transactions can be linked to a purchase.");
    }
    if (purchase.transaction.type !== "expense") {
      return invalid("Refunds link to expense transactions.");
    }
    const linkId = uuidv7();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(transactionLinks).values({
          id: linkId,
          userId,
          linkType: "refund_of",
          fromTransactionId: input.refundTransactionId,
          toTransactionId: input.purchaseTransactionId,
        });
        await auditRepo.record(tx as unknown as Db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: "transaction.refund_linked",
          entityType: "transaction",
          entityId: input.refundTransactionId,
          diff: { purchaseTransactionId: input.purchaseTransactionId },
        });
      });
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        return err("conflict", "These transactions are already linked.");
      }
      throw error;
    }
    return ok({ linkId });
  },

  async removeLink(db: Db, userId: string, linkId: string): Promise<Result<{ removed: true }>> {
    const [row] = await db
      .delete(transactionLinks)
      .where(
        and(
          eq(transactionLinks.id, linkId),
          eq(transactionLinks.userId, userId),
          inArray(transactionLinks.linkType, ["refund_of", "duplicate_of"]),
        ),
      )
      .returning({ id: transactionLinks.id });
    if (!row) return err("not_found", "That link doesn’t exist.");
    return ok({ removed: true as const });
  },

  /** Marks a possible duplicate: linked and excluded from reports (undoable). */
  async markDuplicate(
    db: Db,
    userId: string,
    input: { duplicateTransactionId: string; canonicalTransactionId: string },
  ): Promise<Result<{ linkId: string }>> {
    const dup = await this.getDetail(db, userId, input.duplicateTransactionId);
    const canonical = await this.getDetail(db, userId, input.canonicalTransactionId);
    if (!dup || !canonical) return err("not_found", "That transaction doesn’t exist.");
    const linkId = uuidv7();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(transactionLinks).values({
          id: linkId,
          userId,
          linkType: "duplicate_of",
          fromTransactionId: input.duplicateTransactionId,
          toTransactionId: input.canonicalTransactionId,
        });
        await tx
          .update(transactions)
          .set({ isExcluded: true, updatedAt: sql`now()` })
          .where(
            and(eq(transactions.id, input.duplicateTransactionId), eq(transactions.userId, userId)),
          );
        await auditRepo.record(tx as unknown as Db, {
          id: uuidv7(),
          userId,
          actor: "user",
          eventType: "transaction.marked_duplicate",
          entityType: "transaction",
          entityId: input.duplicateTransactionId,
          diff: { canonicalTransactionId: input.canonicalTransactionId },
        });
      });
    } catch (error) {
      if (pgErrorCode(error) === UNIQUE_VIOLATION) {
        return err("conflict", "These transactions are already linked.");
      }
      throw error;
    }
    return ok({ linkId });
  },

  async unmarkDuplicate(
    db: Db,
    userId: string,
    duplicateTransactionId: string,
  ): Promise<Result<{ removed: true }>> {
    const [link] = await db
      .select()
      .from(transactionLinks)
      .where(
        and(
          eq(transactionLinks.userId, userId),
          eq(transactionLinks.linkType, "duplicate_of"),
          eq(transactionLinks.fromTransactionId, duplicateTransactionId),
        ),
      )
      .limit(1);
    if (!link) return err("not_found", "That transaction isn’t marked as a duplicate.");
    await db.transaction(async (tx) => {
      await tx.delete(transactionLinks).where(eq(transactionLinks.id, link.id));
      await tx
        .update(transactions)
        .set({ isExcluded: false, updatedAt: sql`now()` })
        .where(and(eq(transactions.id, duplicateTransactionId), eq(transactions.userId, userId)));
    });
    return ok({ removed: true as const });
  },

  async setReviewed(
    db: Db,
    userId: string,
    transactionIds: string[],
    reviewed: boolean,
  ): Promise<Result<{ updated: number }>> {
    if (transactionIds.length === 0) return ok({ updated: 0 });
    if (!(await assertOwned(db, "transactions", userId, transactionIds))) {
      return err("not_found", "One of those transactions doesn’t exist.");
    }
    const rows = await db
      .update(transactions)
      .set({ needsReview: !reviewed, updatedAt: sql`now()` })
      .where(and(inArray(transactions.id, transactionIds), eq(transactions.userId, userId)))
      .returning({ id: transactions.id });
    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: reviewed ? "transaction.bulk_reviewed" : "transaction.bulk_unreviewed",
      diff: { count: rows.length },
    });
    return ok({ updated: rows.length });
  },

  async bulkSetCategory(
    db: Db,
    userId: string,
    input: { transactionIds: string[]; categoryId: string },
  ): Promise<Result<{ updated: number }>> {
    if (input.transactionIds.length === 0) return ok({ updated: 0 });
    if (!(await assertOwned(db, "transactions", userId, input.transactionIds))) {
      return err("not_found", "One of those transactions doesn’t exist.");
    }
    if (!(await assertOwned(db, "categories", userId, [input.categoryId]))) {
      return err("not_found", "That category doesn’t exist.");
    }
    const [transferLeg] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          inArray(transactions.id, input.transactionIds),
          eq(transactions.userId, userId),
          eq(transactions.type, "transfer"),
        ),
      )
      .limit(1);
    if (transferLeg) {
      return invalid("Transfers don’t take categories — deselect the transfer legs first.");
    }
    const rows = await db
      .update(transactions)
      .set({ categoryId: input.categoryId, categorizationSource: "user", updatedAt: sql`now()` })
      .where(and(inArray(transactions.id, input.transactionIds), eq(transactions.userId, userId)))
      .returning({ id: transactions.id });
    await auditRepo.record(db, {
      id: uuidv7(),
      userId,
      actor: "user",
      eventType: "transaction.bulk_categorized",
      diff: { count: rows.length, categoryId: input.categoryId },
    });
    return ok({ updated: rows.length });
  },

  async bulkSetExcluded(
    db: Db,
    userId: string,
    input: { transactionIds: string[]; excluded: boolean },
  ): Promise<Result<{ updated: number }>> {
    if (input.transactionIds.length === 0) return ok({ updated: 0 });
    if (!(await assertOwned(db, "transactions", userId, input.transactionIds))) {
      return err("not_found", "One of those transactions doesn’t exist.");
    }
    const rows = await db
      .update(transactions)
      .set({ isExcluded: input.excluded, updatedAt: sql`now()` })
      .where(and(inArray(transactions.id, input.transactionIds), eq(transactions.userId, userId)))
      .returning({ id: transactions.id });
    return ok({ updated: rows.length });
  },

  async list(
    db: Db,
    userId: string,
    query: ListQuery,
  ): Promise<{ items: TransactionListItem[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const sort = query.sort ?? "date_desc";

    const conditions = [
      eq(transactions.userId, userId),
      query.deleted ? isNotNull(transactions.deletedAt) : isNull(transactions.deletedAt),
    ];
    if (query.accountIds?.length)
      conditions.push(inArray(transactions.accountId, query.accountIds));
    if (query.categoryIds?.length)
      conditions.push(inArray(transactions.categoryId, query.categoryIds));
    if (query.types?.length) conditions.push(inArray(transactions.type, query.types));
    if (query.statuses?.length) conditions.push(inArray(transactions.status, query.statuses));
    if (query.review === "needs_review") conditions.push(eq(transactions.needsReview, true));
    if (query.review === "reviewed") conditions.push(eq(transactions.needsReview, false));
    if (query.excluded !== undefined) conditions.push(eq(transactions.isExcluded, query.excluded));
    if (query.dateFrom) conditions.push(sql`${transactions.txnDate} >= ${query.dateFrom}`);
    if (query.dateTo) conditions.push(sql`${transactions.txnDate} <= ${query.dateTo}`);
    if (query.tagIds?.length) {
      const tagList = sql.join(
        query.tagIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      conditions.push(
        sql`exists (select 1 from transaction_tags tt where tt.transaction_id = ${transactions.id} and tt.tag_id in (${tagList}))`,
      );
    }
    if (query.search?.trim()) {
      const needle = `%${query.search.trim()}%`;
      conditions.push(
        sql`(${transactions.descriptionOriginal} ilike ${needle}
          or coalesce(${transactions.descriptionClean}, '') ilike ${needle}
          or exists (select 1 from merchants m where m.id = ${transactions.merchantId} and m.canonical_name ilike ${needle}))`,
      );
    }

    const byAmount = sort === "amount_desc" || sort === "amount_asc";
    const descending = sort === "date_desc" || sort === "amount_desc";
    const keyColumn = byAmount ? transactions.amountMinor : transactions.txnDate;
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor, cursorSchema);
      if (decoded) {
        const keyValue = byAmount ? Number(decoded.k) : decoded.k;
        conditions.push(
          descending
            ? sql`(${keyColumn}, ${transactions.id}) < (${keyValue}, ${decoded.id})`
            : sql`(${keyColumn}, ${transactions.id}) > (${keyValue}, ${decoded.id})`,
        );
      }
    }

    const orderBy = descending
      ? [sql`${keyColumn} desc`, sql`${transactions.id} desc`]
      : [sql`${keyColumn} asc`, sql`${transactions.id} asc`];

    const rows = await db
      .select({
        ...getTableColumns(transactions),
        accountName: accounts.name,
        merchantName: merchants.canonicalName,
        categoryName: categories.name,
        hasSplits: sql<boolean>`exists (select 1 from transaction_splits s where s.transaction_id = ${transactions.id})`,
        isTransferLeg: sql<boolean>`${transactions.type} = 'transfer'`,
        tagNames: sql<
          string[]
        >`coalesce((select array_agg(tg.name order by tg.name) from transaction_tags tt join tags tg on tg.id = tt.tag_id where tt.transaction_id = ${transactions.id}), '{}')`,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(merchants, eq(merchants.id, transactions.merchantId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const last = page[page.length - 1];
      nextCursor = encodeCursor({
        k: byAmount ? String(last.amountMinor) : last.txnDate,
        id: last.id,
      });
    }

    return {
      items: page.map((row) => ({
        id: row.id,
        userId: row.userId,
        accountId: row.accountId,
        accountName: row.accountName,
        type: row.type,
        status: row.status,
        isExcluded: row.isExcluded,
        needsReview: row.needsReview,
        amountMinor: row.amountMinor,
        currency: row.currency.trim(),
        txnDate: row.txnDate,
        descriptionOriginal: row.descriptionOriginal,
        merchantName: row.merchantName,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        version: row.version,
        deletedAt: row.deletedAt,
        hasSplits: row.hasSplits,
        isTransferLeg: row.isTransferLeg,
        tagNames: row.tagNames ?? [],
      })),
      nextCursor,
    };
  },

  /** Per-currency income/expense/net under the documented reporting rules. */
  async summary(
    db: Db,
    userId: string,
    filter: { accountIds?: string[]; dateFrom?: string; dateTo?: string },
  ): Promise<Record<string, { incomeMinor: number; expenseMinor: number; netMinor: number }>> {
    const conditions = [
      eq(transactions.userId, userId),
      eq(transactions.status, "posted"),
      eq(transactions.isExcluded, false),
      isNull(transactions.deletedAt),
    ];
    if (filter.accountIds?.length)
      conditions.push(inArray(transactions.accountId, filter.accountIds));
    if (filter.dateFrom) conditions.push(sql`${transactions.txnDate} >= ${filter.dateFrom}`);
    if (filter.dateTo) conditions.push(sql`${transactions.txnDate} <= ${filter.dateTo}`);

    const rows = await db
      .select({
        currency: transactions.currency,
        incomeMinor:
          sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.type} = 'income'), 0)::bigint`.mapWith(
            Number,
          ),
        grossExpenseMinor:
          sql<number>`coalesce(sum(-${transactions.amountMinor}) filter (where ${transactions.type} = 'expense'), 0)::bigint`.mapWith(
            Number,
          ),
        refundMinor:
          sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.type} = 'refund'), 0)::bigint`.mapWith(
            Number,
          ),
      })
      .from(transactions)
      .where(and(...conditions))
      .groupBy(transactions.currency);

    const result: Record<string, { incomeMinor: number; expenseMinor: number; netMinor: number }> =
      {};
    for (const row of rows) {
      const expenseMinor = row.grossExpenseMinor - row.refundMinor;
      result[row.currency.trim()] = {
        incomeMinor: row.incomeMinor,
        expenseMinor,
        netMinor: row.incomeMinor - expenseMinor,
      };
    }
    return result;
  },

  async listAuditHistory(db: Db, userId: string, transactionId: string) {
    return auditRepo.listForEntity(db, userId, "transaction", transactionId);
  },
} as const;
