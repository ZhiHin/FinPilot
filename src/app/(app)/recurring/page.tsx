import type { Metadata } from "next";

import { PlaceholderPage } from "@/features/shell/placeholder-page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.recurring") };

export default function RecurringPage() {
  return (
    <PlaceholderPage
      title={t("nav.recurring")}
      description="Bills, subscriptions, and installments before they surprise you."
      phase={6}
      phaseScope="recurring & notifications"
    />
  );
}
