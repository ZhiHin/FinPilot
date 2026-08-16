import type { Metadata } from "next";

import { Banner } from "@/components/ui/banner";
import { SecuritySessions, type SessionView } from "@/features/settings/security-sessions";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getAuthService } from "@/server/auth/instance";

export const metadata: Metadata = { title: t("settings.security.title") };

export default async function SecuritySettingsPage() {
  const { user, session } = await requireUser();
  const sessions = await getAuthService().listSessions(user.id);
  const views: SessionView[] = sessions.map((s) => ({
    id: s.id,
    createdAtIso: s.createdAt.toISOString(),
    lastSeenAtIso: s.lastSeenAt.toISOString(),
    userAgent: s.userAgent,
    isCurrent: s.id === session.id,
  }));

  return (
    <div className="flex flex-col gap-6">
      <Banner variant="info">
        Passkeys, multi-factor authentication, and social login are planned as future-ready
        architecture — email &amp; password with hardened sessions is the Phase 1 scope.
      </Banner>
      <section aria-labelledby="sessions-heading">
        <h2 id="sessions-heading" className="mb-4 text-[19px] font-semibold text-ink">
          Active sessions
        </h2>
        <SecuritySessions sessions={views} />
      </section>
    </div>
  );
}
