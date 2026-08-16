import type { Metadata } from "next";

import { PlaceholderPage } from "@/features/shell/placeholder-page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.insights") };

export default function InsightsPage() {
  return (
    <PlaceholderPage
      title={t("nav.insights")}
      description="Explainable insights, the assistant, and the suggestion queue."
      phase={8}
      phaseScope="explainable AI & assistant"
    />
  );
}
