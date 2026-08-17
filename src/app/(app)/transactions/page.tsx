import type { Metadata } from "next";
import Link from "next/link";

import { AmountText } from "@/components/ui/amount-text";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import {
  parseTransactionsSearchParams,
  transactionsHref,
  type SavedView,
  type TransactionsSearchParams,
} from "@/features/transactions/search-params";
import { TransactionsWorkspace } from "@/features/transactions/workspace";
import {
  AddTransactionDialog,
  TransferDialog,
  type AccountOption,
  type CategoryOption,
} from "@/features/transactions/txn-dialogs";
import { localDateInTz } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { accountsService } from "@/server/services/accounts";
import { categoriesService } from "@/server/services/categories";
import { tagsService } from "@/server/services/tags";
import { transactionsService } from "@/server/services/transactions";

export const metadata: Metadata = { title: t("nav.transactions") };

const VIEWS: Array<{ key: SavedView; label: string }> = [
  { key: "all", label: "All" },
  { key: "review", label: "Needs review" },
  { key: "pending", label: "Pending" },
  { key: "excluded", label: "Excluded" },
  { key: "deleted", label: "Deleted" },
];

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<TransactionsSearchParams>;
}) {
  const { user } = await requireUser();
  const params = await searchParams;
  const { query, view } = parseTransactionsSearchParams(params);
  const db = getDb();

  const [prefs, accountRows, groups, tagRows, page, summary] = await Promise.all([
    preferencesRepo.get(db, user.id),
    accountsService.list(db, user.id, { includeArchived: true }),
    categoriesService.listGroups(db, user.id),
    tagsService.list(db, user.id),
    transactionsService.list(db, user.id, query),
    transactionsService.summary(db, user.id, {
      accountIds: query.accountIds,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    }),
  ]);

  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");
  const accounts: AccountOption[] = accountRows
    .filter((a) => a.status === "active")
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency.trim() }));
  const categories: CategoryOption[] = groups.flatMap((group) =>
    group.categories.map((category) => ({
      id: category.id,
      name: category.name,
      groupName: group.name,
      kind: group.kind,
    })),
  );
  const tags = tagRows.map((tag) => ({ id: tag.id, name: tag.name }));
  const currencies = Object.keys(summary).sort((a, b) =>
    a === "MYR" ? -1 : b === "MYR" ? 1 : a.localeCompare(b),
  );

  if (accountRows.length === 0) {
    return (
      <>
        <PageHeader title={t("nav.transactions")} />
        <EmptyState
          title="Add an account first"
          description="Transactions live in accounts. Create your first account, then record or review spending here."
          action={
            <Button asChild>
              <Link href="/accounts">Go to Accounts</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.transactions")}
        description="Search, review, and correct every transaction. Everything here is yours to edit — nothing is hidden."
        actions={
          <>
            <TransferDialog accounts={accounts} today={today} />
            <AddTransactionDialog
              accounts={accounts}
              categories={categories}
              tags={tags}
              today={today}
            />
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {/* Drill-down origin: a safe, same-app path back to analytics/overview. */}
        {params.back && /^\/(analytics|overview)(\?|$)/.test(params.back) ? (
          <Banner variant="info">
            You’re viewing transactions filtered from a report.{" "}
            <Link href={params.back} className="font-semibold underline">
              Back to {params.back.startsWith("/analytics") ? "Analytics" : "Overview"}
            </Link>
          </Banner>
        ) : null}

        {/* Saved views */}
        <nav aria-label="Saved views" className="flex flex-wrap gap-1">
          {VIEWS.map((entry) => (
            <Link
              key={entry.key}
              href={transactionsHref(params, {
                view: entry.key === "all" ? "" : entry.key,
                cursor: "",
              })}
              aria-current={view === entry.key ? "page" : undefined}
              className={cn(
                "rounded-chip px-3 py-1.5 text-[13px] font-medium",
                view === entry.key
                  ? "bg-accent-soft text-accent"
                  : "text-ink-secondary hover:bg-sunken hover:text-ink",
              )}
            >
              {entry.label}
            </Link>
          ))}
        </nav>

        {/* Filters (plain GET form: URLs hold all state) */}
        <form
          method="get"
          action="/transactions"
          className="grid grid-cols-2 items-end gap-2 rounded-card border border-hairline bg-card p-3 sm:grid-cols-4 lg:grid-cols-8"
        >
          {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
          <label className="col-span-2 flex flex-col gap-1 text-[11.5px] font-medium text-ink-muted sm:col-span-1 lg:col-span-2">
            Search
            <Input name="q" defaultValue={params.q ?? ""} placeholder="Merchant, description…" />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] font-medium text-ink-muted">
            Account
            <Select name="accounts" defaultValue={params.accounts ?? ""}>
              <option value="">All</option>
              {accountRows.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] font-medium text-ink-muted">
            Tag
            <Select name="tags" defaultValue={params.tags ?? ""}>
              <option value="">All</option>
              {tagRows.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] font-medium text-ink-muted">
            Type
            <Select name="type" defaultValue={params.type ?? ""}>
              <option value="">All</option>
              {["expense", "income", "transfer", "refund", "adjustment", "debt_payment"].map(
                (type) => (
                  <option key={type} value={type}>
                    {type.replace("_", " ")}
                  </option>
                ),
              )}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] font-medium text-ink-muted">
            From
            <Input name="from" type="date" defaultValue={params.from ?? ""} />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] font-medium text-ink-muted">
            To
            <Input name="to" type="date" defaultValue={params.to ?? ""} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" className="flex-1">
              Apply
            </Button>
            <Button asChild variant="ghost">
              <Link href="/transactions">Reset</Link>
            </Button>
          </div>
        </form>

        {/* Summary bar: per currency, never combined (invariant 8) */}
        <div className="flex flex-wrap gap-4">
          {currencies.map((currency) => (
            <div
              key={currency}
              className="flex items-center gap-4 rounded-card border border-hairline bg-card px-4 py-2 text-[13px]"
            >
              <Badge variant="info">{currency}</Badge>
              <span className="text-ink-secondary">
                Income{" "}
                <AmountText
                  amountMinor={summary[currency].incomeMinor}
                  currency={currency}
                  className="font-semibold text-ink"
                />
              </span>
              <span className="text-ink-secondary">
                Expenses{" "}
                <AmountText
                  amountMinor={summary[currency].expenseMinor}
                  currency={currency}
                  className="font-semibold text-ink"
                />
              </span>
              <span className="text-ink-secondary">
                Net{" "}
                <AmountText
                  amountMinor={summary[currency].netMinor}
                  currency={currency}
                  className="font-semibold text-ink"
                />
              </span>
            </div>
          ))}
          <p className="self-center text-[11.5px] text-ink-muted">
            Posted, non-excluded transactions only. Transfers and adjustments never count; refunds
            reduce expenses.
          </p>
        </div>

        <TransactionsWorkspace
          items={page.items}
          accounts={accounts}
          categories={categories}
          tags={tags}
        />

        {/* Keyset pagination */}
        <div className="flex items-center gap-3">
          {page.nextCursor ? (
            <Button asChild variant="secondary">
              <Link href={transactionsHref(params, { cursor: page.nextCursor })}>Next page →</Link>
            </Button>
          ) : null}
          {params.cursor ? (
            <Button asChild variant="ghost">
              <Link href={transactionsHref(params, { cursor: "" })}>Back to first page</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}
