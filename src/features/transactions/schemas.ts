import { z } from "zod";

import { isValidIsoDate } from "@/lib/dates";

export const MANUAL_TXN_TYPES = [
  "expense",
  "income",
  "refund",
  "adjustment",
  "debt_payment",
] as const;

export const TXN_TYPE_LABELS: Record<string, string> = {
  expense: "Expense",
  income: "Income",
  refund: "Refund",
  adjustment: "Adjustment",
  debt_payment: "Debt payment",
  transfer: "Transfer",
};

const isoDate = z.string().refine(isValidIsoDate, "Enter a valid date.");

const splitInputSchema = z.object({
  categoryId: z.string().uuid(),
  /** Positive magnitude as typed; the action applies the parent's sign. */
  amount: z.string().trim().min(1).max(24),
  note: z.string().trim().max(200).optional(),
  isReimbursable: z.boolean().optional(),
});

export const transactionFormSchema = z.object({
  accountId: z.string().uuid("Pick an account."),
  type: z.enum(MANUAL_TXN_TYPES),
  amount: z.string().trim().min(1, "Enter an amount.").max(24),
  txnDate: isoDate,
  description: z.string().trim().max(200).optional().or(z.literal("")),
  merchantName: z.string().trim().max(120).optional().or(z.literal("")),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  tagIds: z.array(z.string().uuid()).max(10).optional(),
  status: z.enum(["pending", "posted"]),
  isExcluded: z.boolean(),
  needsReview: z.boolean(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  /** JSON-encoded array from the split editor. */
  splits: z.array(splitInputSchema).max(20).optional(),
});

export const transferFormSchema = z.object({
  fromAccountId: z.string().uuid("Pick the source account."),
  toAccountId: z.string().uuid("Pick the destination account."),
  amount: z.string().trim().min(1, "Enter an amount.").max(24),
  txnDate: isoDate,
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export const bulkActionSchema = z.object({
  intent: z.enum(["review", "unreview", "categorize", "exclude", "include"]),
  transactionIds: z.array(z.string().uuid()).min(1).max(200),
  categoryId: z.string().uuid().optional(),
});
