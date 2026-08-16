import type { Metadata } from "next";

import { PlaceholderPage } from "@/features/shell/placeholder-page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.notifications") };

export default function NotificationsPage() {
  return (
    <PlaceholderPage
      title={t("nav.notifications")}
      description="Calm, deduplicated alerts you can tune."
      phase={6}
      phaseScope="recurring & notifications"
    />
  );
}
