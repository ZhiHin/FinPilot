"use client";

import { useActionState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { t } from "@/lib/i18n";

import {
  requestResetAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
  type AuthFormState,
} from "./actions";

function ErrorBanner({ state }: { state: AuthFormState }) {
  if (!state || state.ok) return null;
  return <Banner variant="risk">{state.error.message}</Banner>;
}

function fieldErrors(state: AuthFormState): Record<string, string[]> {
  return state && !state.ok ? (state.error.fieldErrors ?? {}) : {};
}

export function SignInForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signInAction, null);
  const errors = fieldErrors(state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {notice ? <Banner variant="positive">{notice}</Banner> : null}
      <ErrorBanner state={state} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormField label={t("auth.email.label")} errors={errors.email}>
        <Input name="email" type="email" autoComplete="email" required />
      </FormField>
      <FormField label={t("auth.password.label")} errors={errors.password}>
        <PasswordInput name="password" autoComplete="current-password" required />
      </FormField>
      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? t("common.loading") : t("auth.signIn.submit")}
      </Button>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, null);
  const errors = fieldErrors(state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <ErrorBanner state={state} />
      <FormField label="Name (optional)" errors={errors.displayName}>
        <Input name="displayName" autoComplete="name" />
      </FormField>
      <FormField label={t("auth.email.label")} errors={errors.email}>
        <Input name="email" type="email" autoComplete="email" required />
      </FormField>
      <FormField
        label={t("auth.password.label")}
        help={t("auth.password.requirements")}
        errors={errors.password}
      >
        <PasswordInput name="password" autoComplete="new-password" required />
      </FormField>
      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? t("common.loading") : t("auth.signUp.submit")}
      </Button>
    </form>
  );
}

export function RequestResetForm() {
  const [state, action, pending] = useActionState(requestResetAction, null);
  const errors = fieldErrors(state);
  if (state?.ok) {
    return <Banner variant="positive">{state.data.message}</Banner>;
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <ErrorBanner state={state} />
      <FormField label={t("auth.email.label")} errors={errors.email}>
        <Input name="email" type="email" autoComplete="email" required />
      </FormField>
      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? t("common.loading") : t("auth.reset.request.submit")}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  const errors = fieldErrors(state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <ErrorBanner state={state} />
      <input type="hidden" name="token" value={token} />
      <FormField
        label={t("auth.password.new.label")}
        help={t("auth.password.requirements")}
        errors={errors.password}
      >
        <PasswordInput name="password" autoComplete="new-password" required />
      </FormField>
      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? t("common.loading") : t("auth.reset.set.submit")}
      </Button>
    </form>
  );
}
