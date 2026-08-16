import { z } from "zod";

import { isValidIsoDate } from "@/lib/dates";

export const ACCOUNT_TYPES = [
  "cash",
  "current",
  "savings",
  "ewallet",
  "credit_card",
  "loan",
  "investment",
  "asset_other",
  "liability_other",
] as const;

export const ACCOUNT_TYPE_LABELS: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  cash: "Cash",
  current: "Current account",
  savings: "Savings account",
  ewallet: "E-wallet",
  credit_card: "Credit card",
  loan: "Loan",
  investment: "Investment",
  asset_other: "Other asset",
  liability_other: "Other liability",
};

/** Phase 2 currencies: no conversion exists, so aggregation stays per-currency. */
export const CURRENCIES = ["MYR", "SGD", "USD"] as const;

const isoDate = z.string().refine(isValidIsoDate, "Enter a valid date.");

export const accountFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the account a name.")
    .max(80, "Keep it under 80 characters."),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.enum(CURRENCIES),
  /** Raw user input; parsed to signed minor units in the action (lib/money). */
  openingBalance: z.string().trim().max(24),
  openingBalanceDate: isoDate,
  creditLimit: z.string().trim().max(24).optional().or(z.literal("")),
  includeInNetWorth: z.boolean(),
});

export const reconcileSchema = z.object({
  accountId: z.string().uuid(),
  asOf: isoDate,
  statementBalance: z.string().trim().min(1, "Enter the statement balance.").max(24),
  createAdjustment: z.boolean(),
});
