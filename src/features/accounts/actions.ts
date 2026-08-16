"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parseAmountToMinor } from "@/lib/money";
import { err, ok, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { accountsService } from "@/server/services/accounts";

import { accountFormSchema, reconcileSchema } from "./schemas";

export type AccountFormState = Result<{ message?: string; accountId?: string }> | null;

function parseSignedAmount(raw: string, field: string): Result<number> {
  const minor = raw === "" ? 0 : parseAmountToMinor(raw);
  if (minor === null) {
    return err("invalid_input", "Please check the form.", {
      [field]: ["Enter an amount like 1,250.00 (a leading minus is fine)."],
    });
  }
  return ok(minor);
}

function readAccountForm(formData: FormData) {
  return accountFormSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    currency: formData.get("currency"),
    openingBalance: (formData.get("openingBalance") as string) ?? "",
    openingBalanceDate: formData.get("openingBalanceDate"),
    creditLimit: (formData.get("creditLimit") as string) ?? "",
    includeInNetWorth: formData.get("includeInNetWorth") === "on",
  });
}

export async function createAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { user } = await requireUser();
  const parsed = readAccountForm(formData);
  if (!parsed.success) return zodToErr(parsed.error);

  const opening = parseSignedAmount(parsed.data.openingBalance, "openingBalance");
  if (!opening.ok) return opening;
  let creditLimitMinor: number | null = null;
  if (parsed.data.creditLimit) {
    const limit = parseSignedAmount(parsed.data.creditLimit, "creditLimit");
    if (!limit.ok) return limit;
    creditLimitMinor = limit.data;
  }

  const result = await accountsService.create(getDb(), user.id, {
    name: parsed.data.name,
    type: parsed.data.type,
    currency: parsed.data.currency,
    openingBalanceMinor: opening.data,
    openingBalanceDate: parsed.data.openingBalanceDate,
    creditLimitMinor,
    includeInNetWorth: parsed.data.includeInNetWorth,
  });
  if (!result.ok) return result;
  revalidatePath("/accounts");
  revalidatePath("/overview");
  revalidatePath("/onboarding");
  return ok({ message: "Account created.", accountId: result.data.id });
}

export async function updateAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { user } = await requireUser();
  const meta = z
    .object({ accountId: z.string().uuid(), version: z.coerce.number().int().min(1) })
    .safeParse({ accountId: formData.get("accountId"), version: formData.get("version") });
  if (!meta.success) return zodToErr(meta.error);
  const parsed = readAccountForm(formData);
  if (!parsed.success) return zodToErr(parsed.error);

  const opening = parseSignedAmount(parsed.data.openingBalance, "openingBalance");
  if (!opening.ok) return opening;
  let creditLimitMinor: number | null = null;
  if (parsed.data.creditLimit) {
    const limit = parseSignedAmount(parsed.data.creditLimit, "creditLimit");
    if (!limit.ok) return limit;
    creditLimitMinor = limit.data;
  }

  const result = await accountsService.update(
    getDb(),
    user.id,
    meta.data.accountId,
    {
      name: parsed.data.name,
      openingBalanceMinor: opening.data,
      openingBalanceDate: parsed.data.openingBalanceDate,
      creditLimitMinor,
      includeInNetWorth: parsed.data.includeInNetWorth,
    },
    meta.data.version,
  );
  if (!result.ok) return result;
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${meta.data.accountId}`);
  revalidatePath("/overview");
  return ok({ message: "Account saved." });
}

export async function setAccountArchivedAction(formData: FormData): Promise<void> {
  const { user } = await requireUser();
  const parsed = z
    .object({ accountId: z.string().uuid(), archived: z.enum(["true", "false"]) })
    .safeParse({ accountId: formData.get("accountId"), archived: formData.get("archived") });
  if (!parsed.success) return;
  await accountsService.setArchived(
    getDb(),
    user.id,
    parsed.data.accountId,
    parsed.data.archived === "true",
  );
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${parsed.data.accountId}`);
}

export async function deleteAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ accountId: z.string().uuid() })
    .safeParse({ accountId: formData.get("accountId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await accountsService.softDelete(getDb(), user.id, parsed.data.accountId);
  if (!result.ok) return result;
  revalidatePath("/accounts");
  return ok({ message: "Account deleted." });
}

export async function recordReconciliationAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { user } = await requireUser();
  const parsed = reconcileSchema.safeParse({
    accountId: formData.get("accountId"),
    asOf: formData.get("asOf"),
    statementBalance: formData.get("statementBalance"),
    createAdjustment: formData.get("createAdjustment") === "on",
  });
  if (!parsed.success) return zodToErr(parsed.error);
  const statement = parseSignedAmount(parsed.data.statementBalance, "statementBalance");
  if (!statement.ok) return statement;

  const db = getDb();
  const preview = await accountsService.previewReconciliation(db, user.id, {
    accountId: parsed.data.accountId,
    asOf: parsed.data.asOf,
    statementBalanceMinor: statement.data,
  });
  if (!preview.ok) return preview;

  const result = await accountsService.recordReconciliation(db, user.id, {
    accountId: parsed.data.accountId,
    asOf: parsed.data.asOf,
    statementBalanceMinor: statement.data,
    createAdjustment: parsed.data.createAdjustment,
  });
  if (!result.ok) return result;
  revalidatePath(`/accounts/${parsed.data.accountId}`);
  revalidatePath("/accounts");
  const diff = preview.data.discrepancyMinor;
  return ok({
    message:
      diff === 0
        ? "Reconciled — the statement matches FinPilot exactly."
        : parsed.data.createAdjustment
          ? "Reconciled with an adjustment recorded for the discrepancy."
          : "Snapshot recorded. The discrepancy was noted without an adjustment.",
  });
}
