import type { Metadata } from "next";

import { PlaceholderPage } from "@/features/shell/placeholder-page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.scenarios") };

export default function ScenariosPage() {
  return (
    <PlaceholderPage
      title={t("nav.scenarios")}
      description="Test financial decisions before making them."
      phase={9}
      phaseScope="Scenario Lab & Decision Journal"
    />
  );
}
