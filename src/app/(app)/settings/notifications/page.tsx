import type { Metadata } from "next";

import { NotificationsForm } from "@/features/settings/forms";
import { t } from "@/lib/i18n";
import { minorToAmountInput } from "@/lib/money";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import type { NotificationPrefs } from "@/server/services/notifications";

export const metadata: Metadata = { title: t("settings.notifications.title") };

export default async function NotificationsSettingsPage() {
  const { user } = await requireUser();
  const prefs = await preferencesRepo.get(getDb(), user.id);
  const np = (prefs?.notificationPrefs ?? {}) as NotificationPrefs;
  return (
    <NotificationsForm
      digestFrequency={np.digestFrequency ?? "weekly"}
      quietHoursStart={np.quietHoursStart ?? ""}
      quietHoursEnd={np.quietHoursEnd ?? ""}
      largeBill={
        np.largeBillMinor !== undefined ? minorToAmountInput(np.largeBillMinor, "MYR") : ""
      }
      types={np.types ?? {}}
    />
  );
}
