import type { Metadata } from "next";

import { PlaceholderPage } from "@/features/shell/placeholder-page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.analytics") };

export default function AnalyticsPage() {
  return (
    <PlaceholderPage
      title={t("nav.analytics")}
      description="Answer your money questions with flexible analysis."
      phase={4}
      phaseScope="dashboard & analytics"
    />
  );
}
