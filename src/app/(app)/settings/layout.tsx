import { SettingsNav } from "@/features/settings/settings-nav";
import { PageHeader } from "@/components/ui/page-header";
import { t } from "@/lib/i18n";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <SettingsNav />
      <div className="max-w-2xl">{children}</div>
    </>
  );
}
