import type { Metadata } from "next";

import { OnboardingFlow, type OnboardingAccountSummary } from "@/features/onboarding/flow";
import { localDateInTz } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { accountsService } from "@/server/services/accounts";

export const metadata: Metadata = { title: t("onboarding.title") };

interface IncomePattern {
  day?: number | "last";
  weekendAdjust?: boolean;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { user } = await requireUser();
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const state = (prefs?.onboardingState ?? {}) as { currentStep?: number };
  const income = (prefs?.incomePattern ?? {}) as IncomePattern;
  const timezone = prefs?.timezone ?? "Asia/Kuala_Lumpur";

  const params = await searchParams;
  const requested = Number(params.step);
  // Save-and-resume: explicit ?step= wins, else the persisted position.
  const step =
    Number.isInteger(requested) && requested >= 1 && requested <= 5
      ? requested
      : Math.min(Math.max(state.currentStep ?? 1, 1), 5);

  const accounts: OnboardingAccountSummary[] = (await accountsService.list(db, user.id)).map(
    (account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency.trim(),
      balanceMinor: account.balanceMinor,
    }),
  );

  return (
    <OnboardingFlow
      step={step}
      locale={prefs?.locale ?? "en-MY"}
      currency={(prefs?.currency ?? "MYR").trim()}
      timezone={timezone}
      budgetStyle={prefs?.budgetStyle ?? null}
      safetyBufferMinor={prefs?.safetyBufferMinor ?? 0}
      paydayDay={income.day ?? null}
      weekendAdjust={income.weekendAdjust ?? true}
      accounts={accounts}
      today={localDateInTz(new Date(), timezone)}
    />
  );
}
