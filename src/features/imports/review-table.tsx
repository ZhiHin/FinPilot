"use client";

import { useActionState } from "react";

import { AmountText } from "@/components/ui/amount-text";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { formatIsoDate } from "@/lib/dates";

import {
  cancelImportAction,
  confirmImportAction,
  toggleRowAction,
  undoImportAction,
  type ImportFormState,
} from "./actions";

export interface ReviewRow {
  id: string;
  rowNumber: number;
  status: string;
  errorReason: string | null;
  dateIso: string | null;
  amountMinor: number | null;
  description: string | null;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "valid":
      return <Badge variant="positive">Will import</Badge>;
    case "duplicate":
      return <Badge variant="attention">Possible duplicate</Badge>;
    case "invalid":
      return <Badge variant="risk">Can’t import</Badge>;
    case "skipped":
      return <Badge>Skipped</Badge>;
    case "committed":
      return <Badge variant="info">Imported</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function StateBanner({ state }: { state: ImportFormState }) {
  if (!state) return null;
  if (state.ok)
    return state.data.message ? <Banner variant="positive">{state.data.message}</Banner> : null;
  return <Banner variant="risk">{state.error.message}</Banner>;
}

export interface ReviewLink {
  label: string;
  href: string;
  active: boolean;
}

export function ReviewTable({
  jobId,
  currency,
  rows,
  counts,
  filterLinks,
  prevHref,
  nextHref,
  pageInfo,
  adjustMappingHref,
  ambiguousDates,
  dateFormatLabel,
}: {
  jobId: string;
  currency: string;
  rows: ReviewRow[];
  counts: { valid: number; invalid: number; duplicate: number };
  filterLinks: ReviewLink[];
  prevHref: string | null;
  nextHref: string | null;
  pageInfo: string;
  adjustMappingHref: string;
  ambiguousDates: boolean;
  dateFormatLabel: string;
}) {
  const [toggleState, toggleAction] = useActionState<ImportFormState, FormData>(
    toggleRowAction,
    null,
  );
  const [confirmState, confirmAction, confirmPending] = useActionState<ImportFormState, FormData>(
    confirmImportAction,
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      <StateBanner state={toggleState} />
      <StateBanner state={confirmState} />

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Badge variant="positive">{counts.valid} will import</Badge>
        <Badge variant="attention">
          {counts.duplicate} possible duplicates (skipped by default)
        </Badge>
        <Badge variant="risk">{counts.invalid} can’t import</Badge>
        <a
          href={adjustMappingHref}
          className="ml-auto font-medium text-accent underline underline-offset-2 hover:no-underline"
        >
          Adjust mapping
        </a>
      </div>
      {ambiguousDates ? (
        <Banner variant="attention">
          Every date in this file reads validly as both day-first and month-first. It was parsed as{" "}
          <strong>{dateFormatLabel}</strong> — spot-check a few parsed dates below, and use “Adjust
          mapping” if they look wrong.
        </Banner>
      ) : null}
      {counts.invalid > 0 ? (
        <Banner variant="info">
          Rows that can’t import show their exact reason below. Fix them by adjusting the mapping
          (wrong column or date format); otherwise they’re excluded from the commit and reported in
          the results.
        </Banner>
      ) : null}
      {counts.duplicate > 0 ? (
        <Banner variant="info">
          Possible duplicates match transactions already in this account (same date, amount, and
          description). Include one only if it really happened twice.
        </Banner>
      ) : null}

      <nav aria-label="Row filters" className="flex flex-wrap items-center gap-1 text-[13px]">
        {filterLinks.map((link) => (
          <a
            key={link.href}
            href={link.href}
            aria-current={link.active ? "page" : undefined}
            className={
              link.active
                ? "rounded-chip bg-accent-soft px-3 py-1 font-medium text-accent"
                : "rounded-chip px-3 py-1 text-ink-secondary hover:bg-sunken"
            }
          >
            {link.label}
          </a>
        ))}
        <span className="ml-auto text-[11.5px] text-ink-muted">{pageInfo}</span>
      </nav>

      <div className="overflow-x-auto rounded-card border border-hairline bg-card">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-hairline last:border-0">
                <td className="px-3 py-1.5 text-ink-muted">{row.rowNumber}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-ink-secondary">
                  {row.dateIso ? formatIsoDate(row.dateIso, "en-MY") : "—"}
                </td>
                <td className="max-w-72 truncate px-3 py-1.5 text-ink">
                  {row.description ?? "—"}
                  {row.errorReason && row.errorReason !== "header" ? (
                    <span className="block truncate text-[11.5px] text-risk">
                      {row.errorReason}
                    </span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  {row.amountMinor !== null ? (
                    <AmountText amountMinor={row.amountMinor} currency={currency} />
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-3 py-1.5">
                  {row.status === "valid" ||
                  row.status === "duplicate" ||
                  row.status === "skipped" ? (
                    <form action={toggleAction}>
                      <input type="hidden" name="jobId" value={jobId} />
                      <input type="hidden" name="rowId" value={row.id} />
                      <input
                        type="hidden"
                        name="included"
                        value={row.status === "valid" ? "false" : "true"}
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        {row.status === "valid" ? "Skip" : "Include"}
                      </Button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {prevHref || nextHref ? (
        <nav aria-label="Row pages" className="flex items-center gap-2 text-[13px]">
          {prevHref ? (
            <a
              href={prevHref}
              className="text-accent underline underline-offset-2 hover:no-underline"
            >
              ← Previous rows
            </a>
          ) : null}
          {nextHref ? (
            <a
              href={nextHref}
              className="text-accent underline underline-offset-2 hover:no-underline"
            >
              Next rows →
            </a>
          ) : null}
        </nav>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <form action={confirmAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <Button type="submit" disabled={confirmPending || counts.valid === 0}>
            {confirmPending ? "Starting…" : `Import ${counts.valid} transaction(s)`}
          </Button>
        </form>
        <form action={cancelImportAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <Button type="submit" variant="ghost">
            Cancel import
          </Button>
        </form>
        <p className="text-[13px] text-ink-muted">
          Nothing is written to your ledger until you confirm.
        </p>
      </div>
    </div>
  );
}

export function UndoImportForm({ jobId }: { jobId: string }) {
  const [state, formAction, pending] = useActionState<ImportFormState, FormData>(
    undoImportAction,
    null,
  );
  return (
    <div className="flex flex-col gap-2">
      <StateBanner state={state} />
      <form action={formAction}>
        <input type="hidden" name="jobId" value={jobId} />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Undoing…" : "Undo this import"}
        </Button>
      </form>
      <p className="text-[11.5px] text-ink-muted">
        Removes only untouched imported transactions (soft-deleted, restorable). Any you’ve edited
        since importing are kept.
      </p>
    </div>
  );
}

export function RetryImportForm({ jobId }: { jobId: string }) {
  const [state, formAction, pending] = useActionState<ImportFormState, FormData>(
    confirmImportAction,
    null,
  );
  return (
    <div className="flex flex-col gap-2">
      <StateBanner state={state} />
      <form action={formAction}>
        <input type="hidden" name="jobId" value={jobId} />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Retrying…" : "Retry commit"}
        </Button>
      </form>
    </div>
  );
}
