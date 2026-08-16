"use client";

import { Plus, Trash2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";

import { AmountText } from "@/components/ui/amount-text";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle, DrawerContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { minorToAmountInput } from "@/lib/money";

import {
  deleteTransactionAction,
  linkRefundAction,
  markDuplicateAction,
  removeLinkAction,
  restoreTransactionAction,
  searchLinkCandidatesAction,
  unmarkDuplicateAction,
  updateTransactionAction,
  updateTransferLegAction,
  type DrawerPayload,
  type TxnFormState,
} from "./actions";
import { TXN_TYPE_LABELS } from "./schemas";
import type { AccountOption, CategoryOption, TagOption } from "./txn-dialogs";
import { CategorySelect } from "./txn-dialogs";

interface SplitDraft {
  categoryId: string;
  amount: string;
  note: string;
  isReimbursable: boolean;
}

/**
 * Candidate picker for refund/duplicate links: starts with the current page's
 * candidates and can search the whole ledger (not just the first page).
 */
function LinkPicker({
  fieldName,
  searchLabel,
  kind,
  excludeId,
  initial,
}: {
  fieldName: string;
  searchLabel: string;
  kind: "expense" | "any";
  excludeId: string;
  initial: Array<{ id: string; label: string }>;
}) {
  const [options, setOptions] = useState(initial);
  const [query, setQuery] = useState("");
  const [searching, startSearching] = useTransition();

  const runSearch = () => {
    startSearching(async () => {
      const result = await searchLinkCandidatesAction({ search: query, kind, excludeId });
      if (result.ok) {
        setOptions(result.data.map(({ id, label }) => ({ id, label })));
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <FormField label={searchLabel} className="flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder="Search merchant or description…"
          />
        </FormField>
        <Button type="button" variant="secondary" onClick={runSearch} disabled={searching}>
          {searching ? "…" : "Search"}
        </Button>
      </div>
      <Select name={fieldName} aria-label={`${searchLabel} results`}>
        {options.length === 0 ? <option value="">No matches — search above</option> : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export interface LinkCandidate {
  id: string;
  label: string;
  accountId: string;
  amountMinor: number;
  type: string;
}

function StateBanners({ state }: { state: TxnFormState }) {
  if (!state) return null;
  if (state.ok) return <Banner variant="positive">{state.data.message}</Banner>;
  return <Banner variant="risk">{state.error.message}</Banner>;
}

function SplitsEditor({
  categories,
  drafts,
  setDrafts,
}: {
  categories: CategoryOption[];
  drafts: SplitDraft[];
  setDrafts: (next: SplitDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<SplitDraft>) =>
    setDrafts(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  return (
    <fieldset className="flex flex-col gap-2 rounded-card border border-hairline p-3">
      <legend className="px-1 text-[13px] font-medium text-ink-secondary">
        Splits (must add up to the amount)
      </legend>
      {drafts.map((draft, index) => (
        <div key={index} className="flex items-center gap-2">
          <div className="flex-1">
            <Select
              aria-label={`Split ${index + 1} category`}
              value={draft.categoryId}
              onChange={(e) => update(index, { categoryId: e.target.value })}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.groupName} · {category.name}
                </option>
              ))}
            </Select>
          </div>
          <Input
            aria-label={`Split ${index + 1} amount`}
            value={draft.amount}
            onChange={(e) => update(index, { amount: e.target.value })}
            inputMode="decimal"
            className="num w-28"
            placeholder="0.00"
          />
          <label className="flex items-center gap-1 text-[11.5px] text-ink-muted">
            <input
              type="checkbox"
              checked={draft.isReimbursable}
              onChange={(e) => update(index, { isReimbursable: e.target.checked })}
              className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
            />
            reimb.
          </label>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove split ${index + 1}`}
            onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}
          >
            <Trash2 aria-hidden className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() =>
          setDrafts([
            ...drafts,
            { categoryId: categories[0]?.id ?? "", amount: "", note: "", isReimbursable: false },
          ])
        }
      >
        <Plus aria-hidden className="h-4 w-4" /> Add split
      </Button>
    </fieldset>
  );
}

export function TransactionDrawer({
  payload,
  accounts,
  categories,
  tags,
  candidates,
  onClose,
}: {
  payload: DrawerPayload;
  accounts: AccountOption[];
  categories: CategoryOption[];
  tags: TagOption[];
  candidates: LinkCandidate[];
  onClose: () => void;
}) {
  const txn = payload.detail.transaction;
  const currency = txn.currency.trim();
  const isTransfer = txn.type === "transfer";
  const isDeleted = Boolean(txn.deletedAt);

  const [updateState, updateAction, updatePending] = useActionState<TxnFormState, FormData>(
    isTransfer ? updateTransferLegAction : updateTransactionAction,
    null,
  );
  const [deleteState, deleteAction, deletePending] = useActionState<TxnFormState, FormData>(
    deleteTransactionAction,
    null,
  );
  const [restoreState, restoreAction, restorePending] = useActionState<TxnFormState, FormData>(
    restoreTransactionAction,
    null,
  );
  const [linkState, linkAction] = useActionState<TxnFormState, FormData>(linkRefundAction, null);
  const [dupState, dupAction] = useActionState<TxnFormState, FormData>(markDuplicateAction, null);
  const [undupState, undupAction] = useActionState<TxnFormState, FormData>(
    unmarkDuplicateAction,
    null,
  );
  const [unlinkState, unlinkAction] = useActionState<TxnFormState, FormData>(
    removeLinkAction,
    null,
  );

  const errors = updateState && !updateState.ok ? (updateState.error.fieldErrors ?? {}) : {};

  const [splits, setSplits] = useState<SplitDraft[]>(
    payload.detail.splits.map((s) => ({
      categoryId: s.categoryId,
      amount: minorToAmountInput(s.amountMinor, currency),
      note: s.note ?? "",
      isReimbursable: s.isReimbursable,
    })),
  );

  const refundLink = payload.detail.links.find((l) => l.linkType === "refund_of");
  const duplicateLink = payload.detail.links.find(
    (l) => l.linkType === "duplicate_of" && l.direction === "from",
  );
  const transferLink = payload.detail.links.find((l) => l.linkType === "transfer_pair");

  const splitsJson = JSON.stringify(
    splits
      .filter((s) => s.categoryId && s.amount.trim() !== "")
      .map((s) => ({
        categoryId: s.categoryId,
        amount: s.amount,
        note: s.note || undefined,
        isReimbursable: s.isReimbursable,
      })),
  );

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DrawerContent aria-describedby={undefined}>
        <DialogTitle className="pr-8 text-[19px] font-semibold text-ink">
          {payload.detail.merchant?.canonicalName ||
            txn.descriptionOriginal ||
            TXN_TYPE_LABELS[txn.type]}
        </DialogTitle>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <AmountText
            amountMinor={txn.amountMinor}
            currency={currency}
            className="text-[19px] font-semibold"
          />
          <Badge>{TXN_TYPE_LABELS[txn.type]}</Badge>
          {txn.status === "pending" ? <Badge variant="attention">Pending</Badge> : null}
          {txn.isExcluded ? <Badge>Excluded</Badge> : null}
          {txn.needsReview ? <Badge variant="info">Needs review</Badge> : null}
          {isDeleted ? <Badge variant="risk">Deleted</Badge> : null}
        </div>

        <div className="mt-4 flex flex-col gap-5">
          <StateBanners state={updateState} />
          <StateBanners state={deleteState} />
          <StateBanners state={restoreState} />

          {isDeleted ? (
            <form action={restoreAction} className="flex flex-col gap-3">
              <Banner variant="info">
                This transaction is deleted and not counted anywhere. Restoring brings back a
                transfer’s other leg too.
              </Banner>
              <input type="hidden" name="transactionId" value={txn.id} />
              <Button type="submit" disabled={restorePending} className="self-start">
                {restorePending ? "Restoring…" : "Restore"}
              </Button>
            </form>
          ) : isTransfer ? (
            <form action={updateAction} className="flex flex-col gap-4" noValidate>
              <Banner variant="info">
                Transfer legs stay equal and opposite — to change the amount or accounts, delete the
                transfer and record it again.
              </Banner>
              <input type="hidden" name="transactionId" value={txn.id} />
              <input type="hidden" name="version" value={txn.version} />
              <FormField label="Notes" errors={errors.notes}>
                <Input name="notes" defaultValue={txn.notes ?? ""} maxLength={1000} />
              </FormField>
              <div className="flex flex-wrap gap-4 text-[13px] text-ink-secondary">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    name="needsReview"
                    defaultChecked={txn.needsReview}
                    className="h-4 w-4 accent-[var(--accent-primary)]"
                  />
                  Needs review
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    name="isExcluded"
                    defaultChecked={txn.isExcluded}
                    className="h-4 w-4 accent-[var(--accent-primary)]"
                  />
                  Exclude from reports
                </label>
              </div>
              <Button type="submit" disabled={updatePending} className="self-start">
                {updatePending ? "Saving…" : "Save"}
              </Button>
            </form>
          ) : (
            <form action={updateAction} className="flex flex-col gap-4" noValidate>
              <input type="hidden" name="transactionId" value={txn.id} />
              <input type="hidden" name="version" value={txn.version} />
              <input type="hidden" name="type" value={txn.type} />
              <input type="hidden" name="splits" value={splitsJson} />
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Amount" errors={errors.amount}>
                  <Input
                    name="amount"
                    inputMode="decimal"
                    defaultValue={minorToAmountInput(txn.amountMinor, currency)}
                    className="num"
                  />
                </FormField>
                <FormField label="Date" errors={errors.txnDate}>
                  <Input name="txnDate" type="date" defaultValue={txn.txnDate} />
                </FormField>
              </div>
              <FormField
                label="Account"
                help="Same-currency accounts only."
                errors={errors.accountId}
              >
                <Select name="accountId" defaultValue={txn.accountId}>
                  {accounts
                    .filter((a) => a.currency === currency)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                </Select>
              </FormField>
              <FormField label="Merchant" errors={errors.merchantName}>
                <Input
                  name="merchantName"
                  defaultValue={payload.detail.merchant?.canonicalName ?? ""}
                  maxLength={120}
                />
              </FormField>
              <FormField
                label="Description"
                help={`Original: ${txn.descriptionOriginal || "—"}`}
                errors={errors.description}
              >
                <Input name="description" defaultValue={txn.descriptionOriginal} maxLength={200} />
              </FormField>
              {splits.length === 0 ? (
                <FormField label="Category" errors={errors.categoryId}>
                  <CategorySelect
                    categories={categories}
                    name="categoryId"
                    defaultValue={txn.categoryId ?? ""}
                  />
                </FormField>
              ) : (
                <input type="hidden" name="categoryId" value="" />
              )}
              <SplitsEditor categories={categories} drafts={splits} setDrafts={setSplits} />
              {tags.length > 0 ? (
                <fieldset className="flex flex-wrap gap-3 text-[13px] text-ink-secondary">
                  <legend className="mb-1 text-[13px] font-medium text-ink-secondary">Tags</legend>
                  {tags.map((tag) => (
                    <label key={tag.id} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        name="tagIds"
                        value={tag.id}
                        defaultChecked={payload.detail.tags.some((t) => t.id === tag.id)}
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
                    defaultChecked={txn.status === "posted"}
                    className="accent-[var(--accent-primary)]"
                  />{" "}
                  Posted
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="status"
                    value="pending"
                    defaultChecked={txn.status === "pending"}
                    className="accent-[var(--accent-primary)]"
                  />{" "}
                  Pending
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    name="needsReview"
                    defaultChecked={txn.needsReview}
                    className="h-4 w-4 accent-[var(--accent-primary)]"
                  />{" "}
                  Needs review
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    name="isExcluded"
                    defaultChecked={txn.isExcluded}
                    className="h-4 w-4 accent-[var(--accent-primary)]"
                  />{" "}
                  Excluded
                </label>
              </div>
              <FormField label="Notes" errors={errors.notes}>
                <Input name="notes" defaultValue={txn.notes ?? ""} maxLength={1000} />
              </FormField>
              <Button type="submit" disabled={updatePending} className="self-start">
                {updatePending ? "Saving…" : "Save changes"}
              </Button>
            </form>
          )}

          {/* Relationships */}
          <section
            aria-label="Relationships"
            className="flex flex-col gap-3 border-t border-hairline pt-4"
          >
            <h3 className="text-[15px] font-semibold text-ink">Relationships</h3>
            <StateBanners state={linkState} />
            <StateBanners state={dupState} />
            <StateBanners state={undupState} />
            <StateBanners state={unlinkState} />

            {transferLink ? (
              <p className="text-[13px] text-ink-secondary">
                Transfer counterpart: “{transferLink.otherDescription}” (
                <AmountText amountMinor={transferLink.otherAmountMinor} currency={currency} />)
              </p>
            ) : null}

            {refundLink ? (
              <div className="flex items-center justify-between gap-2 text-[13px] text-ink-secondary">
                <span>
                  {refundLink.direction === "from" ? "Refund of" : "Refunded by"} “
                  {refundLink.otherDescription}”
                </span>
                <form action={unlinkAction}>
                  <input type="hidden" name="linkId" value={refundLink.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Unlink
                  </Button>
                </form>
              </div>
            ) : txn.type === "refund" && !isDeleted ? (
              <form action={linkAction} className="flex flex-col gap-2">
                <input type="hidden" name="refundTransactionId" value={txn.id} />
                <LinkPicker
                  fieldName="purchaseTransactionId"
                  searchLabel="Link to purchase"
                  kind="expense"
                  excludeId={txn.id}
                  initial={candidates
                    .filter((c) => c.type === "expense")
                    .map((c) => ({ id: c.id, label: c.label }))}
                />
                <Button type="submit" variant="secondary" className="self-start">
                  Link refund
                </Button>
              </form>
            ) : null}

            {duplicateLink ? (
              <div className="flex items-center justify-between gap-2 text-[13px] text-ink-secondary">
                <span>Marked as duplicate of “{duplicateLink.otherDescription}” (excluded)</span>
                <form action={undupAction}>
                  <input type="hidden" name="transactionId" value={txn.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Unmark
                  </Button>
                </form>
              </div>
            ) : !isTransfer && !isDeleted ? (
              <form action={dupAction} className="flex flex-col gap-2">
                <input type="hidden" name="duplicateTransactionId" value={txn.id} />
                <LinkPicker
                  fieldName="canonicalTransactionId"
                  searchLabel="Mark as duplicate of"
                  kind="any"
                  excludeId={txn.id}
                  initial={candidates
                    .filter((c) => c.id !== txn.id && c.amountMinor === txn.amountMinor)
                    .map((c) => ({ id: c.id, label: c.label }))}
                />
                <Button type="submit" variant="secondary" className="self-start">
                  Mark duplicate
                </Button>
              </form>
            ) : null}
          </section>

          {/* History */}
          <section
            aria-label="History"
            className="flex flex-col gap-2 border-t border-hairline pt-4"
          >
            <h3 className="text-[15px] font-semibold text-ink">History</h3>
            {payload.audit.length === 0 ? (
              <p className="text-[13px] text-ink-muted">No recorded changes.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {payload.audit.map((entry) => (
                  <li key={entry.id} className="text-[13px] text-ink-secondary">
                    <span className="font-medium text-ink">
                      {entry.eventType.replace("transaction.", "").replaceAll("_", " ")}
                    </span>{" "}
                    ·{" "}
                    {new Intl.DateTimeFormat("en-MY", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(entry.createdAtIso))}
                    {entry.diff && Object.keys(entry.diff as object).length > 0 ? (
                      <span className="block text-[11.5px] text-ink-muted">
                        {Object.entries(entry.diff as Record<string, unknown>)
                          .map(([key, value]) =>
                            value && typeof value === "object" && "from" in (value as object)
                              ? `${key}: ${String((value as { from: unknown }).from)} → ${String((value as { to: unknown }).to)}`
                              : `${key}: ${JSON.stringify(value)}`,
                          )
                          .join(" · ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!isDeleted ? (
            <form action={deleteAction} className="border-t border-hairline pt-4">
              <input type="hidden" name="transactionId" value={txn.id} />
              <Button type="submit" variant="destructive" disabled={deletePending}>
                {deletePending
                  ? "Deleting…"
                  : transferLink
                    ? "Delete transfer (both legs)"
                    : "Delete transaction"}
              </Button>
            </form>
          ) : null}
        </div>
      </DrawerContent>
    </Dialog>
  );
}
