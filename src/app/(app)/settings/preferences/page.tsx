import type { Metadata } from "next";

import { PreferencesForm } from "@/features/settings/forms";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";

export const metadata: Metadata = { title: t("settings.preferences.title") };

export default async function PreferencesSettingsPage() {
  const { user } = await requireUser();
  const prefs = await preferencesRepo.get(getDb(), user.id);
  return (
    <PreferencesForm
      locale={prefs?.locale ?? "en-MY"}
      currency={(prefs?.currency ?? "MYR").trim()}
      timezone={prefs?.timezone ?? "Asia/Kuala_Lumpur"}
      theme={prefs?.theme ?? "system"}
    />
  );
}
