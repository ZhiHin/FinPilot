import { SettingsNav } from "@/features/settings/settings-nav";
import { PageHeader } from "@/components/ui/page-header";
import { t } from "@/lib/i18n";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title={t("settings.title")} />
      {/* Nav sits beside the content on wide screens so the page uses its
          full width instead of leaving a dead column on the right. */}
      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
