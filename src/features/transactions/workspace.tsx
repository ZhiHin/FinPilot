"use client";

import { useActionState, useState, useTransition } from "react";

import { AmountText } from "@/components/ui/amount-text";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { formatIsoDate } from "@/lib/dates";
import type { TransactionListItem } from "@/server/services/transactions";

import {
  bulkTransactionAction,
  getTransactionDrawerAction,
  type DrawerPayload,
  type TxnFormState,
} from "./actions";
import { TransactionDrawer, type LinkCandidate } from "./drawer";
import type { AccountOption, CategoryOption, TagOption } from "./txn-dialogs";
import { CategorySelect } from "./txn-dialogs";

function RowBadges({ item }: { item: TransactionListItem }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {item.status === "pending" ? <Badge variant="attention">Pending</Badge> : null}
      {item.needsReview ? <Badge variant="info">Review</Badge> : null}
      {item.isExcluded ? <Badge>Excluded</Badge> : null}
      {item.isTransferLeg ? <Badge>Transfer</Badge> : null}
      {item.hasSplits ? <Badge>Split</Badge> : null}
      {item.deletedAt ? <Badge variant="risk">Deleted</Badge> : null}
    </span>
  );
}

export function TransactionsWorkspace({
  items,
  accounts,
  categories,
  tags,
}: {
  items: TransactionListItem[];
  accounts: AccountOption[];
  categories: CategoryOption[];
  tags: TagOption[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<DrawerPayload | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();
  const [bulkState, bulkAction, bulkPending] = useActionState<TxnFormState, FormData>(
    bulkTransactionAction,
    null,
  );

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  };
  const allChecked = items.length > 0 && items.every((i) => selected.has(i.id));

  const openDrawer = (id: string) => {
    setDrawerError(null);
    startOpening(async () => {
      const result = await getTransactionDrawerAction(id);
      if (result.ok) setDrawer(result.data);
      else setDrawerError(result.error.message);
    });
  };

  const candidates: LinkCandidate[] = items.map((item) => ({
    id: item.id,
    label: `${formatIsoDate(item.txnDate, "en-MY")} · ${item.merchantName ?? item.descriptionOriginal ?? "—"}`,
    accountId: item.accountId,
    amountMinor: item.amountMinor,
    type: item.type,
  }));

  const selectedIdsJson = JSON.stringify([...selected]);

  return (
    <div className="flex flex-col gap-3">
      {drawerError ? <Banner variant="risk">{drawerError}</Banner> : null}
      {bulkState?.ok ? <Banner variant="positive">{bulkState.data.message}</Banner> : null}
      {bulkState && !bulkState.ok ? (
        <Banner variant="risk">{bulkState.error.message}</Banner>
      ) : null}

      {selected.size > 0 ? (
        <form
          action={bulkAction}
          className="flex flex-wrap items-center gap-2 rounded-card border border-hairline bg-accent-soft p-3"
        >
          <span className="text-[13px] font-medium text-ink">{selected.size} selected</span>
          <input type="hidden" name="transactionIds" value={selectedIdsJson} />
          <div className="w-56">
            <CategorySelect categories={categories} name="categoryId" aria-label="Bulk category" />
          </div>
          <Button
            type="submit"
            name="intent"
            value="categorize"
            variant="secondary"
            size="sm"
            disabled={bulkPending}
          >
            Set category
          </Button>
          <Button
            type="submit"
            name="intent"
            value="review"
            variant="secondary"
            size="sm"
            disabled={bulkPending}
          >
            Mark reviewed
          </Button>
          <Button
            type="submit"
            name="intent"
            value="exclude"
            variant="secondary"
            size="sm"
            disabled={bulkPending}
          >
            Exclude
          </Button>
          <Button
            type="submit"
            name="intent"
            value="include"
            variant="secondary"
            size="sm"
            disabled={bulkPending}
          >
            Include
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </form>
      ) : null}

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-card border border-hairline bg-card lg:block">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allChecked}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())
                  }
                  className="h-4 w-4 accent-[var(--accent-primary)]"
                />
              </th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Merchant / description</th>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-hairline last:border-0 hover:bg-sunken"
                onClick={() => openDrawer(item.id)}
              >
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.descriptionOriginal || item.merchantName || "transaction"}`}
                    checked={selected.has(item.id)}
                    onChange={(e) => toggle(item.id, e.target.checked)}
                    className="h-4 w-4 accent-[var(--accent-primary)]"
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
                  {formatIsoDate(item.txnDate, "en-MY")}
                </td>
                <td className="max-w-64 px-3 py-2">
                  <div className="truncate font-medium text-ink">
                    {item.merchantName ?? item.descriptionOriginal ?? "—"}
                  </div>
                  {item.merchantName && item.descriptionOriginal ? (
                    <div className="truncate text-[11.5px] text-ink-muted">
                      {item.descriptionOriginal}
                    </div>
                  ) : null}
                  {item.tagNames.length > 0 ? (
                    <div className="truncate text-[11.5px] text-ink-muted">
                      #{item.tagNames.join(" #")}
                    </div>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
                  {item.accountName}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">
                  {item.isTransferLeg ? "—" : (item.categoryName ?? "Uncategorised")}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <AmountText amountMinor={item.amountMinor} currency={item.currency} />
                </td>
                <td className="px-3 py-2">
                  <RowBadges item={item} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="flex flex-col gap-2 lg:hidden">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => openDrawer(item.id)}
              className="flex w-full items-center justify-between gap-3 rounded-card border border-hairline bg-card px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium text-ink">
                  {item.merchantName ?? item.descriptionOriginal ?? "—"}
                </div>
                <div className="text-[11.5px] text-ink-muted">
                  {formatIsoDate(item.txnDate, "en-MY")} · {item.accountName}
                  {!item.isTransferLeg && item.categoryName ? ` · ${item.categoryName}` : ""}
                </div>
                <div className="mt-1">
                  <RowBadges item={item} />
                </div>
              </div>
              <AmountText
                amountMinor={item.amountMinor}
                currency={item.currency}
                className="shrink-0 text-[15px] font-semibold"
              />
            </button>
          </li>
        ))}
      </ul>

      {opening ? <p className="text-[13px] text-ink-muted">Opening…</p> : null}
      {items.length === 0 ? (
        <p className="rounded-card border border-dashed border-strongline p-8 text-center text-[13px] text-ink-muted">
          No transactions match these filters.
        </p>
      ) : null}

      {drawer ? (
        <TransactionDrawer
          payload={drawer}
          accounts={accounts}
          categories={categories}
          tags={tags}
          candidates={candidates}
          onClose={() => setDrawer(null)}
        />
      ) : null}
    </div>
  );
}
