"use client";

import { useActionState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { changePasswordAction, type AuthFormState } from "@/features/auth/actions";
import { t } from "@/lib/i18n";

import {
  updateNotificationsAction,
  updatePreferencesAction,
  updatePrivacyAction,
  updateProfileAction,
  type SettingsFormState,
} from "./actions";

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

function StateBanner({ state }: { state: SettingsFormState | AuthFormState }) {
  if (!state) return null;
  if (state.ok) {
    return state.data.message ? <Banner variant="positive">{state.data.message}</Banner> : null;
  }
  return <Banner variant="risk">{state.error.message}</Banner>;
}

function errorsOf(state: SettingsFormState | AuthFormState): Record<string, string[]> {
  return state && !state.ok ? (state.error.fieldErrors ?? {}) : {};
}

export function ProfileForm({ displayName, email }: { displayName: string; email: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, null);
  const errors = errorsOf(state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <StateBanner state={state} />
      <FormField
        label={t("auth.email.label")}
        help="Email changes arrive with verified email (post-V1)."
      >
        <Input value={email} disabled />
      </FormField>
      <FormField label="Display name" errors={errors.displayName}>
        <Input name="displayName" defaultValue={displayName} autoComplete="name" />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? t("common.loading") : t("common.save")}
      </Button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  const errors = errorsOf(state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <StateBanner state={state} />
      <FormField label="Current password" errors={errors.currentPassword}>
        <PasswordInput name="currentPassword" autoComplete="current-password" required />
      </FormField>
      <FormField
        label={t("auth.password.new.label")}
        help={t("auth.password.requirements")}
        errors={errors.newPassword}
      >
        <PasswordInput name="newPassword" autoComplete="new-password" required />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? t("common.loading") : "Change password"}
      </Button>
      <p className="text-[13px] text-ink-muted">
        Changing your password signs out every other device.
      </p>
    </form>
  );
}

export function PreferencesForm({
  locale,
  currency,
  timezone,
  theme,
}: {
  locale: string;
  currency: string;
  timezone: string;
  theme: string;
}) {
  const [state, action, pending] = useActionState(updatePreferencesAction, null);
  const errors = errorsOf(state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <StateBanner state={state} />
      <FormField label="Language" help="ms-MY and zh-MY arrive post-V1." errors={errors.locale}>
        <Select name="locale" defaultValue={locale}>
          <option value="en-MY">English (Malaysia)</option>
        </Select>
      </FormField>
      <FormField
        label="Currency"
        help="Multi-currency conversion is a future feature."
        errors={errors.currency}
      >
        <Select name="currency" defaultValue={currency}>
          <option value="MYR">Malaysian Ringgit (RM)</option>
        </Select>
      </FormField>
      <FormField label="Timezone" errors={errors.timezone}>
        <Select name="timezone" defaultValue={timezone}>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t("theme.toggle")} errors={errors.theme}>
        <Select name="theme" defaultValue={theme}>
          <option value="system">{t("theme.system")}</option>
          <option value="light">{t("theme.light")}</option>
          <option value="dark">{t("theme.dark")}</option>
        </Select>
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? t("common.loading") : t("common.save")}
      </Button>
    </form>
  );
}

export function PrivacyForm({ privacyMode }: { privacyMode: boolean }) {
  const [state, action, pending] = useActionState(updatePrivacyAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <StateBanner state={state} />
      <div className="flex items-start justify-between gap-4 rounded-card border border-hairline bg-card p-4">
        <div>
          <div className="text-[15px] font-medium text-ink">Privacy Mode</div>
          <p className="mt-1 text-[13px] text-ink-secondary">
            When on, FinPilot never sends any of your data to a generative-AI provider. Every
            deterministic feature — dashboards, budgets, rules, trends, forecasts, reports — keeps
            working fully. (No AI features exist before Phase 8, so nothing is sent today either;
            this setting is honored from the first AI feature onward.)
          </p>
        </div>
        <Switch name="privacyMode" defaultChecked={privacyMode} aria-label="Privacy Mode" />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? t("common.loading") : t("common.save")}
      </Button>
    </form>
  );
}

export function NotificationsForm({
  digestFrequency,
  quietHoursStart,
  quietHoursEnd,
}: {
  digestFrequency: string;
  quietHoursStart: string;
  quietHoursEnd: string;
}) {
  const [state, action, pending] = useActionState(updateNotificationsAction, null);
  const errors = errorsOf(state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <StateBanner state={state} />
      <Banner variant="info">
        The notification centre arrives in Phase 6. Your preferences are saved now and honored from
        day one of alerts.
      </Banner>
      <FormField label="Digest frequency" errors={errors.digestFrequency}>
        <Select name="digestFrequency" defaultValue={digestFrequency}>
          <option value="off">Off</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </Select>
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Quiet hours start" errors={errors.quietHoursStart}>
          <Input name="quietHoursStart" type="time" defaultValue={quietHoursStart} />
        </FormField>
        <FormField label="Quiet hours end" errors={errors.quietHoursEnd}>
          <Input name="quietHoursEnd" type="time" defaultValue={quietHoursEnd} />
        </FormField>
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? t("common.loading") : t("common.save")}
      </Button>
    </form>
  );
}
