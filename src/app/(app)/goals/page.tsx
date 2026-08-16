import type { Metadata } from "next";

import { PlaceholderPage } from "@/features/shell/placeholder-page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.goals") };

export default function GoalsPage() {
  return (
    <PlaceholderPage
      title={t("nav.goals")}
      description="Savings goals and sinking funds with honest forecasts."
      phase={5}
      phaseScope="budgets & goals"
    />
  );
}
