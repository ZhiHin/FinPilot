"use client";

import { Plus } from "lucide-react";
import { useActionState, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { createAccountAction, updateAccountAction, type AccountFormState } from "./actions";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, CURRENCIES } from "./schemas";

export interface AccountFormValues {
  accountId?: string;
  version?: number;
  name?: string;
  type?: string;
  currency?: string;
  openingBalance?: string;
  openingBalanceDate?: string;
  creditLimit?: string;
  includeInNetWorth?: boolean;
}

/**
 * The form body mounts only while the dialog is open, so useActionState resets
 * on every open (a previous success can't leak into a fresh form).
 */
function AccountFormBody({
  mode,
  today,
  initial,
  close,
}: {
  mode: "create" | "edit";
  today: string;
  initial?: AccountFormValues;
  close: () => void;
}) {
  const action = mode === "create" ? createAccountAction : updateAccountAction;
  const [state, formAction, pending] = useActionState<AccountFormState, FormData>(action, null);
  const errors = state && !state.ok ? (state.error.fieldErrors ?? {}) : {};
  const [type, setType] = useState(initial?.type ?? "current");

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
      {mode === "edit" ? (
        <>
          <input type="hidden" name="accountId" value={initial?.accountId} />
          <input type="hidden" name="version" value={initial?.version} />
          <input type="hidden" name="type" value={initial?.type} />
          <input type="hidden" name="currency" value={initial?.currency} />
        </>
      ) : null}
      <FormField label="Name" errors={errors.name}>
        <Input name="name" defaultValue={initial?.name} required maxLength={80} />
      </FormField>
      {mode === "create" ? (
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Type" errors={errors.type}>
            <Select name="type" value={type} onChange={(e) => setType(e.target.value)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Currency"
            help="Currencies are never converted or mixed."
            errors={errors.currency}
          >
            <Select name="currency" defaultValue={initial?.currency ?? "MYR"}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Opening balance"
          help="Liabilities can start negative, e.g. -1,200.00"
          errors={errors.openingBalance}
        >
          <Input
            name="openingBalance"
            inputMode="decimal"
            defaultValue={initial?.openingBalance ?? "0"}
            className="num"
          />
        </FormField>
        <FormField label="As of" errors={errors.openingBalanceDate}>
          <Input
            name="openingBalanceDate"
            type="date"
            defaultValue={initial?.openingBalanceDate ?? today}
          />
        </FormField>
      </div>
      {type === "credit_card" ? (
        <FormField label="Credit limit (optional)" errors={errors.creditLimit}>
          <Input
            name="creditLimit"
            inputMode="decimal"
            defaultValue={initial?.creditLimit ?? ""}
            className="num"
          />
        </FormField>
      ) : null}
      <label className="flex items-center gap-2 text-[13px] text-ink-secondary">
        <input
          type="checkbox"
          name="includeInNetWorth"
          defaultChecked={initial?.includeInNetWorth ?? true}
          className="h-4 w-4 accent-[var(--accent-primary)]"
        />
        Count this account in net worth
      </label>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : mode === "create" ? "Add account" : "Save changes"}
      </Button>
    </form>
  );
}

export function AccountFormDialog({
  mode,
  today,
  initial,
}: {
  mode: "create" | "edit";
  today: string;
  initial?: AccountFormValues;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* The dialog owns its trigger: slotting server-rendered elements into
          Radix asChild breaks on RSC re-renders. */}
      {mode === "create" ? (
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden className="h-4 w-4" /> Add account
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Edit
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="mb-4 text-[19px] font-semibold text-ink">
            {mode === "create" ? "Add account" : "Edit account"}
          </DialogTitle>
          <AccountFormBody
            mode={mode}
            today={today}
            initial={initial}
            close={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
