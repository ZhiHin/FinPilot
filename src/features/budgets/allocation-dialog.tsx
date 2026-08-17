"use client";

import { Plus } from "lucide-react";
import { useActionState, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { deleteAllocationAction, setAllocationAction, type BudgetFormState } from "./actions";

export interface CategoryOption {
  id: string;
  name: string;
  groupName: string;
}

export interface AllocationFormValues {
  categoryId: string;
  categoryName: string;
  planned: string;
  rolloverEnabled: boolean;
  notes: string;
  version: number;
  allocationId: string;
}

function AllocationFormBody({
  periodId,
  categories,
  initial,
  idempotencyId,
  close,
}: {
  periodId: string;
  categories: CategoryOption[];
  initial?: AllocationFormValues;
  idempotencyId: string;
  close: () => void;
}) {
  const [state, formAction, pending] = useActionState<BudgetFormState, FormData>(
    setAllocationAction,
    null,
  );
  const [deleteState, deleteAction, deletePending] = useActionState<BudgetFormState, FormData>(
    deleteAllocationAction,
    null,
  );
  const errors = state && !state.ok ? (state.error.fieldErrors ?? {}) : {};

  if (state?.ok || deleteState?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <Banner variant="positive">
          {(state?.ok && state.data.message) || (deleteState?.ok && deleteState.data.message)}
        </Banner>
        <Button onClick={close} className="self-start">
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        {state && !state.ok && !state.error.fieldErrors ? (
          <Banner variant="risk">{state.error.message}</Banner>
        ) : null}
        <input type="hidden" name="periodId" value={periodId} />
        {initial ? (
          <>
            <input type="hidden" name="categoryId" value={initial.categoryId} />
            <input type="hidden" name="expectedVersion" value={initial.version} />
          </>
        ) : (
          <input type="hidden" name="allocationId" value={idempotencyId} />
        )}
        {initial ? (
          <p className="text-[15px] font-medium text-ink">{initial.categoryName}</p>
        ) : (
          <FormField label="Category" errors={errors.categoryId}>
            <Select name="categoryId" defaultValue={categories[0]?.id}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} — {category.groupName}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField
          label="Planned amount"
          help="For this cycle, in the budget's currency."
          errors={errors.planned}
        >
          <Input
            name="planned"
            inputMode="decimal"
            defaultValue={initial?.planned ?? ""}
            required
            className="num"
          />
        </FormField>
        <label className="flex items-center gap-2 text-[13px] text-ink-secondary">
          <input
            type="checkbox"
            name="rolloverEnabled"
            defaultChecked={initial?.rolloverEnabled ?? false}
            className="h-4 w-4 accent-[var(--accent-primary)]"
          />
          Roll unspent money into the next cycle
        </label>
        <FormField label="Notes (optional)" errors={errors.notes}>
          <Input name="notes" defaultValue={initial?.notes ?? ""} maxLength={500} />
        </FormField>
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Saving…" : initial ? "Save allocation" : "Add allocation"}
        </Button>
      </form>
      {initial ? (
        <form action={deleteAction} className="border-t border-hairline pt-3">
          {deleteState && !deleteState.ok ? (
            <Banner variant="risk" className="mb-2">
              {deleteState.error.message}
            </Banner>
          ) : null}
          <input type="hidden" name="allocationId" value={initial.allocationId} />
          <Button type="submit" variant="ghost" size="sm" disabled={deletePending}>
            {deletePending ? "Removing…" : "Remove this allocation"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function AllocationDialog({
  periodId,
  categories,
  initial,
  idempotencyId,
  triggerLabel,
}: {
  periodId: string;
  categories: CategoryOption[];
  initial?: AllocationFormValues;
  /** Server-generated uuid so a double-submitted create stays a single row. */
  idempotencyId: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {initial ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {triggerLabel ?? "Edit"}
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden className="h-4 w-4" /> {triggerLabel ?? "Allocate category"}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle className="mb-4 text-[19px] font-semibold text-ink">
            {initial ? `Edit ${initial.categoryName}` : "Allocate a category"}
          </DialogTitle>
          <AllocationFormBody
            periodId={periodId}
            categories={categories}
            initial={initial}
            idempotencyId={idempotencyId}
            close={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
