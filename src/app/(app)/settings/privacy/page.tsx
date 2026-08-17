import type { Metadata } from "next";

import { Banner } from "@/components/ui/banner";
import { AiConsentForm, PrivacyForm } from "@/features/settings/forms";
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
      <AiConsentForm
        consented={Boolean(prefs?.aiConsentAt)}
        privacyMode={prefs?.privacyMode ?? false}
      />
      <section aria-labelledby="ai-disclosure-heading" className="flex flex-col gap-3">
        <h2 id="ai-disclosure-heading" className="text-[19px] font-semibold text-ink">
          What uses external AI?
        </h2>
        <p className="text-[13px] leading-6 text-ink-secondary">
          With consent granted and Privacy Mode off, exactly two features may call the configured
          provider: <strong>insight phrasing</strong> (sends the already-computed insight sentence
          and its verified numbers — never raw transactions) and the <strong>assistant</strong>{" "}
          (sends your question and pre-aggregated tool results — never raw tables, never other
          users’ data). Every call is metadata-logged on the AI activity page, every generated
          number is verified against deterministic math before display, and category suggestions
          never use an LLM at all (rules + a statistical scorer over your own history).
        </p>
        <Banner variant="info">
          The provider is bound only by configuration (ADR-012): <code>AI_PROVIDER</code> selects
          the adapter (the deterministic stub is the default; Anthropic is available via{" "}
          <code>ANTHROPIC_API_KEY</code>), and swapping providers changes nothing outside the
          adapter layer. Privacy Mode always wins: with it on, zero external AI calls are possible.
        </Banner>
      </section>
    </div>
  );
}
