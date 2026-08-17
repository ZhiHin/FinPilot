import type { Metadata } from "next";
import Link from "next/link";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { accountsService } from "@/server/services/accounts";

export const metadata: Metadata = { title: "New import" };

export default async function NewImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user } = await requireUser();
  const { error } = await searchParams;
  const accounts = await accountsService.list(getDb(), user.id);

  return (
    <>
      <PageHeader
        title="Import a statement"
        description="Upload a CSV export from your bank or e-wallet. Nothing is committed until you review and confirm — and the file itself is never stored."
      />
      {accounts.length === 0 ? (
        <EmptyState
          title="Add an account first"
          description="Imports land in an account. Create the matching account, then upload its statement."
          action={
            <Button asChild>
              <Link href="/accounts">Go to Accounts</Link>
            </Button>
          }
        />
      ) : (
        <Card className="max-w-xl">
          <CardContent className="flex flex-col gap-4">
            {error ? <Banner variant="risk">{error}</Banner> : null}
            <form
              method="post"
              action="/api/imports"
              encType="multipart/form-data"
              className="flex flex-col gap-4"
            >
              <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-secondary">
                Into account
                <Select name="accountId" defaultValue={accounts[0]?.id}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.currency.trim()})
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-secondary">
                CSV file (max 5 MB, 20,000 rows)
                <input
                  type="file"
                  name="file"
                  accept=".csv,.txt,text/csv,text/plain"
                  required
                  className="rounded-control border border-strongline bg-raised px-3 py-2 text-[13px] text-ink file:mr-3 file:rounded-control file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-accent"
                />
              </label>
              <Button type="submit" className="self-start">
                Upload &amp; continue
              </Button>
            </form>
            <p className="text-[11.5px] text-ink-muted">
              Supported: comma/semicolon/tab-separated exports, UTF-8 or legacy encodings, signed
              amounts or debit/credit columns. We keep only the rows and metadata needed for the
              import, review, and undo — never the original file.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
