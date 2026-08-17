import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { cancelImportAction } from "@/features/imports/actions";
import { MappingForm, type SavedProfileOption } from "@/features/imports/mapping-form";
import { ImportPoller } from "@/features/imports/poller";
import {
  RetryImportForm,
  ReviewTable,
  UndoImportForm,
  type ReviewLink,
  type ReviewRow,
} from "@/features/imports/review-table";
import type { ImportMappingInput } from "@/features/imports/builtin-profiles";
import { cn } from "@/lib/cn";
import { suggestMapping } from "@/lib/csv";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { importsService, type ImportRowRow, type ImportStats } from "@/server/services/imports";

export const metadata: Metadata = { title: "Import" };

const STEPS = ["Upload", "Map fields", "Review", "Confirm", "Results"] as const;
const ROWS_PER_PAGE = 200;

const ROW_FILTERS = [
  { key: "all", label: "All rows", statuses: undefined },
  { key: "valid", label: "Will import", statuses: ["valid" as const] },
  { key: "duplicate", label: "Duplicates", statuses: ["duplicate" as const] },
  { key: "invalid", label: "Can’t import", statuses: ["invalid" as const] },
  { key: "skipped", label: "Skipped", statuses: ["skipped" as const] },
];

function stepIndexFor(status: string): number {
  switch (status) {
    case "mapping":
      return 1;
    case "validating":
    case "review":
      return 2;
    case "committing":
      return 3;
    case "completed":
    case "undone":
      return 4;
    default:
      return 1;
  }
}

function Steps({ current }: { current: number }) {
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-2" aria-label={`Step ${current + 1} of 5`}>
      {STEPS.map((label, index) => (
        <li key={label} className="flex items-center gap-2">
          <span
            aria-current={index === current ? "step" : undefined}
            className={cn(
              "grid h-6 w-6 place-items-center rounded-chip text-[11.5px] font-semibold",
              index === current
                ? "bg-accent text-on-accent"
                : index < current
                  ? "bg-accent-soft text-accent"
                  : "bg-sunken text-ink-muted",
            )}
          >
            {index + 1}
          </span>
          <span className="text-[11.5px] text-ink-muted">{label}</span>
        </li>
      ))}
    </ol>
  );
}

async function renderMappingBody(userId: string, jobId: string) {
  const db = getDb();
  const firstRows = await importsService.listRows(db, userId, jobId, { limit: 6 });
  const preview = firstRows.map((row) => row.raw as string[]);
  const profiles: SavedProfileOption[] = (await importsService.listProfiles(db, userId)).map(
    (profile) => ({
      id: profile.id,
      name: profile.name,
      mapping: profile.mapping as ImportMappingInput,
    }),
  );
  const headerSuggestion = suggestMapping(preview[0] ?? []);
  const suggested = {
    headerRows: 1,
    dateFormat: "auto" as const,
    dateColumn: headerSuggestion.dateColumn ?? 0,
    descriptionColumn: headerSuggestion.descriptionColumn ?? 1,
    amountColumn: headerSuggestion.amountColumn,
    debitColumn: headerSuggestion.debitColumn,
    creditColumn: headerSuggestion.creditColumn,
  };
  return <MappingForm jobId={jobId} preview={preview} suggested={suggested} profiles={profiles} />;
}

export default async function ImportJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ rows?: string; rowPage?: string; step?: string }>;
}) {
  const { user } = await requireUser();
  const { jobId } = await params;
  const sp = await searchParams;
  const db = getDb();
  const job = await importsService.getJob(db, user.id, jobId);
  if (!job) notFound();

  const stats = (job.stats ?? {}) as ImportStats;
  const transient = job.status === "validating" || job.status === "committing";
  const remapping = job.status === "review" && sp.step === "mapping";

  let body: React.ReactNode;
  if (job.status === "mapping" || remapping) {
    body = (
      <>
        {remapping ? (
          <Banner variant="info" className="mb-4">
            Adjusting the mapping re-checks every row —{" "}
            <Link href={`/imports/${jobId}`} className="font-semibold underline">
              back to review
            </Link>{" "}
            without changes.
          </Banner>
        ) : null}
        {await renderMappingBody(user.id, jobId)}
      </>
    );
  } else {
    switch (job.status) {
      case "validating":
      case "committing":
        body = (
          <Card className="max-w-xl">
            <CardContent className="flex flex-col gap-3">
              <Banner variant="info">
                {job.status === "validating"
                  ? "Checking dates, amounts, and duplicates in the background…"
                  : "Importing your transactions in the background…"}
              </Banner>
              <p className="text-[13px] text-ink-muted">
                This page refreshes automatically. Retries are safe — nothing can be imported twice.
              </p>
            </CardContent>
          </Card>
        );
        break;
      case "review": {
        // Whole-import counts + filtered, paginated rows (never just the first page).
        const statusCounts = await importsService.countRowsByStatus(db, user.id, jobId);
        const counts = {
          valid: statusCounts.valid ?? 0,
          invalid: statusCounts.invalid ?? 0,
          duplicate: statusCounts.duplicate ?? 0,
        };
        const filter = ROW_FILTERS.find((f) => f.key === sp.rows) ?? ROW_FILTERS[0];
        const totalFiltered = filter.statuses
          ? (statusCounts[filter.statuses[0]] ?? 0)
          : Object.values(statusCounts).reduce((a, b) => a + b, 0);
        const page = Math.max(1, Number(sp.rowPage) || 1);
        const rows = await importsService.listRows(db, user.id, jobId, {
          statuses: filter.statuses,
          limit: ROWS_PER_PAGE,
          offset: (page - 1) * ROWS_PER_PAGE,
        });

        const hrefFor = (filterKey: string, pageNum: number) => {
          const qs = new URLSearchParams();
          if (filterKey !== "all") qs.set("rows", filterKey);
          if (pageNum > 1) qs.set("rowPage", String(pageNum));
          const s = qs.toString();
          return s ? `/imports/${jobId}?${s}` : `/imports/${jobId}`;
        };
        const filterLinks: ReviewLink[] = ROW_FILTERS.map((f) => ({
          label: `${f.label}${f.statuses ? ` (${statusCounts[f.statuses[0]] ?? 0})` : ""}`,
          href: hrefFor(f.key, 1),
          active: f.key === filter.key,
        }));
        const lastPage = Math.max(1, Math.ceil(totalFiltered / ROWS_PER_PAGE));
        const reviewRows: ReviewRow[] = rows
          .filter((row: ImportRowRow) => row.errorReason !== "header")
          .map((row: ImportRowRow) => {
            const parsed = row.parsed as {
              dateIso?: string;
              amountMinor?: number;
              description?: string;
            } | null;
            return {
              id: row.id,
              rowNumber: row.rowNumber,
              status: row.status,
              errorReason: row.errorReason,
              dateIso: parsed?.dateIso ?? null,
              amountMinor: parsed?.amountMinor ?? null,
              description: parsed?.description ?? (row.raw as string[]).join(" · ").slice(0, 120),
            };
          });
        const mapping = (job.mapping ?? {}) as { dateFormat?: string };
        body = (
          <ReviewTable
            jobId={jobId}
            currency={job.accountCurrency}
            rows={reviewRows}
            counts={counts}
            filterLinks={filterLinks}
            prevHref={page > 1 ? hrefFor(filter.key, page - 1) : null}
            nextHref={page < lastPage ? hrefFor(filter.key, page + 1) : null}
            pageInfo={`Rows ${Math.min((page - 1) * ROWS_PER_PAGE + 1, totalFiltered)}–${Math.min(page * ROWS_PER_PAGE, totalFiltered)} of ${totalFiltered}`}
            adjustMappingHref={`/imports/${jobId}?step=mapping`}
            ambiguousDates={Boolean(stats.ambiguousDates)}
            dateFormatLabel={mapping.dateFormat ?? "auto"}
          />
        );
        break;
      }
      case "completed":
        body = (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile label="Added">{stats.added ?? 0}</StatTile>
              <StatTile label="Duplicates skipped">{stats.duplicates ?? 0}</StatTile>
              <StatTile label="Failed rows">{stats.failed ?? 0}</StatTile>
              <StatTile label="Needs review">{stats.needsReview ?? 0}</StatTile>
            </div>
            {(stats.needsReview ?? 0) > 0 ? (
              <Banner variant="info">
                Imported transactions without a known merchant category are waiting in{" "}
                <Link href="/transactions?view=review" className="font-semibold underline">
                  Needs review
                </Link>
                .
              </Banner>
            ) : null}
            <UndoImportForm jobId={jobId} />
          </div>
        );
        break;
      case "failed":
        body = (
          <div className="flex max-w-xl flex-col gap-3">
            <Banner variant="risk">{job.error ?? "This import failed."}</Banner>
            <div className="flex gap-2">
              <RetryImportForm jobId={jobId} />
              <form action={cancelImportAction}>
                <input type="hidden" name="jobId" value={jobId} />
                <Button type="submit" variant="ghost">
                  Cancel import
                </Button>
              </form>
            </div>
          </div>
        );
        break;
      case "undone":
        body = (
          <Banner variant="info">
            This import was undone — its untouched transactions are soft-deleted and restorable from
            the{" "}
            <Link href="/transactions?view=deleted" className="font-semibold underline">
              Deleted view
            </Link>
            . Transactions you edited were kept. You can re-import the statement any time.
          </Banner>
        );
        break;
      default:
        body = <Banner variant="info">This import was canceled.</Banner>;
    }
  }

  return (
    <>
      <PageHeader
        title={job.filename}
        description={`Into ${job.accountName} (${job.accountCurrency}) · ${job.rowCount} rows staged`}
        actions={<Badge variant="info">{job.status}</Badge>}
      />
      <Steps current={remapping ? 1 : stepIndexFor(job.status)} />
      <ImportPoller active={transient} />
      {body}
    </>
  );
}
