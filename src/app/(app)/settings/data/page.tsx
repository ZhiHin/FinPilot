import type { Metadata } from "next";

import { Banner } from "@/components/ui/banner";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";

export const metadata: Metadata = { title: t("settings.data.title") };

export default async function DataSettingsPage() {
  await requireUser();
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="export-heading" className="flex flex-col gap-2">
        <h2 id="export-heading" className="text-[19px] font-semibold text-ink">
          Export your data
        </h2>
        <p className="text-[13px] leading-6 text-ink-secondary">
          Full CSV export of everything you own — formula-injection-safe and audited.
        </p>
        <Banner variant="info">Arrives in Phase 10 (hardening &amp; release readiness).</Banner>
      </section>
      <section aria-labelledby="retention-heading" className="flex flex-col gap-2">
        <h2 id="retention-heading" className="text-[19px] font-semibold text-ink">
          Retention &amp; account deletion
        </h2>
        <p className="text-[13px] leading-6 text-ink-secondary">
          Staged deletion: deactivate → 30-day recovery window → final purge, every step audited.
          Configurable data retention for transaction history.
        </p>
        <Banner variant="info">Arrives in Phase 10. Nothing here is simulated.</Banner>
      </section>
    </div>
  );
}
