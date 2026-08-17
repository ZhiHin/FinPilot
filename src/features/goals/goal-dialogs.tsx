"use client";

import { Plus } from "lucide-react";
import { useActionState, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import {
  addContributionAction,
  createGoalAction,
  setGoalStatusAction,
  updateGoalAction,
  type GoalFormState,
} from "./actions";

const GOAL_TYPE_OPTIONS = [
  ["emergency", "Emergency fund"],
  ["purchase", "Purchase"],
  ["travel", "Travel"],
  ["education", "Education"],
  ["debt_payoff", "Debt payoff"],
  ["custom", "Custom"],
] as const;

export interface GoalFormValues {
  goalId?: string;
  name?: string;
  type?: string;
  target?: string;
  currency?: string;
  targetDate?: string;
  priority?: number;
  linkedAccountId?: string;
  plannedContribution?: string;
}

export interface AccountOption {
  id: string;
  name: string;
  currency: string;
}

function GoalFormBody({
  mode,
  accounts,
  initial,
  close,
}: {
  mode: "create" | "edit";
  accounts: AccountOption[];
  initial?: GoalFormValues;
  close: () => void;
}) {
  const action = mode === "create" ? createGoalAction : updateGoalAction;
  const [state, formAction, pending] = useActionState<GoalFormState, FormData>(action, null);
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
      {mode === "edit" ? <input type="hidden" name="goalId" value={initial?.goalId} /> : null}
      <FormField label="Name" errors={errors.name}>
        <Input name="name" defaultValue={initial?.name} required maxLength={80} />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Type">
          <Select name="type" defaultValue={initial?.type ?? "emergency"}>
            {GOAL_TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Priority" help="1 sits at the top of your list." errors={errors.priority}>
          <Select name="priority" defaultValue={String(initial?.priority ?? 3)}>
            {["1", "2", "3", "4", "5"].map((p) => (
              <option key={p} value={p}>
                {p}
                {p === "1" ? " (highest)" : p === "5" ? " (lowest)" : ""}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Target amount" errors={errors.target}>
          <Input
            name="target"
            inputMode="decimal"
            defaultValue={initial?.target ?? ""}
            required
            className="num"
          />
        </FormField>
        {mode === "create" ? (
          <FormField
            label="Currency"
            help="Goals track one currency; nothing is converted."
            errors={errors.currency}
          >
            <Select name="currency" defaultValue={initial?.currency ?? "MYR"}>
              {["MYR", "SGD", "USD", "EUR"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FormField>
        ) : (
          <input type="hidden" name="currency" value={initial?.currency ?? "MYR"} />
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Target date (optional)" errors={errors.targetDate}>
          <Input name="targetDate" type="date" defaultValue={initial?.targetDate ?? ""} />
        </FormField>
        <FormField
          label="Planned monthly contribution (optional)"
          help="Used for the completion estimate."
          errors={errors.plannedContribution}
        >
          <Input
            name="plannedContribution"
            inputMode="decimal"
            defaultValue={initial?.plannedContribution ?? ""}
            className="num"
          />
        </FormField>
      </div>
      {accounts.length > 0 ? (
        <FormField
          label="Linked account (optional)"
          help="A reference only — linking never moves money."
        >
          <Select name="linkedAccountId" defaultValue={initial?.linkedAccountId ?? ""}>
            <option value="">No linked account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : mode === "create" ? "Create goal" : "Save changes"}
      </Button>
    </form>
  );
}

export function GoalFormDialog({
  mode,
  accounts,
  initial,
}: {
  mode: "create" | "edit";
  accounts: AccountOption[];
  initial?: GoalFormValues;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {mode === "create" ? (
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden className="h-4 w-4" /> New goal
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Edit goal
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="mb-4 text-[19px] font-semibold text-ink">
            {mode === "create" ? "New savings goal" : "Edit goal"}
          </DialogTitle>
          <GoalFormBody
            mode={mode}
            accounts={accounts}
            initial={initial}
            close={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ContributionFormBody({
  goalId,
  today,
  idempotencyId,
  close,
}: {
  goalId: string;
  today: string;
  idempotencyId: string;
  close: () => void;
}) {
  const [state, formAction, pending] = useActionState<GoalFormState, FormData>(
    addContributionAction,
    null,
  );
  const [direction, setDirection] = useState<"contribution" | "withdrawal">("contribution");
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
      <Banner variant="info">
        This records progress toward your goal only — it does <strong>not</strong> move money,
        create a transaction, or change any account balance.
      </Banner>
      {state && !state.ok && !state.error.fieldErrors ? (
        <Banner variant="risk">{state.error.message}</Banner>
      ) : null}
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="idempotencyId" value={idempotencyId} />
      <fieldset className="flex gap-4 text-[13px] text-ink-secondary">
        <legend className="sr-only">Entry kind</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="direction"
            value="contribution"
            checked={direction === "contribution"}
            onChange={() => setDirection("contribution")}
            className="h-4 w-4 accent-[var(--accent-primary)]"
          />
          Contribution
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="direction"
            value="withdrawal"
            checked={direction === "withdrawal"}
            onChange={() => setDirection("withdrawal")}
            className="h-4 w-4 accent-[var(--accent-primary)]"
          />
          Withdrawal / correction
        </label>
      </fieldset>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Amount" errors={errors.amount}>
          <Input name="amount" inputMode="decimal" required className="num" />
        </FormField>
        <FormField label="Date" errors={errors.contributedOn}>
          <Input name="contributedOn" type="date" defaultValue={today} required />
        </FormField>
      </div>
      <FormField
        label={direction === "withdrawal" ? "Reason (required)" : "Note (optional)"}
        help={
          direction === "withdrawal"
            ? "Withdrawals stay in the history as auditable entries."
            : undefined
        }
        errors={errors.note}
      >
        <Input name="note" maxLength={300} required={direction === "withdrawal"} />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        {pending
          ? "Recording…"
          : direction === "withdrawal"
            ? "Record withdrawal"
            : "Record contribution"}
      </Button>
    </form>
  );
}

export function ContributionDialog({
  goalId,
  today,
  idempotencyId,
}: {
  goalId: string;
  today: string;
  /** Server-generated uuid: double-submits collapse into one entry. */
  idempotencyId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden className="h-4 w-4" /> Add contribution
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="mb-4 text-[19px] font-semibold text-ink">
            Record progress
          </DialogTitle>
          <ContributionFormBody
            goalId={goalId}
            today={today}
            idempotencyId={idempotencyId}
            close={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function GoalStatusButtons({
  goalId,
  status,
}: {
  goalId: string;
  status: "active" | "paused" | "completed" | "archived";
}) {
  const [state, formAction, pending] = useActionState<GoalFormState, FormData>(
    setGoalStatusAction,
    null,
  );
  const transitions: Array<{ to: string; label: string }> =
    status === "active"
      ? [
          { to: "paused", label: "Pause" },
          { to: "completed", label: "Mark completed" },
          { to: "archived", label: "Archive" },
        ]
      : status === "paused"
        ? [
            { to: "active", label: "Resume" },
            { to: "archived", label: "Archive" },
          ]
        : status === "completed"
          ? [{ to: "archived", label: "Archive" }]
          : [{ to: "active", label: "Reactivate" }];
  return (
    <div className="flex flex-col gap-2">
      {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}
      {state?.ok && state.data.message ? (
        <Banner variant="positive">{state.data.message}</Banner>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {transitions.map((transition) => (
          <form key={transition.to} action={formAction}>
            <input type="hidden" name="goalId" value={goalId} />
            <input type="hidden" name="status" value={transition.to} />
            <Button type="submit" variant="ghost" size="sm" disabled={pending}>
              {transition.label}
            </Button>
          </form>
        ))}
      </div>
    </div>
  );
}
