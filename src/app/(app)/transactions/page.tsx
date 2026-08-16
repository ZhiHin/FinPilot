import type { Metadata } from "next";

import { PlaceholderPage } from "@/features/shell/placeholder-page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.transactions") };

export default function TransactionsPage() {
  return (
    <PlaceholderPage
      title={t("nav.transactions")}
      description="Search, review, and correct every transaction."
      phase={2}
      phaseScope="accounts, categories & transactions"
    />
  );
}
