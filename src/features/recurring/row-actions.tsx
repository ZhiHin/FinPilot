"use client";

import { useActionState, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

import {
  acknowledgePriceChangeAction,
  confirmPatternAction,
  confirmUsageAction,
  rescanAction,
  setPatternStatusAction,
  setSubscriptionAction,
  updatePatternAction,
  type RecurringFormState,
} from "./actions";

function StateBanner({ state }: { state: RecurringFormState }) {
  if (!state) return null;
  if (state.ok)
    return state.data.message ? <Banner variant="positive">{state.data.message}</Banner> : null;
  return <Banner variant="risk">{state.error.message}</Banner>;
}

export function RescanButton() {
  const [state, formAction, pending] = useActionState<RecurringFormState, FormData>(
    rescanAction,
    null,
  );
  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? "Scanning…" : "Rescan transactions"}
        </Button>
      </form>
      <StateBanner state={state} />
    </div>
  );
}

/** Small single-purpose forms used inline on a pattern row. */
export function PatternQuickActions({
  patternId,
  status,
  source,
  hasSubscription,
}: {
  patternId: string;
  status: "active" | "paused" | "ended";
  source: "user_confirmed" | "inferred";
  hasSubscription: boolean;
}) {
  const [confirmState, confirmFormAction, confirmPending] = useActionState<
    RecurringFormState,
    FormData
  >(confirmPatternAction, null);
  const [statusState, statusFormAction, statusPending] = useActionState<
    RecurringFormState,
    FormData
  >(setPatternStatusAction, null);
  const [subState, subFormAction, subPending] = useActionState<RecurringFormState, FormData>(
    setSubscriptionAction,
    null,
  );
  const pending = confirmPending || statusPending || subPending;

  return (
    <div className="flex flex-col gap-1.5">
      <StateBanner state={confirmState} />
      <StateBanner state={statusState} />
      <StateBanner state={subState} />
      <div className="flex flex-wrap gap-1.5">
        {source === "inferred" && status !== "ended" ? (
          <form action={confirmFormAction}>
            <input type="hidden" name="patternId" value={patternId} />
            <Button type="submit" size="sm" disabled={pending}>
              Confirm
            </Button>
          </form>
        ) : null}
        {status === "active" ? (
          <form action={statusFormAction}>
            <input type="hidden" name="patternId" value={patternId} />
            <input type="hidden" name="status" value="paused" />
            <Button type="submit" variant="ghost" size="sm" disabled={pending}>
              Pause
            </Button>
          </form>
        ) : null}
        {status === "paused" ? (
          <form action={statusFormAction}>
            <input type="hidden" name="patternId" value={patternId} />
            <input type="hidden" name="status" value="active" />
            <Button type="submit" variant="ghost" size="sm" disabled={pending}>
              Resume
            </Button>
          </form>
        ) : null}
        {status !== "ended" ? (
          <form action={statusFormAction}>
            <input type="hidden" name="patternId" value={patternId} />
            <input type="hidden" name="status" value="ended" />
            <Button type="submit" variant="ghost" size="sm" disabled={pending}>
              Not recurring
            </Button>
          </form>
        ) : null}
        {status !== "ended" ? (
          <form action={subFormAction}>
            <input type="hidden" name="patternId" value={patternId} />
            <input type="hidden" name="isSubscription" value={hasSubscription ? "false" : "true"} />
            <Button type="submit" variant="ghost" size="sm" disabled={pending}>
              {hasSubscription ? "Not a sub" : "Mark as sub"}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export function SubscriptionEvidenceActions({
  subscriptionId,
  showAcknowledge,
}: {
  subscriptionId: string;
  showAcknowledge: boolean;
}) {
  const [ackState, ackFormAction, ackPending] = useActionState<RecurringFormState, FormData>(
    acknowledgePriceChangeAction,
    null,
  );
  const [usageState, usageFormAction, usagePending] = useActionState<RecurringFormState, FormData>(
    confirmUsageAction,
    null,
  );
  return (
    <div className="flex flex-col gap-1.5">
      <StateBanner state={ackState} />
      <StateBanner state={usageState} />
      <div className="flex flex-wrap gap-1.5">
        {showAcknowledge ? (
          <form action={ackFormAction}>
            <input type="hidden" name="subscriptionId" value={subscriptionId} />
            <Button type="submit" variant="secondary" size="sm" disabled={ackPending}>
              Acknowledge price change
            </Button>
          </form>
        ) : null}
        <form action={usageFormAction}>
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
          <Button type="submit" variant="ghost" size="sm" disabled={usagePending}>
            I still use this
          </Button>
        </form>
      </div>
    </div>
  );
}

export interface PatternFormValues {
  patternId: string;
  name: string;
  amount: string;
  tolerance: string;
  nextExpectedOn: string;
  isInstallment: boolean;
  installmentsTotal: string;
  installmentsObserved: number;
}

function PatternFormBody({ initial, close }: { initial: PatternFormValues; close: () => void }) {
  const [state, formAction, pending] = useActionState<RecurringFormState, FormData>(
    updatePatternAction,
    null,
  );
  const errors = state && !state.ok ? (state.error.fieldErrors ?? {}) : {};

  if (state?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <Banner variant="positive">{state.data.message}</Banner>
        <Button onClick={close} className="self-start">
          Done
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state && !state.ok && !state.error.fieldErrors ? (
        <Banner variant="risk">{state.error.message}</Banner>
      ) : null}
      <Banner variant="info">
        Editing confirms the pattern — your numbers replace the detector’s estimates.
      </Banner>
      <input type="hidden" name="patternId" value={initial.patternId} />
      <FormField label="Name" errors={errors.name}>
        <Input name="name" defaultValue={initial.name} required maxLength={80} />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Typical amount" errors={errors.amount}>
          <Input name="amount" inputMode="decimal" defaultValue={initial.amount} className="num" />
        </FormField>
        <FormField
          label="Tolerance (±)"
          help="How much the amount may vary and still count."
          errors={errors.tolerance}
        >
          <Input
            name="tolerance"
            inputMode="decimal"
            defaultValue={initial.tolerance}
            className="num"
          />
        </FormField>
      </div>
      <FormField label="Next expected on" errors={errors.nextExpectedOn}>
        <Input name="nextExpectedOn" type="date" defaultValue={initial.nextExpectedOn} required />
      </FormField>
      {initial.isInstallment ? (
        <FormField
          label="Total payments"
          help={`${initial.installmentsObserved} payment(s) observed so far. Leave empty if unknown — the total stays an estimate until you set it.`}
          errors={errors.installmentsTotal}
        >
          <Input
            name="installmentsTotal"
            inputMode="numeric"
            defaultValue={initial.installmentsTotal}
            className="num"
          />
        </FormField>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save pattern"}
      </Button>
    </form>
  );
}

export function PatternEditDialog({ initial }: { initial: PatternFormValues }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="mb-4 text-[19px] font-semibold text-ink">
            Edit {initial.name}
          </DialogTitle>
          <PatternFormBody initial={initial} close={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
