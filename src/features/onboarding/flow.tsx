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

import { AmountText } from "@/components/ui/amount-text";
import { createAccountAction, type AccountFormState } from "@/features/accounts/actions";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS } from "@/features/accounts/schemas";

import {
  completeOnboardingAction,
  saveOnboardingBufferAction,
  saveOnboardingIncomeAction,
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

export interface OnboardingAccountSummary {
  id: string;
  name: string;
  type: string;
  currency: string;
  balanceMinor: number;
}

export function OnboardingFlow({
  step,
  locale,
  currency,
  timezone,
  budgetStyle,
  safetyBufferMinor,
  paydayDay,
  weekendAdjust,
  accounts,
  today,
}: {
  step: number;
  locale: string;
  currency: string;
  timezone: string;
  budgetStyle: string | null;
  safetyBufferMinor: number;
  paydayDay: number | "last" | null;
  weekendAdjust: boolean;
  accounts: OnboardingAccountSummary[];
  today: string;
}) {
  const [localeState, localeAction, localePending] = useActionState(
    saveOnboardingLocaleAction,
    null,
  );
  const [bufferState, bufferAction, bufferPending] = useActionState(
    saveOnboardingBufferAction,
    null,
  );
  const [incomeState, incomeAction, incomePending] = useActionState(
    saveOnboardingIncomeAction,
    null,
  );
  const [accountState, accountAction, accountPending] = useActionState<AccountFormState, FormData>(
    createAccountAction,
    null,
  );
  const localeErrors = errorsOf(localeState);
  const bufferErrors = errorsOf(bufferState);
  const incomeErrors = errorsOf(incomeState);
  const accountErrors =
    accountState && !accountState.ok ? (accountState.error.fieldErrors ?? {}) : {};

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
            {/* Skip lives outside this form — nested forms are dropped by browsers. */}
            <form action={incomeAction} className="flex flex-col gap-4" noValidate>
              <h1 className="text-[19px] font-semibold text-ink">When does money come in?</h1>
              <p className="text-[13px] text-ink-secondary">
                Your payday pattern powers safe-to-spend and payday-aware budget cycles from Phase 5
                onward. A simple monthly pattern is enough for now.
              </p>
              <FormField label="Payday (day of month)" errors={incomeErrors.paydayDay}>
                <Select
                  name="paydayDay"
                  defaultValue={paydayDay === null ? "25" : String(paydayDay)}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                  <option value="last">Last day of the month</option>
                </Select>
              </FormField>
              <label className="flex items-center gap-2 text-[13px] text-ink-secondary">
                <input
                  type="checkbox"
                  name="weekendAdjust"
                  defaultChecked={weekendAdjust}
                  className="h-4 w-4 accent-[var(--accent-primary)]"
                />
                Salary moves earlier when payday lands on a weekend
              </label>
              <Button type="submit" disabled={incomePending} className="self-end">
                {incomePending ? t("common.loading") : t("common.continue")}
              </Button>
            </form>
            <div className="flex items-center justify-between gap-2">
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
              position. Add the ones you use — more can come later from the Accounts screen.
            </p>
            {accounts.length > 0 ? (
              <ul className="flex flex-col gap-1 rounded-card border border-hairline bg-page p-3">
                {accounts.map((account) => (
                  <li key={account.id} className="flex items-center justify-between text-[13px]">
                    <span className="text-ink">{account.name}</span>
                    <AmountText amountMinor={account.balanceMinor} currency={account.currency} />
                  </li>
                ))}
              </ul>
            ) : null}
            {accountState?.ok ? (
              <Banner variant="positive">{accountState.data.message}</Banner>
            ) : null}
            {accountState && !accountState.ok && !accountState.error.fieldErrors ? (
              <Banner variant="risk">{accountState.error.message}</Banner>
            ) : null}
            <form
              action={accountAction}
              className="flex flex-col gap-3 rounded-card border border-hairline p-3"
              noValidate
            >
              <input type="hidden" name="currency" value="MYR" />
              <input type="hidden" name="openingBalanceDate" value={today} />
              <input type="hidden" name="includeInNetWorth" value="on" />
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Account name" errors={accountErrors.name}>
                  <Input name="name" placeholder="e.g. Maybank" maxLength={80} required />
                </FormField>
                <FormField label="Type" errors={accountErrors.type}>
                  <Select name="type" defaultValue="current">
                    {ACCOUNT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {ACCOUNT_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <FormField
                label="Balance today (RM)"
                help="Liabilities can start negative, e.g. -1,200"
                errors={accountErrors.openingBalance}
              >
                <Input name="openingBalance" inputMode="decimal" defaultValue="0" className="num" />
              </FormField>
              <Button
                type="submit"
                variant="secondary"
                disabled={accountPending}
                className="self-start"
              >
                {accountPending ? t("common.loading") : "Add this account"}
              </Button>
            </form>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button asChild variant="ghost">
                <Link href="/onboarding?step=2">{t("common.back")}</Link>
              </Button>
              <SkipButton
                toStep={4}
                label={accounts.length > 0 ? t("common.continue") : t("common.skipForNow")}
              />
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
