"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parseAmountToMinor } from "@/lib/money";
import { err, ok, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { budgetsService } from "@/server/services/budgets";

export type BudgetFormState = Result<{ message?: string }> | null;

function refresh(): void {
  revalidatePath("/budget");
  revalidatePath("/overview");
}

function parseAmount(raw: string, field: string): Result<number> {
  const minor = raw.trim() === "" ? 0 : parseAmountToMinor(raw);
  if (minor === null || minor < 0) {
    return err("invalid_input", "Please check the form.", {
      [field]: ["Enter an amount like 600 or 1,250.00."],
    });
  }
  return ok(minor);
}

export async function createBudgetAction(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      mode: z.enum(["fixed", "flexible", "rollover", "zero_based"]),
      cycleType: z.enum(["calendar_month", "payday"]),
      paydayDay: z.string().optional(),
      weekendAdjust: z.boolean(),
      currency: z.string().trim().length(3),
      carryNegative: z.boolean(),
    })
    .safeParse({
      name: formData.get("name"),
      mode: formData.get("mode"),
      cycleType: formData.get("cycleType"),
      paydayDay: (formData.get("paydayDay") as string) ?? undefined,
      weekendAdjust: formData.get("weekendAdjust") === "on",
      currency: formData.get("currency") ?? "MYR",
      carryNegative: formData.get("carryNegative") === "on",
    });
  if (!parsed.success) return zodToErr(parsed.error);
  const d = parsed.data;

  let cycleAnchor: { day: number | "last"; weekendAdjust: boolean } | null = null;
  if (d.cycleType === "payday") {
    const raw = (d.paydayDay ?? "").trim();
    const day = raw === "last" ? ("last" as const) : Number(raw);
    if (day !== "last" && (!Number.isInteger(day) || day < 1 || day > 28)) {
      return err("invalid_input", "Please check the form.", {
        paydayDay: ["Pick a payday between 1 and 28, or the last day."],
      });
    }
    cycleAnchor = { day, weekendAdjust: d.weekendAdjust };
  }

  const result = await budgetsService.create(getDb(), user.id, {
    name: d.name,
    mode: d.mode,
    cycleType: d.cycleType,
    cycleAnchor,
    currency: d.currency.toUpperCase(),
    carryNegative: d.carryNegative,
  });
  if (!result.ok) return result;
  refresh();
  return ok({ message: "Budget created — allocate your first categories below." });
}

export async function setAllocationAction(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      periodId: z.string().uuid(),
      categoryId: z.string().uuid(),
      planned: z.string(),
      rolloverEnabled: z.boolean(),
      notes: z.string().trim().max(500).optional(),
      expectedVersion: z.coerce.number().int().min(1).optional(),
      allocationId: z.string().uuid().optional(),
    })
    .safeParse({
      periodId: formData.get("periodId"),
      categoryId: formData.get("categoryId"),
      planned: formData.get("planned"),
      rolloverEnabled: formData.get("rolloverEnabled") === "on",
      notes: (formData.get("notes") as string) ?? undefined,
      expectedVersion: formData.get("expectedVersion") || undefined,
      allocationId: formData.get("allocationId") || undefined,
    });
  if (!parsed.success) return zodToErr(parsed.error);
  const planned = parseAmount(parsed.data.planned, "planned");
  if (!planned.ok) return planned;

  const result = await budgetsService.setAllocation(getDb(), user.id, {
    periodId: parsed.data.periodId,
    categoryId: parsed.data.categoryId,
    plannedMinor: planned.data,
    rolloverEnabled: parsed.data.rolloverEnabled,
    notes: parsed.data.notes || null,
    expectedVersion: parsed.data.expectedVersion,
    allocationId: parsed.data.allocationId,
  });
  if (!result.ok) return result;
  refresh();
  return ok({ message: "Allocation saved." });
}

export async function deleteAllocationAction(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ allocationId: z.string().uuid() })
    .safeParse({ allocationId: formData.get("allocationId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await budgetsService.deleteAllocation(getDb(), user.id, parsed.data.allocationId);
  if (!result.ok) return result;
  refresh();
  return ok({ message: "Allocation removed." });
}

export async function copyPreviousPeriodAction(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ periodId: z.string().uuid() })
    .safeParse({ periodId: formData.get("periodId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await budgetsService.copyPreviousPeriod(getDb(), user.id, parsed.data.periodId);
  if (!result.ok) return result;
  refresh();
  return ok({
    message:
      result.data.copied === 0
        ? "Nothing new to copy — every previous category is already allocated."
        : `Copied ${result.data.copied} allocation(s) from the previous period.`,
  });
}

export async function updatePeriodMetaAction(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      periodId: z.string().uuid(),
      notes: z.string().trim().max(1000).optional(),
      expectedIncome: z.string().optional(),
    })
    .safeParse({
      periodId: formData.get("periodId"),
      notes: (formData.get("notes") as string) ?? undefined,
      expectedIncome: (formData.get("expectedIncome") as string) ?? undefined,
    });
  if (!parsed.success) return zodToErr(parsed.error);

  let expectedIncomeMinor: number | null | undefined;
  if (parsed.data.expectedIncome !== undefined) {
    if (parsed.data.expectedIncome.trim() === "") {
      expectedIncomeMinor = null;
    } else {
      const amount = parseAmount(parsed.data.expectedIncome, "expectedIncome");
      if (!amount.ok) return amount;
      expectedIncomeMinor = amount.data;
    }
  }
  const result = await budgetsService.updatePeriodMeta(getDb(), user.id, parsed.data.periodId, {
    notes: parsed.data.notes !== undefined ? parsed.data.notes || null : undefined,
    expectedIncomeMinor,
  });
  if (!result.ok) return result;
  refresh();
  return ok({ message: "Period details saved." });
}

export async function archiveBudgetAction(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ budgetId: z.string().uuid() })
    .safeParse({ budgetId: formData.get("budgetId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await budgetsService.archive(getDb(), user.id, parsed.data.budgetId);
  if (!result.ok) return result;
  refresh();
  return ok({ message: "Budget archived — its history stays readable." });
}
