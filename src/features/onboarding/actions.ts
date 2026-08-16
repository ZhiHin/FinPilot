"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { parseAmountToMinor } from "@/lib/money";
import { err, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { onboardingBufferSchema, onboardingLocaleSchema } from "@/features/settings/schemas";

export type OnboardingFormState = Result<{ message?: string }> | null;

interface OnboardingState {
  currentStep?: number;
  completed?: boolean;
  [key: string]: unknown;
}

async function mergeOnboardingState(userId: string, patch: OnboardingState): Promise<void> {
  const db = getDb();
  const prefs = await preferencesRepo.get(db, userId);
  const current = (prefs?.onboardingState ?? {}) as OnboardingState;
  await preferencesRepo.update(db, userId, { onboardingState: { ...current, ...patch } });
}

/** Step 1: locale, currency, timezone. */
export async function saveOnboardingLocaleAction(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const { user } = await requireUser();
  const parsed = onboardingLocaleSchema.safeParse({
    locale: formData.get("locale"),
    currency: formData.get("currency"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) return zodToErr(parsed.error);

  await preferencesRepo.update(getDb(), user.id, parsed.data);
  await mergeOnboardingState(user.id, { currentStep: 2 });
  redirect("/onboarding?step=2");
}

const incomePatternSchema = z.object({
  paydayDay: z.coerce
    .number()
    .int()
    .min(1)
    .max(28)
    .or(z.literal("last").transform(() => "last" as const)),
  weekendAdjust: z.boolean(),
});

/** Step 2: simple monthly payday pattern (powers payday cycles from Phase 5). */
export async function saveOnboardingIncomeAction(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const { user } = await requireUser();
  const parsed = incomePatternSchema.safeParse({
    paydayDay: formData.get("paydayDay"),
    weekendAdjust: formData.get("weekendAdjust") === "on",
  });
  if (!parsed.success) return zodToErr(parsed.error);

  await preferencesRepo.update(getDb(), user.id, {
    incomePattern: {
      frequency: "monthly",
      day: parsed.data.paydayDay,
      weekendAdjust: parsed.data.weekendAdjust,
    },
  });
  await mergeOnboardingState(user.id, { currentStep: 3 });
  redirect("/onboarding?step=3");
}

/** Steps 5 remains a structural placeholder until import lands — skipping is honest. */
export async function skipToOnboardingStepAction(formData: FormData): Promise<void> {
  const { user } = await requireUser();
  const step = Number(formData.get("step"));
  if (!Number.isInteger(step) || step < 1 || step > 5) {
    redirect("/onboarding");
  }
  await mergeOnboardingState(user.id, { currentStep: step });
  redirect(`/onboarding?step=${step}`);
}

/** Step 4: budget style + safety buffer. */
export async function saveOnboardingBufferAction(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const { user } = await requireUser();
  const parsed = onboardingBufferSchema.safeParse({
    budgetStyle: formData.get("budgetStyle"),
    safetyBuffer: formData.get("safetyBuffer") ?? "",
  });
  if (!parsed.success) return zodToErr(parsed.error);

  const bufferMinor =
    parsed.data.safetyBuffer === "" ? 0 : parseAmountToMinor(parsed.data.safetyBuffer);
  if (bufferMinor === null || bufferMinor < 0) {
    return err("invalid_input", "Please check the form.", {
      safetyBuffer: ["Enter an amount like 300 or RM 300.00."],
    });
  }

  await preferencesRepo.update(getDb(), user.id, {
    budgetStyle: parsed.data.budgetStyle,
    safetyBufferMinor: bufferMinor,
  });
  await mergeOnboardingState(user.id, { currentStep: 5 });
  redirect("/onboarding?step=5");
}

export async function completeOnboardingAction(): Promise<void> {
  const { user } = await requireUser();
  await mergeOnboardingState(user.id, { completed: true, currentStep: 5 });
  redirect("/overview");
}
