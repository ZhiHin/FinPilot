import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { MarkAllReadButton, NotificationRowActions } from "@/features/notifications/controls";
import { cn } from "@/lib/cn";
import { localDateInTz } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { notificationsService } from "@/server/services/notifications";

export const metadata: Metadata = { title: t("nav.notifications") };

function SeverityBadge({ severity }: { severity: "info" | "attention" | "risk" }) {
  switch (severity) {
    case "risk":
      return <Badge variant="risk">Needs attention</Badge>;
    case "attention":
      return <Badge variant="attention">Worth a look</Badge>;
    default:
      return <Badge variant="info">Info</Badge>;
  }
}

export default async function NotificationsPage() {
  const { user } = await requireUser();
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");

  // Idempotent, deduplicated, quiet-hours-aware generation on every visit.
  await notificationsService.generate(db, user.id, { today });
  const notifications = await notificationsService.list(db, user.id);
  const unread = notifications.filter((n) => n.readAt === null);
  const read = notifications.filter((n) => n.readAt !== null);

  return (
    <>
      <PageHeader
        title={t("nav.notifications")}
        description="Deduplicated, deterministic alerts — each one appears once, ever. Tune thresholds and quiet hours in Settings."
        actions={unread.length > 0 ? <MarkAllReadButton /> : undefined}
      />

      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-ink-muted">
          <Link href="/settings/notifications" className="font-medium text-accent underline">
            Notification settings
          </Link>{" "}
          — thresholds, per-type switches, quiet hours.
        </p>

        {notifications.length === 0 ? (
          <EmptyState
            title="All quiet"
            description="Nothing needs your attention. Bill clusters, subscription price changes, budget pace, and goals falling behind will appear here — once each, never repeated."
          />
        ) : (
          <>
            {[
              { label: "Unread", items: unread },
              { label: "Earlier", items: read },
            ]
              .filter((section) => section.items.length > 0)
              .map((section) => (
                <section
                  key={section.label}
                  aria-label={section.label}
                  className="flex flex-col gap-2"
                >
                  <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
                    {section.label}
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {section.items.map((notification) => (
                      <li
                        key={notification.id}
                        className={cn(
                          "rounded-card border border-hairline bg-card p-4",
                          notification.readAt === null && "border-strongline",
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-ink">{notification.title}</span>
                              <SeverityBadge severity={notification.severity} />
                            </p>
                            <p className="mt-1 text-[13px] text-ink-secondary">
                              {notification.body}
                            </p>
                            {notification.href ? (
                              <Link
                                href={notification.href}
                                className="mt-1 inline-block text-[13px] font-medium text-accent underline underline-offset-2"
                              >
                                Open
                              </Link>
                            ) : null}
                          </div>
                          <NotificationRowActions
                            notificationId={notification.id}
                            isUnread={notification.readAt === null}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </>
        )}
      </div>
    </>
  );
}
