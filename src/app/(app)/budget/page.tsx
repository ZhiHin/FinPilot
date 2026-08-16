import type { Metadata } from "next";

import { PlaceholderPage } from "@/features/shell/placeholder-page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.budget") };

export default function BudgetPage() {
  return (
    <PlaceholderPage
      title={t("nav.budget")}
      description="Plan each cycle and stay on pace."
      phase={5}
      phaseScope="budgets & goals"
    />
  );
}
