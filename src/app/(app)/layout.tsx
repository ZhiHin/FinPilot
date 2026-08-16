import { PrivacyToggle } from "@/components/shell/privacy-toggle";
import { AppShell } from "@/components/shell/app-shell";
import { SkipLink } from "@/components/ui/skip-link";
import { getPrimaryNav, getSecondaryNav } from "@/features/shell/nav";
import { ThemeToggle } from "@/features/shell/theme-toggle";
import { UserMenu } from "@/features/shell/user-menu";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Database-backed session check on every protected request.
  const { user } = await requireUser();
  const prefs = await preferencesRepo.get(getDb(), user.id);

  return (
    <>
      <SkipLink label={t("nav.skipToContent")} />
      <AppShell
        navPrimary={getPrimaryNav()}
        navSecondary={getSecondaryNav()}
        headerControls={
          <>
            <PrivacyToggle
              hideLabel={t("privacy.hideAmounts")}
              showLabel={t("privacy.showAmounts")}
            />
            <ThemeToggle current={prefs?.theme ?? "system"} />
          </>
        }
        userMenu={<UserMenu name={user.displayName ?? ""} email={user.email} />}
      >
        {children}
      </AppShell>
    </>
  );
}
