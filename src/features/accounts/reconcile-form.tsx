"use client";

import { useActionState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

import { recordReconciliationAction, type AccountFormState } from "./actions";

export function ReconcileForm({ accountId, today }: { accountId: string; today: string }) {
  const [state, formAction, pending] = useActionState<AccountFormState, FormData>(
    recordReconciliationAction,
    null,
  );
  const errors = state && !state.ok ? (state.error.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state?.ok ? <Banner variant="positive">{state.data.message}</Banner> : null}
      {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}
      <input type="hidden" name="accountId" value={accountId} />
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Statement balance" errors={errors.statementBalance}>
          <Input
            name="statementBalance"
            inputMode="decimal"
            className="num"
            placeholder="8,520.00"
          />
        </FormField>
        <FormField label="As of" errors={errors.asOf}>
          <Input name="asOf" type="date" defaultValue={today} />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-ink-secondary">
        <input
          type="checkbox"
          name="createAdjustment"
          defaultChecked
          className="h-4 w-4 accent-[var(--accent-primary)]"
        />
        Record an adjustment transaction for any discrepancy
      </label>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {pending ? "Reconciling…" : "Reconcile"}
      </Button>
    </form>
  );
}
