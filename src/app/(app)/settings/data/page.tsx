import type { Metadata } from "next";
import Link from "next/link";

import { Banner } from "@/components/ui/banner";
import { DeleteAccountCard, ExportCard } from "@/features/settings/data-panels";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { ACCOUNT_EXPORTS_PER_HOUR } from "@/server/services/exports";

export const metadata: Metadata = { title: t("settings.data.title") };

export default async function DataSettingsPage() {
  await requireUser();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section
        aria-labelledby="export-heading"
        className="flex flex-col gap-2 rounded-card border border-hairline bg-card p-5"
      >
        <h2 id="export-heading" className="text-[19px] font-semibold text-ink">
          Export your data
        </h2>
        <p className="text-[13px] leading-6 text-ink-secondary">
          One ZIP with a CSV per record type — accounts, transactions, budgets, goals, recurring,
          scenarios, journal, and more — plus your profile and a manifest. Cells are protected
          against spreadsheet formula injection, every export is recorded in your audit trail, and
          exports are limited to {ACCOUNT_EXPORTS_PER_HOUR} per hour. See the{" "}
          <Link
            href="/legal/privacy"
            className="text-accent underline underline-offset-2 hover:no-underline"
          >
            privacy notice
          </Link>{" "}
          for how your data is handled.
        </p>
        <ExportCard />
      </section>

      <section
        aria-labelledby="retention-heading"
        className="flex flex-col gap-2 rounded-card border border-hairline bg-card p-5"
      >
        <h2 id="retention-heading" className="text-[19px] font-semibold text-ink">
          Data retention
        </h2>
        <p className="text-[13px] leading-6 text-ink-secondary">
          Everything you enter stays until you delete it or your account. Uploaded statement files
          are never stored — only the rows you confirmed during import.
        </p>
        <Banner variant="info">
          Planned: a configurable retention window that trims old transaction history while keeping
          balances correct. Not built yet — nothing here is simulated.
        </Banner>
      </section>

      <section
        aria-labelledby="deletion-heading"
        className="flex flex-col gap-2 rounded-card border border-risk-soft bg-card p-5 lg:col-span-2"
      >
        <h2 id="deletion-heading" className="text-[19px] font-semibold text-ink">
          Delete your account
        </h2>
        <p className="text-[13px] leading-6 text-ink-secondary">
          Deletion is staged: your account deactivates immediately, stays recoverable for 30 days
          (just sign back in), then a final purge permanently erases every record you own. Each step
          is audited.
        </p>
        <DeleteAccountCard />
      </section>
    </div>
  );
}
