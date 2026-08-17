"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { localDateInTz } from "@/lib/dates";
import { ok, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { assistantService, type AssistantAnswer } from "@/server/services/assistant";
import { budgetsService } from "@/server/services/budgets";
import { categorizeService } from "@/server/services/categorize";
import { intelService } from "@/server/services/intel";

export type IntelFormState = Result<{ message?: string }> | null;

export async function dismissInsightAction(
  _prev: IntelFormState,
  formData: FormData,
): Promise<IntelFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ insightId: z.string().uuid() })
    .safeParse({ insightId: formData.get("insightId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await intelService.setInsightStatus(
    getDb(),
    user.id,
    parsed.data.insightId,
    "dismissed",
  );
  if (!result.ok) return result;
  revalidatePath("/insights");
  revalidatePath("/overview");
  revalidatePath("/budget");
  return ok({ message: "Dismissed — it won’t come back for this period." });
}

/**
 * Apply a deterministic budget suggestion: an explicit, audited allocation
 * update (the suggestion never changes anything by itself).
 */
export async function applySuggestionAction(
  _prev: IntelFormState,
  formData: FormData,
): Promise<IntelFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      insightId: z.string().uuid(),
      periodId: z.string().uuid(),
      categoryId: z.string().uuid(),
      suggestedMinor: z.coerce.number().int().positive(),
      expectedVersion: z.coerce.number().int().min(1),
    })
    .safeParse({
      insightId: formData.get("insightId"),
      periodId: formData.get("periodId"),
      categoryId: formData.get("categoryId"),
      suggestedMinor: formData.get("suggestedMinor"),
      expectedVersion: formData.get("expectedVersion"),
    });
  if (!parsed.success) return zodToErr(parsed.error);

  const db = getDb();
  const applied = await budgetsService.setAllocation(db, user.id, {
    periodId: parsed.data.periodId,
    categoryId: parsed.data.categoryId,
    plannedMinor: parsed.data.suggestedMinor,
    expectedVersion: parsed.data.expectedVersion,
  });
  if (!applied.ok) return applied;
  await intelService.setInsightStatus(db, user.id, parsed.data.insightId, "actioned");
  revalidatePath("/budget");
  revalidatePath("/insights");
  revalidatePath("/overview");
  return ok({ message: "Applied — the allocation now matches your baseline." });
}

export type AssistantFormState = { answer: AssistantAnswer; question: string } | null;

export async function askAssistantAction(
  _prev: AssistantFormState,
  formData: FormData,
): Promise<AssistantFormState> {
  const { user } = await requireUser();
  const question = String(formData.get("question") ?? "").trim();
  if (!question) return null;
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");
  const answer = await assistantService.ask(db, user.id, question, today);
  return { answer, question };
}

const queueActionSchema = z.object({
  suggestionId: z.string().uuid(),
  action: z.enum(["approve", "dismiss", "snooze", "edit"]),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  reasonCode: z.string().max(40).optional().or(z.literal("")),
});

export async function resolveSuggestionAction(
  _prev: IntelFormState,
  formData: FormData,
): Promise<IntelFormState> {
  const { user } = await requireUser();
  const parsed = queueActionSchema.safeParse({
    suggestionId: formData.get("suggestionId"),
    action: formData.get("action"),
    categoryId: (formData.get("categoryId") as string) ?? "",
    reasonCode: (formData.get("reasonCode") as string) ?? "",
  });
  if (!parsed.success) return zodToErr(parsed.error);
  const db = getDb();
  const d = parsed.data;
  const action =
    d.action === "approve"
      ? ({ kind: "approve" } as const)
      : d.action === "snooze"
        ? ({ kind: "snooze" } as const)
        : d.action === "dismiss"
          ? ({ kind: "dismiss", reasonCode: d.reasonCode || undefined } as const)
          : d.categoryId
            ? ({ kind: "edit", categoryId: d.categoryId } as const)
            : null;
  if (!action) {
    return { ok: false, error: { code: "invalid_input", message: "Pick a category to apply." } };
  }
  const result = await categorizeService.resolve(db, user.id, d.suggestionId, action);
  if (!result.ok) return result;
  revalidatePath("/insights");
  revalidatePath("/transactions");
  const messages: Record<string, string> = {
    approved: "Applied - the transaction is categorized and marked reviewed.",
    edited: "Applied with your category - the suggestion learns from this.",
    dismissed: "Dismissed.",
    snoozed: "Snoozed for a week.",
  };
  return ok({ message: messages[result.data.status] ?? "Done." });
}

export async function insightFeedbackAction(
  _prev: IntelFormState,
  formData: FormData,
): Promise<IntelFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      insightId: z.string().uuid(),
      verdict: z.enum(["helpful", "not_helpful"]),
    })
    .safeParse({ insightId: formData.get("insightId"), verdict: formData.get("verdict") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await categorizeService.recordInsightFeedback(
    getDb(),
    user.id,
    parsed.data.insightId,
    parsed.data.verdict,
  );
  if (!result.ok) return result;
  return ok({ message: "Thanks - feedback recorded." });
}
