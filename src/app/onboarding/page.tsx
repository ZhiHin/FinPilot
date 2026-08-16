import type { Metadata } from "next";

import { OnboardingFlow } from "@/features/onboarding/flow";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";

export const metadata: Metadata = { title: t("onboarding.title") };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { user } = await requireUser();
  const prefs = await preferencesRepo.get(getDb(), user.id);
  const state = (prefs?.onboardingState ?? {}) as { currentStep?: number };

  const params = await searchParams;
  const requested = Number(params.step);
  // Save-and-resume: explicit ?step= wins, else the persisted position.
  const step =
    Number.isInteger(requested) && requested >= 1 && requested <= 5
      ? requested
      : Math.min(Math.max(state.currentStep ?? 1, 1), 5);

  return (
    <OnboardingFlow
      step={step}
      locale={prefs?.locale ?? "en-MY"}
      currency={(prefs?.currency ?? "MYR").trim()}
      timezone={prefs?.timezone ?? "Asia/Kuala_Lumpur"}
      budgetStyle={prefs?.budgetStyle ?? null}
      safetyBufferMinor={prefs?.safetyBufferMinor ?? 0}
    />
  );
}
