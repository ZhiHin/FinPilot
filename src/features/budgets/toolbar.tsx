"use client";

import { useActionState, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

import {
  archiveBudgetAction,
  copyPreviousPeriodAction,
  updatePeriodMetaAction,
  type BudgetFormState,
} from "./actions";

function StateBanner({ state }: { state: BudgetFormState }) {
  if (!state) return null;
  if (state.ok)
    return state.data.message ? <Banner variant="positive">{state.data.message}</Banner> : null;
  return <Banner variant="risk">{state.error.message}</Banner>;
}

export function CopyPreviousForm({ periodId }: { periodId: string }) {
  const [state, formAction, pending] = useActionState<BudgetFormState, FormData>(
    copyPreviousPeriodAction,
    null,
  );
  return (
    <div className="flex flex-col gap-2">
      <StateBanner state={state} />
      <form action={formAction}>
        <input type="hidden" name="periodId" value={periodId} />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? "Copying…" : "Copy previous period"}
        </Button>
      </form>
    </div>
  );
}

function PeriodMetaBody({
  periodId,
  initialNotes,
  initialExpectedIncome,
  zeroBased,
  close,
}: {
  periodId: string;
  initialNotes: string;
  initialExpectedIncome: string;
  zeroBased: boolean;
  close: () => void;
}) {
  const [state, formAction, pending] = useActionState<BudgetFormState, FormData>(
    updatePeriodMetaAction,
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
      <input type="hidden" name="periodId" value={periodId} />
      {zeroBased ? (
        <FormField
          label="Expected income this cycle"
          help="Zero-based budgets plan against this figure."
          errors={errors.expectedIncome}
        >
          <Input
            name="expectedIncome"
            inputMode="decimal"
            defaultValue={initialExpectedIncome}
            className="num"
          />
        </FormField>
      ) : null}
      <FormField label="Notes for this period" errors={errors.notes}>
        <Input name="notes" defaultValue={initialNotes} maxLength={1000} />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function PeriodMetaDialog({
  periodId,
  initialNotes,
  initialExpectedIncome,
  zeroBased,
}: {
  periodId: string;
  initialNotes: string;
  initialExpectedIncome: string;
  zeroBased: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {zeroBased ? "Income & notes" : "Period notes"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="mb-4 text-[19px] font-semibold text-ink">
            Period details
          </DialogTitle>
          <PeriodMetaBody
            periodId={periodId}
            initialNotes={initialNotes}
            initialExpectedIncome={initialExpectedIncome}
            zeroBased={zeroBased}
            close={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ArchiveBudgetDialog({ budgetId, name }: { budgetId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<BudgetFormState, FormData>(
    archiveBudgetAction,
    null,
  );
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Archive budget
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="mb-4 text-[19px] font-semibold text-ink">
            Archive “{name}”?
          </DialogTitle>
          {state?.ok ? (
            <div className="flex flex-col gap-4">
              <Banner variant="positive">{state.data.message}</Banner>
              <Button onClick={() => setOpen(false)} className="self-start">
                Done
              </Button>
            </div>
          ) : (
            <form action={formAction} className="flex flex-col gap-4">
              {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}
              <p className="text-[13px] text-ink-secondary">
                Archiving stops new cycles. Every past period and allocation stays readable —
                nothing is deleted.
              </p>
              <input type="hidden" name="budgetId" value={budgetId} />
              <div className="flex gap-2">
                <Button type="submit" variant="secondary" disabled={pending}>
                  {pending ? "Archiving…" : "Archive"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Keep it
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
