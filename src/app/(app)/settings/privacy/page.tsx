import type { Metadata } from "next";

import { Banner } from "@/components/ui/banner";
import { PrivacyForm } from "@/features/settings/forms";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";

export const metadata: Metadata = { title: t("settings.privacy.title") };

export default async function PrivacySettingsPage() {
  const { user } = await requireUser();
  const prefs = await preferencesRepo.get(getDb(), user.id);

  return (
    <div className="flex flex-col gap-6">
      <PrivacyForm privacyMode={prefs?.privacyMode ?? false} />
      <section aria-labelledby="ai-disclosure-heading" className="flex flex-col gap-3">
        <h2 id="ai-disclosure-heading" className="text-[19px] font-semibold text-ink">
          What uses external AI?
        </h2>
        <p className="text-[13px] leading-6 text-ink-secondary">
          Nothing yet. Phases 1–7 are fully deterministic — no data leaves your database. When the
          generative layer arrives (Phase 8: insight phrasing, the assistant, suggested actions),
          this page will list each feature, the exact data shape it sends, and the configured
          provider — and each requires your explicit consent first. Deterministic alternatives keep
          working with Privacy Mode on.
        </p>
        <Banner variant="info">
          The AI provider is chosen by configuration in Phase 8 — FinPilot is not tied to any
          provider (architecture decision ADR-012).
        </Banner>
      </section>
    </div>
  );
}
