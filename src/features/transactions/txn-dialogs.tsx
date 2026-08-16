"use client";

import { ArrowLeftRight, Plus } from "lucide-react";
import { useActionState, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { createTransactionAction, createTransferAction, type TxnFormState } from "./actions";
import { MANUAL_TXN_TYPES, TXN_TYPE_LABELS } from "./schemas";

export interface AccountOption {
  id: string;
  name: string;
  currency: string;
}

export interface CategoryOption {
  id: string;
  name: string;
  groupName: string;
  kind: "income" | "expense";
}

export interface TagOption {
  id: string;
  name: string;
}

export function CategorySelect({
  categories,
  name,
  defaultValue,
  includeEmpty = true,
  ...rest
}: {
  categories: CategoryOption[];
  name: string;
  defaultValue?: string;
  includeEmpty?: boolean;
} & Omit<React.ComponentProps<"select">, "name" | "defaultValue" | "children">) {
  const groups = new Map<string, CategoryOption[]>();
  for (const category of categories) {
    const bucket = groups.get(category.groupName) ?? [];
    bucket.push(category);
    groups.set(category.groupName, bucket);
  }
  return (
    <Select name={name} defaultValue={defaultValue ?? ""} {...rest}>
      {includeEmpty ? <option value="">Uncategorised</option> : null}
      {[...groups.entries()].map(([groupName, items]) => (
        <optgroup key={groupName} label={groupName}>
          {items.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** Bodies mount only while their dialog is open, so form state resets per open. */
function AddTransactionBody({
  accounts,
  categories,
  tags,
  today,
  close,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  tags: TagOption[];
  today: string;
  close: () => void;
}) {
  const [state, formAction, pending] = useActionState<TxnFormState, FormData>(
    createTransactionAction,
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
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Type" errors={errors.type}>
          <Select name="type" defaultValue="expense">
            {MANUAL_TXN_TYPES.map((type) => (
              <option key={type} value={type}>
                {TXN_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Account" errors={errors.accountId}>
          <Select name="accountId" defaultValue={accounts[0]?.id}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Amount"
          help="Just the amount — the type decides the direction."
          errors={errors.amount}
        >
          <Input name="amount" inputMode="decimal" className="num" placeholder="32.50" required />
        </FormField>
        <FormField label="Date" errors={errors.txnDate}>
          <Input name="txnDate" type="date" defaultValue={today} />
        </FormField>
      </div>
      <FormField label="Merchant (optional)" errors={errors.merchantName}>
        <Input name="merchantName" placeholder="e.g. GrabFood" maxLength={120} />
      </FormField>
      <FormField label="Description (optional)" errors={errors.description}>
        <Input name="description" maxLength={200} />
      </FormField>
      <FormField label="Category" errors={errors.categoryId}>
        <CategorySelect categories={categories} name="categoryId" />
      </FormField>
      {tags.length > 0 ? (
        <fieldset className="flex flex-wrap gap-3 text-[13px] text-ink-secondary">
          <legend className="mb-1 text-[13px] font-medium text-ink-secondary">Tags</legend>
          {tags.map((tag) => (
            <label key={tag.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="tagIds"
                value={tag.id}
                className="h-4 w-4 accent-[var(--accent-primary)]"
              />
              {tag.name}
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="flex flex-wrap gap-4 text-[13px] text-ink-secondary">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="status"
            value="posted"
            defaultChecked
            className="accent-[var(--accent-primary)]"
          />{" "}
          Posted
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="status"
            value="pending"
            className="accent-[var(--accent-primary)]"
          />{" "}
          Pending
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            name="needsReview"
            className="h-4 w-4 accent-[var(--accent-primary)]"
          />{" "}
          Needs review
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            name="isExcluded"
            className="h-4 w-4 accent-[var(--accent-primary)]"
          />{" "}
          Exclude from reports
        </label>
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Adding…" : "Add transaction"}
      </Button>
    </form>
  );
}

export function AddTransactionDialog({
  accounts,
  categories,
  tags,
  today,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  tags: TagOption[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden className="h-4 w-4" /> Add
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle className="mb-4 text-[19px] font-semibold text-ink">
            Add transaction
          </DialogTitle>
          <AddTransactionBody
            accounts={accounts}
            categories={categories}
            tags={tags}
            today={today}
            close={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function TransferBody({
  accounts,
  today,
  close,
}: {
  accounts: AccountOption[];
  today: string;
  close: () => void;
}) {
  const [state, formAction, pending] = useActionState<TxnFormState, FormData>(
    createTransferAction,
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
        Transfers are linked double entries — they never count as income or spending.
      </Banner>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="From" errors={errors.fromAccountId}>
          <Select name="fromAccountId" defaultValue={accounts[0]?.id}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="To" errors={errors.toAccountId}>
          <Select name="toAccountId" defaultValue={accounts[1]?.id ?? accounts[0]?.id}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Amount" errors={errors.amount}>
          <Input name="amount" inputMode="decimal" className="num" placeholder="100.00" required />
        </FormField>
        <FormField label="Date" errors={errors.txnDate}>
          <Input name="txnDate" type="date" defaultValue={today} />
        </FormField>
      </div>
      <FormField label="Notes (optional)" errors={errors.notes}>
        <Input name="notes" maxLength={500} />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Recording…" : "Record transfer"}
      </Button>
    </form>
  );
}

export function TransferDialog({ accounts, today }: { accounts: AccountOption[]; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <ArrowLeftRight aria-hidden className="h-4 w-4" /> Transfer
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="mb-4 text-[19px] font-semibold text-ink">
            Transfer between accounts
          </DialogTitle>
          <TransferBody accounts={accounts} today={today} close={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
