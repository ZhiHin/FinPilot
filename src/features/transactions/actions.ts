"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { formatIsoDate } from "@/lib/dates";
import { formatMinor, parseAmountToMinor } from "@/lib/money";
import { err, ok, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import {
  transactionsService,
  type SplitInput,
  type TransactionDetail,
} from "@/server/services/transactions";

import { bulkActionSchema, transactionFormSchema, transferFormSchema } from "./schemas";

export type TxnFormState = Result<{ message?: string; transactionId?: string }> | null;

function revalidateLedger() {
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/overview");
}

/** Sign convention: users type magnitudes; the type decides the sign (ADR-003). */
function signedAmount(type: string, raw: string): Result<number> {
  const magnitude = parseAmountToMinor(raw.replace(/^-/, ""));
  if (magnitude === null || magnitude === 0) {
    // Adjustments may be zero; everything else needs a real amount.
    if (!(type === "adjustment" && magnitude === 0)) {
      return err("invalid_input", "Please check the form.", {
        amount: ["Enter an amount like 32.50."],
      });
    }
  }
  const value = magnitude ?? 0;
  const negative = raw.trim().startsWith("-");
  switch (type) {
    case "expense":
    case "debt_payment":
      return ok(-value);
    case "income":
    case "refund":
      return ok(value);
    case "adjustment":
      return ok(negative ? -value : value);
    default:
      return err("invalid_input", "Unknown transaction type.");
  }
}

function readTransactionForm(formData: FormData) {
  let splits: unknown;
  const rawSplits = formData.get("splits") as string | null;
  if (rawSplits) {
    try {
      splits = JSON.parse(rawSplits);
    } catch {
      splits = "invalid";
    }
  }
  return transactionFormSchema.safeParse({
    accountId: formData.get("accountId"),
    type: formData.get("type"),
    amount: formData.get("amount"),
    txnDate: formData.get("txnDate"),
    description: (formData.get("description") as string) ?? "",
    merchantName: (formData.get("merchantName") as string) ?? "",
    categoryId: (formData.get("categoryId") as string) ?? "",
    tagIds: formData.getAll("tagIds").map(String).filter(Boolean),
    status: formData.get("status") ?? "posted",
    isExcluded: formData.get("isExcluded") === "on",
    needsReview: formData.get("needsReview") === "on",
    notes: (formData.get("notes") as string) ?? "",
    splits,
  });
}

function toServiceSplits(
  parentSigned: number,
  splits: Array<{ categoryId: string; amount: string; note?: string; isReimbursable?: boolean }>,
): Result<SplitInput[]> {
  const sign = parentSigned < 0 ? -1 : 1;
  const out: SplitInput[] = [];
  for (const split of splits) {
    const magnitude = parseAmountToMinor(split.amount.replace(/^-/, ""));
    if (magnitude === null || magnitude === 0) {
      return err("invalid_input", "Please check the form.", {
        splits: ["Each split needs an amount like 12.50."],
      });
    }
    out.push({
      categoryId: split.categoryId,
      amountMinor: sign * magnitude,
      note: split.note ?? null,
      isReimbursable: split.isReimbursable ?? false,
    });
  }
  return ok(out);
}

export async function createTransactionAction(
  _prev: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const { user } = await requireUser();
  const parsed = readTransactionForm(formData);
  if (!parsed.success) return zodToErr(parsed.error);
  const amount = signedAmount(parsed.data.type, parsed.data.amount);
  if (!amount.ok) return amount;
  let splits: SplitInput[] | undefined;
  if (parsed.data.splits?.length) {
    const converted = toServiceSplits(amount.data, parsed.data.splits);
    if (!converted.ok) return converted;
    splits = converted.data;
  }

  const result = await transactionsService.create(getDb(), user.id, {
    accountId: parsed.data.accountId,
    type: parsed.data.type,
    amountMinor: amount.data,
    txnDate: parsed.data.txnDate,
    description: parsed.data.description || undefined,
    merchantName: parsed.data.merchantName || undefined,
    categoryId: parsed.data.categoryId || null,
    tagIds: parsed.data.tagIds,
    status: parsed.data.status,
    isExcluded: parsed.data.isExcluded,
    needsReview: parsed.data.needsReview,
    notes: parsed.data.notes || null,
    splits,
  });
  if (!result.ok) return result;
  revalidateLedger();
  return ok({ message: "Transaction added.", transactionId: result.data.transaction.id });
}

export async function updateTransactionAction(
  _prev: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const { user } = await requireUser();
  const meta = z
    .object({ transactionId: z.string().uuid(), version: z.coerce.number().int().min(1) })
    .safeParse({ transactionId: formData.get("transactionId"), version: formData.get("version") });
  if (!meta.success) return zodToErr(meta.error);
  const parsed = readTransactionForm(formData);
  if (!parsed.success) return zodToErr(parsed.error);
  const amount = signedAmount(parsed.data.type, parsed.data.amount);
  if (!amount.ok) return amount;
  let splits: SplitInput[] | null = null;
  if (parsed.data.splits?.length) {
    const converted = toServiceSplits(amount.data, parsed.data.splits);
    if (!converted.ok) return converted;
    splits = converted.data;
  }

  const result = await transactionsService.update(
    getDb(),
    user.id,
    meta.data.transactionId,
    {
      accountId: parsed.data.accountId,
      amountMinor: amount.data,
      txnDate: parsed.data.txnDate,
      description: parsed.data.description ?? "",
      merchantName: parsed.data.merchantName || null,
      categoryId: parsed.data.categoryId || null,
      tagIds: parsed.data.tagIds ?? [],
      status: parsed.data.status,
      isExcluded: parsed.data.isExcluded,
      needsReview: parsed.data.needsReview,
      notes: parsed.data.notes || null,
      splits,
    },
    meta.data.version,
  );
  if (!result.ok) return result;
  revalidateLedger();
  return ok({ message: "Transaction saved." });
}

/** Restricted patch for transfer legs (notes/review/excluded only). */
export async function updateTransferLegAction(
  _prev: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      transactionId: z.string().uuid(),
      version: z.coerce.number().int().min(1),
      notes: z.string().trim().max(1000).optional().or(z.literal("")),
      isExcluded: z.boolean(),
      needsReview: z.boolean(),
    })
    .safeParse({
      transactionId: formData.get("transactionId"),
      version: formData.get("version"),
      notes: (formData.get("notes") as string) ?? "",
      isExcluded: formData.get("isExcluded") === "on",
      needsReview: formData.get("needsReview") === "on",
    });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await transactionsService.update(
    getDb(),
    user.id,
    parsed.data.transactionId,
    {
      notes: parsed.data.notes || null,
      isExcluded: parsed.data.isExcluded,
      needsReview: parsed.data.needsReview,
    },
    parsed.data.version,
  );
  if (!result.ok) return result;
  revalidateLedger();
  return ok({ message: "Transfer saved." });
}

export async function deleteTransactionAction(
  _prev: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ transactionId: z.string().uuid() })
    .safeParse({ transactionId: formData.get("transactionId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await transactionsService.softDelete(getDb(), user.id, parsed.data.transactionId);
  if (!result.ok) return result;
  revalidateLedger();
  return ok({
    message:
      result.data.deletedIds.length > 1
        ? "Transfer deleted (both legs). You can restore it from the Deleted view."
        : "Transaction deleted. You can restore it from the Deleted view.",
  });
}

export async function restoreTransactionAction(
  _prev: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ transactionId: z.string().uuid() })
    .safeParse({ transactionId: formData.get("transactionId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await transactionsService.restore(getDb(), user.id, parsed.data.transactionId);
  if (!result.ok) return result;
  revalidateLedger();
  return ok({ message: "Restored." });
}

export async function createTransferAction(
  _prev: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const { user } = await requireUser();
  const parsed = transferFormSchema.safeParse({
    fromAccountId: formData.get("fromAccountId"),
    toAccountId: formData.get("toAccountId"),
    amount: formData.get("amount"),
    txnDate: formData.get("txnDate"),
    notes: (formData.get("notes") as string) ?? "",
  });
  if (!parsed.success) return zodToErr(parsed.error);
  const magnitude = parseAmountToMinor(parsed.data.amount);
  if (magnitude === null || magnitude <= 0) {
    return err("invalid_input", "Please check the form.", {
      amount: ["Enter an amount above zero."],
    });
  }
  const result = await transactionsService.createTransfer(getDb(), user.id, {
    fromAccountId: parsed.data.fromAccountId,
    toAccountId: parsed.data.toAccountId,
    amountMinor: magnitude,
    txnDate: parsed.data.txnDate,
    notes: parsed.data.notes || null,
  });
  if (!result.ok) return result;
  revalidateLedger();
  return ok({ message: "Transfer recorded." });
}

export async function linkRefundAction(
  _prev: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ refundTransactionId: z.string().uuid(), purchaseTransactionId: z.string().uuid() })
    .safeParse({
      refundTransactionId: formData.get("refundTransactionId"),
      purchaseTransactionId: formData.get("purchaseTransactionId"),
    });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await transactionsService.linkRefund(getDb(), user.id, parsed.data);
  if (!result.ok) return result;
  revalidateLedger();
  return ok({ message: "Refund linked to its purchase." });
}

export async function markDuplicateAction(
  _prev: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      duplicateTransactionId: z.string().uuid(),
      canonicalTransactionId: z.string().uuid(),
    })
    .safeParse({
      duplicateTransactionId: formData.get("duplicateTransactionId"),
      canonicalTransactionId: formData.get("canonicalTransactionId"),
    });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await transactionsService.markDuplicate(getDb(), user.id, parsed.data);
  if (!result.ok) return result;
  revalidateLedger();
  return ok({ message: "Marked as a duplicate and excluded from reports." });
}

export async function unmarkDuplicateAction(
  _prev: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ transactionId: z.string().uuid() })
    .safeParse({ transactionId: formData.get("transactionId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await transactionsService.unmarkDuplicate(
    getDb(),
    user.id,
    parsed.data.transactionId,
  );
  if (!result.ok) return result;
  revalidateLedger();
  return ok({ message: "No longer marked as a duplicate." });
}

export async function removeLinkAction(
  _prev: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ linkId: z.string().uuid() })
    .safeParse({ linkId: formData.get("linkId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await transactionsService.removeLink(getDb(), user.id, parsed.data.linkId);
  if (!result.ok) return result;
  revalidateLedger();
  return ok({ message: "Link removed." });
}

export async function bulkTransactionAction(
  _prev: TxnFormState,
  formData: FormData,
): Promise<TxnFormState> {
  const { user } = await requireUser();
  let ids: unknown;
  try {
    ids = JSON.parse((formData.get("transactionIds") as string) ?? "[]");
  } catch {
    ids = [];
  }
  const parsed = bulkActionSchema.safeParse({
    intent: formData.get("intent"),
    transactionIds: ids,
    categoryId: (formData.get("categoryId") as string) || undefined,
  });
  if (!parsed.success) return zodToErr(parsed.error);

  const db = getDb();
  let result: Result<{ updated: number }>;
  switch (parsed.data.intent) {
    case "review":
      result = await transactionsService.setReviewed(db, user.id, parsed.data.transactionIds, true);
      break;
    case "unreview":
      result = await transactionsService.setReviewed(
        db,
        user.id,
        parsed.data.transactionIds,
        false,
      );
      break;
    case "categorize":
      if (!parsed.data.categoryId) {
        return err("invalid_input", "Pick a category first.");
      }
      result = await transactionsService.bulkSetCategory(db, user.id, {
        transactionIds: parsed.data.transactionIds,
        categoryId: parsed.data.categoryId,
      });
      break;
    case "exclude":
    case "include":
      result = await transactionsService.bulkSetExcluded(db, user.id, {
        transactionIds: parsed.data.transactionIds,
        excluded: parsed.data.intent === "exclude",
      });
      break;
  }
  if (!result.ok) return result;
  revalidateLedger();
  return ok({ message: `Updated ${result.data.updated} transaction(s).` });
}

export interface DrawerPayload {
  detail: TransactionDetail;
  audit: Array<{ id: string; eventType: string; createdAtIso: string; diff: unknown }>;
}

export interface CandidateResult {
  id: string;
  label: string;
  amountMinor: number;
  type: string;
}

/**
 * Search link candidates (refund purchases / duplicate originals) across the
 * whole ledger, not just the visible page.
 */
export async function searchLinkCandidatesAction(input: {
  search: string;
  kind: "expense" | "any";
  excludeId: string;
}): Promise<Result<CandidateResult[]>> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      search: z.string().trim().max(120),
      kind: z.enum(["expense", "any"]),
      excludeId: z.string().uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return err("invalid_input", "Invalid search.");

  const page = await transactionsService.list(getDb(), user.id, {
    search: parsed.data.search || undefined,
    types: parsed.data.kind === "expense" ? ["expense"] : undefined,
    limit: 20,
  });
  return ok(
    page.items
      .filter((item) => item.id !== parsed.data.excludeId)
      .map((item) => ({
        id: item.id,
        label: `${formatIsoDate(item.txnDate, "en-MY")} · ${item.merchantName ?? item.descriptionOriginal ?? "—"} · ${formatMinor(item.amountMinor, item.currency)}`,
        amountMinor: item.amountMinor,
        type: item.type,
      })),
  );
}

/** Drawer data: full detail + change history, fetched on open. */
export async function getTransactionDrawerAction(
  transactionId: string,
): Promise<Result<DrawerPayload>> {
  const { user } = await requireUser();
  const id = z.string().uuid().safeParse(transactionId);
  if (!id.success) return err("invalid_input", "Invalid transaction.");
  const db = getDb();
  const detail = await transactionsService.getDetail(db, user.id, id.data);
  if (!detail) return err("not_found", "That transaction doesn’t exist.");
  const audit = await transactionsService.listAuditHistory(db, user.id, id.data);
  return ok({
    detail,
    audit: audit.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      createdAtIso: row.createdAt.toISOString(),
      diff: row.diff,
    })),
  });
}
