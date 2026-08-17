"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { parseAmountToMinor } from "@/lib/money";
import { err, ok, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { goalsService, type GoalStatus, type GoalType } from "@/server/services/goals";

export type GoalFormState = Result<{ message?: string; goalId?: string }> | null;

function refresh(goalId?: string): void {
  revalidatePath("/goals");
  if (goalId) revalidatePath(`/goals/${goalId}`);
  revalidatePath("/overview");
}

function parsePositiveAmount(raw: string, field: string): Result<number> {
  const minor = parseAmountToMinor(raw);
  if (minor === null || minor <= 0) {
    return err("invalid_input", "Please check the form.", {
      [field]: ["Enter an amount above zero, like 15,000.00."],
    });
  }
  return ok(minor);
}

const GOAL_TYPES = [
  "emergency",
  "purchase",
  "travel",
  "education",
  "debt_payoff",
  "custom",
] as const;

const goalFormSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(GOAL_TYPES),
  target: z.string().min(1),
  currency: z.string().trim().length(3),
  targetDate: z.string().optional(),
  priority: z.coerce.number().int().min(1).max(5),
  linkedAccountId: z.string().uuid().optional().or(z.literal("")),
  plannedContribution: z.string().optional(),
});

function readGoalForm(formData: FormData) {
  return goalFormSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    target: formData.get("target"),
    currency: formData.get("currency") ?? "MYR",
    targetDate: (formData.get("targetDate") as string) ?? undefined,
    priority: formData.get("priority") ?? 3,
    linkedAccountId: (formData.get("linkedAccountId") as string) ?? "",
    plannedContribution: (formData.get("plannedContribution") as string) ?? undefined,
  });
}

function parseGoalNumbers(d: z.infer<typeof goalFormSchema>): Result<{
  targetAmountMinor: number;
  contributionSchedule: { amountMinor: number; frequency: "monthly" } | null;
  targetDate: string | null;
}> {
  const target = parsePositiveAmount(d.target, "target");
  if (!target.ok) return target;
  let contributionSchedule: { amountMinor: number; frequency: "monthly" } | null = null;
  if (d.plannedContribution && d.plannedContribution.trim() !== "") {
    const planned = parsePositiveAmount(d.plannedContribution, "plannedContribution");
    if (!planned.ok) return planned;
    contributionSchedule = { amountMinor: planned.data, frequency: "monthly" };
  }
  return ok({
    targetAmountMinor: target.data,
    contributionSchedule,
    targetDate: d.targetDate?.trim() ? d.targetDate : null,
  });
}

export async function createGoalAction(
  _prev: GoalFormState,
  formData: FormData,
): Promise<GoalFormState> {
  const { user } = await requireUser();
  const parsed = readGoalForm(formData);
  if (!parsed.success) return zodToErr(parsed.error);
  const numbers = parseGoalNumbers(parsed.data);
  if (!numbers.ok) return numbers;

  const result = await goalsService.create(getDb(), user.id, {
    name: parsed.data.name,
    type: parsed.data.type as GoalType,
    targetAmountMinor: numbers.data.targetAmountMinor,
    currency: parsed.data.currency.toUpperCase(),
    targetDate: numbers.data.targetDate,
    priority: parsed.data.priority,
    linkedAccountId: parsed.data.linkedAccountId || null,
    contributionSchedule: numbers.data.contributionSchedule,
  });
  if (!result.ok) return result;
  refresh(result.data.id);
  return ok({ message: "Goal created.", goalId: result.data.id });
}

export async function updateGoalAction(
  _prev: GoalFormState,
  formData: FormData,
): Promise<GoalFormState> {
  const { user } = await requireUser();
  const idParsed = z.object({ goalId: z.string().uuid() }).safeParse({
    goalId: formData.get("goalId"),
  });
  if (!idParsed.success) return zodToErr(idParsed.error);
  const parsed = readGoalForm(formData);
  if (!parsed.success) return zodToErr(parsed.error);
  const numbers = parseGoalNumbers(parsed.data);
  if (!numbers.ok) return numbers;

  const result = await goalsService.update(getDb(), user.id, idParsed.data.goalId, {
    name: parsed.data.name,
    type: parsed.data.type as GoalType,
    targetAmountMinor: numbers.data.targetAmountMinor,
    targetDate: numbers.data.targetDate,
    priority: parsed.data.priority,
    linkedAccountId: parsed.data.linkedAccountId || null,
    contributionSchedule: numbers.data.contributionSchedule,
  });
  if (!result.ok) return result;
  refresh(idParsed.data.goalId);
  return ok({ message: "Goal updated." });
}

/**
 * Explicit what-if application: a plain form POST that runs the same update
 * path and returns to the goal (clearing the what-if URL params).
 */
export async function applyWhatIfAction(formData: FormData): Promise<void> {
  const result = await updateGoalAction(null, formData);
  const goalId = formData.get("goalId");
  if (result?.ok && typeof goalId === "string") {
    redirect(`/goals/${goalId}`);
  }
  if (typeof goalId === "string") {
    redirect(`/goals/${goalId}?applyError=1`);
  }
  redirect("/goals");
}

export async function setGoalStatusAction(
  _prev: GoalFormState,
  formData: FormData,
): Promise<GoalFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      goalId: z.string().uuid(),
      status: z.enum(["active", "paused", "completed", "archived"]),
    })
    .safeParse({ goalId: formData.get("goalId"), status: formData.get("status") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await goalsService.setStatus(
    getDb(),
    user.id,
    parsed.data.goalId,
    parsed.data.status as GoalStatus,
  );
  if (!result.ok) return result;
  refresh(parsed.data.goalId);
  const verb: Record<string, string> = {
    active: "reactivated",
    paused: "paused",
    completed: "marked completed — congratulations!",
    archived: "archived (history preserved)",
  };
  return ok({ message: `Goal ${verb[parsed.data.status]}.` });
}

export async function addContributionAction(
  _prev: GoalFormState,
  formData: FormData,
): Promise<GoalFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      goalId: z.string().uuid(),
      direction: z.enum(["contribution", "withdrawal"]),
      amount: z.string().min(1),
      contributedOn: z.string().min(1),
      note: z.string().trim().max(300).optional(),
      idempotencyId: z.string().uuid(),
    })
    .safeParse({
      goalId: formData.get("goalId"),
      direction: formData.get("direction"),
      amount: formData.get("amount"),
      contributedOn: formData.get("contributedOn"),
      note: (formData.get("note") as string) ?? undefined,
      idempotencyId: formData.get("idempotencyId"),
    });
  if (!parsed.success) return zodToErr(parsed.error);
  const amount = parsePositiveAmount(parsed.data.amount, "amount");
  if (!amount.ok) return amount;
  const signed = parsed.data.direction === "withdrawal" ? -amount.data : amount.data;

  const result = await goalsService.addContribution(getDb(), user.id, parsed.data.goalId, {
    id: parsed.data.idempotencyId,
    amountMinor: signed,
    contributedOn: parsed.data.contributedOn,
    note: parsed.data.note || null,
  });
  if (!result.ok) return result;
  refresh(parsed.data.goalId);
  return ok({
    message:
      parsed.data.direction === "withdrawal"
        ? "Withdrawal recorded in the goal’s history."
        : "Contribution recorded — no money was moved, this only tracks your goal.",
  });
}
