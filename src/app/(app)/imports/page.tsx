import type { Metadata } from "next";

import { PlaceholderPage } from "@/features/shell/placeholder-page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.imports") };

export default function ImportsPage() {
  return (
    <PlaceholderPage
      title={t("nav.imports")}
      description="Bring in bank and e-wallet statements safely."
      phase={3}
      phaseScope="CSV import & data quality"
    />
  );
}
