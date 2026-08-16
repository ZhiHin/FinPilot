"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatMinor } from "@/lib/money";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";

import {
  completeOnboardingAction,
  saveOnboardingBufferAction,
  saveOnboardingLocaleAction,
  skipToOnboardingStepAction,
  type OnboardingFormState,
} from "./actions";

const STEPS = ["Locale", "Income", "Accounts", "Buffer", "Finish"];

const TIMEZONES = [
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Asia/Manila",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Australia/Perth",
  "Europe/London",
  "UTC",
];

function Progress({ step }: { step: number }) {
  return (
    <ol aria-label={`Step ${step} of 5`} className="mb-6 flex items-center justify-center gap-2">
      {STEPS.map((label, index) => {
        const n = index + 1;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={n === step ? "step" : undefined}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-chip text-[11.5px] font-semibold",
                n === step
                  ? "bg-accent text-on-accent"
                  : n < step
                    ? "bg-accent-soft text-accent"
                    : "bg-sunken text-ink-muted",
              )}
            >
              {n}
            </span>
            <span className="hidden text-[11.5px] text-ink-muted sm:inline">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function SkipButton({ toStep, label }: { toStep: number; label: string }) {
  return (
    <form action={skipToOnboardingStepAction}>
      <input type="hidden" name="step" value={toStep} />
      <Button type="submit" variant="ghost">
        {label}
      </Button>
    </form>
  );
}

function errorsOf(state: OnboardingFormState): Record<string, string[]> {
  return state && !state.ok ? (state.error.fieldErrors ?? {}) : {};
}

export function OnboardingFlow({
  step,
  locale,
  currency,
  timezone,
  budgetStyle,
  safetyBufferMinor,
}: {
  step: number;
  locale: string;
  currency: string;
  timezone: string;
  budgetStyle: string | null;
  safetyBufferMinor: number;
}) {
  const [localeState, localeAction, localePending] = useActionState(
    saveOnboardingLocaleAction,
    null,
  );
  const [bufferState, bufferAction, bufferPending] = useActionState(
    saveOnboardingBufferAction,
    null,
  );
  const localeErrors = errorsOf(localeState);
  const bufferErrors = errorsOf(bufferState);

  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <Progress step={step} />

        {step === 1 ? (
          <form action={localeAction} className="flex flex-col gap-4" noValidate>
            <h1 className="text-[19px] font-semibold text-ink">{t("onboarding.step1.title")}</h1>
            <p className="text-[13px] text-ink-secondary">{t("onboarding.step1.why")}</p>
            <FormField label="Language" errors={localeErrors.locale}>
              <Select name="locale" defaultValue={locale}>
                <option value="en-MY">English (Malaysia)</option>
              </Select>
            </FormField>
            <FormField label="Currency" errors={localeErrors.currency}>
              <Select name="currency" defaultValue={currency}>
                <option value="MYR">Malaysian Ringgit (RM)</option>
              </Select>
            </FormField>
            <FormField label="Timezone" errors={localeErrors.timezone}>
              <Select name="timezone" defaultValue={timezone}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button type="submit" disabled={localePending}>
                {localePending ? t("common.loading") : t("common.continue")}
              </Button>
            </div>
          </form>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-4">
            <h1 className="text-[19px] font-semibold text-ink">When does money come in?</h1>
            <p className="text-[13px] text-ink-secondary">
              Your payday pattern powers safe-to-spend and payday-aware budget cycles.
            </p>
            <Banner variant="info">
              Income patterns are captured with accounts in Phase 2 — this step activates then. You
              can skip it now and nothing is lost.
            </Banner>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button asChild variant="ghost">
                <Link href="/onboarding?step=1">{t("common.back")}</Link>
              </Button>
              <SkipButton toStep={3} label={t("common.skipForNow")} />
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-4">
            <h1 className="text-[19px] font-semibold text-ink">Your accounts</h1>
            <p className="text-[13px] text-ink-secondary">
              Bank accounts, e-wallets, cards, and opening balances give FinPilot your real
              position.
            </p>
            <Banner variant="info">
              Manual accounts arrive in Phase 2 (and statement import in Phase 3). This step
              activates then.
            </Banner>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button asChild variant="ghost">
                <Link href="/onboarding?step=2">{t("common.back")}</Link>
              </Button>
              <SkipButton toStep={4} label={t("common.skipForNow")} />
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <form action={bufferAction} className="flex flex-col gap-4" noValidate>
            <h1 className="text-[19px] font-semibold text-ink">{t("onboarding.step4.title")}</h1>
            <p className="text-[13px] text-ink-secondary">{t("onboarding.step4.why")}</p>
            <FormField label="Budget style" errors={bufferErrors.budgetStyle}>
              <Select name="budgetStyle" defaultValue={budgetStyle ?? "flexible"}>
                <option value="flexible">Flexible — guidelines, not hard limits</option>
                <option value="fixed">Fixed — firm category limits</option>
                <option value="rollover">Rollover — unused amounts carry over</option>
                <option value="zero_based">Zero-based — every ringgit gets a job</option>
              </Select>
            </FormField>
            <FormField
              label="Safety buffer (RM)"
              help="FinPilot never counts this amount as spendable."
              errors={bufferErrors.safetyBuffer}
            >
              <Input
                name="safetyBuffer"
                inputMode="decimal"
                defaultValue={safetyBufferMinor > 0 ? String(safetyBufferMinor / 100) : "300"}
                className="num"
              />
            </FormField>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button asChild variant="ghost">
                <Link href="/onboarding?step=3">{t("common.back")}</Link>
              </Button>
              <Button type="submit" disabled={bufferPending}>
                {bufferPending ? t("common.loading") : t("common.continue")}
              </Button>
            </div>
          </form>
        ) : null}

        {step === 5 ? (
          <div className="flex flex-col gap-4">
            <h1 className="text-[19px] font-semibold text-ink">{t("onboarding.summary.title")}</h1>
            <ul className="flex flex-col gap-2 rounded-card border border-hairline bg-page p-4 text-[13px] text-ink-secondary">
              <li>
                <strong className="text-ink">Locale:</strong> {locale} · {currency} · {timezone}
              </li>
              <li>
                <strong className="text-ink">Budget style:</strong>{" "}
                <span className="capitalize">{budgetStyle ?? "flexible (default)"}</span>
              </li>
              <li>
                <strong className="text-ink">Safety buffer:</strong>{" "}
                <span className="num">{formatMinor(safetyBufferMinor, currency)}</span>
              </li>
            </ul>
            <Banner variant="info">
              Statement import opens in Phase 3; the demo dataset arrives with Phases 2–3. You can
              start using FinPilot now — settings can change anything later.
            </Banner>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button asChild variant="ghost">
                <Link href="/onboarding?step=4">{t("common.back")}</Link>
              </Button>
              <form action={completeOnboardingAction}>
                <Button type="submit">Finish setup</Button>
              </form>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
