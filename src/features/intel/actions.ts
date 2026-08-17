"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ok, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { budgetsService } from "@/server/services/budgets";
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
