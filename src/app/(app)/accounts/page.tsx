import type { Metadata } from "next";

import { PlaceholderPage } from "@/features/shell/placeholder-page";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.accounts") };

export default function AccountsPage() {
  return (
    <PlaceholderPage
      title={t("nav.accounts")}
      description="Your accounts, balances, and net position."
      phase={2}
      phaseScope="accounts, categories & transactions"
    />
  );
}
