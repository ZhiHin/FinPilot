import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { importsService, type ImportStats } from "@/server/services/imports";

export const metadata: Metadata = { title: t("nav.imports") };

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="positive">Completed</Badge>;
    case "review":
      return <Badge variant="attention">Awaiting review</Badge>;
    case "mapping":
      return <Badge variant="info">Mapping</Badge>;
    case "validating":
    case "committing":
      return <Badge variant="info">Working…</Badge>;
    case "failed":
      return <Badge variant="risk">Failed</Badge>;
    case "undone":
      return <Badge>Undone</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

export default async function ImportsPage() {
  const { user } = await requireUser();
  const db = getDb();
  const [jobs, profiles] = await Promise.all([
    importsService.listJobs(db, user.id),
    importsService.listProfiles(db, user.id),
  ]);

  return (
    <>
      <PageHeader
        title={t("nav.imports")}
        description="Bring in bank and e-wallet statements safely: map once, review, confirm — retries can never duplicate."
        actions={
          <Button asChild>
            <Link href="/imports/new">
              <Plus aria-hidden className="h-4 w-4" /> New import
            </Link>
          </Button>
        }
      />

      {jobs.length === 0 ? (
        <EmptyState
          title="No imports yet"
          description="Upload a CSV statement export to get months of history in minutes."
          action={
            <Button asChild variant="secondary">
              <Link href="/imports/new">Import a statement</Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {jobs.map((job) => {
            const stats = (job.stats ?? {}) as ImportStats;
            return (
              <Link
                key={job.id}
                href={`/imports/${job.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-hairline bg-card px-4 py-3 hover:border-strongline"
              >
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium text-ink">{job.filename}</div>
                  <div className="text-[13px] text-ink-muted">
                    {job.accountName} ·{" "}
                    {new Intl.DateTimeFormat("en-MY", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(job.createdAt)}
                    {job.status === "completed"
                      ? ` · ${stats.added ?? 0} added, ${stats.duplicates ?? 0} duplicates skipped`
                      : ""}
                  </div>
                </div>
                {statusBadge(job.status)}
              </Link>
            );
          })}
        </div>
      )}

      {profiles.length > 0 ? (
        <section aria-label="Import profiles" className="mt-8">
          <h2 className="mb-2 text-[15px] font-semibold text-ink">Saved mapping profiles</h2>
          <div className="flex flex-wrap gap-2">
            {profiles.map((profile) => (
              <Badge key={profile.id} variant="info">
                {profile.name}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
