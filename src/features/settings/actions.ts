"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { uuidv7 } from "@/lib/ids";
import { ok, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { usersRepo } from "@/server/db/repositories/users";

import {
  notificationPrefsSchema,
  preferencesSchema,
  privacySchema,
  profileSchema,
} from "./schemas";

export type SettingsFormState = Result<{ message?: string }> | null;

async function auditSettings(userId: string, eventType: string): Promise<void> {
  await auditRepo.record(getDb(), {
    id: uuidv7(),
    userId,
    actor: "user",
    eventType,
    entityType: "user_preferences",
  });
}

export async function updateProfileAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const { user } = await requireUser();
  const parsed = profileSchema.safeParse({ displayName: formData.get("displayName") ?? "" });
  if (!parsed.success) return zodToErr(parsed.error);

  await usersRepo.updateDisplayName(getDb(), user.id, parsed.data.displayName || null);
  await auditSettings(user.id, "settings.profile_updated");
  revalidatePath("/", "layout");
  return ok({ message: "Profile saved." });
}

export async function updatePreferencesAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const { user } = await requireUser();
  const parsed = preferencesSchema.safeParse({
    locale: formData.get("locale"),
    currency: formData.get("currency"),
    timezone: formData.get("timezone"),
    theme: formData.get("theme"),
  });
  if (!parsed.success) return zodToErr(parsed.error);

  await preferencesRepo.update(getDb(), user.id, parsed.data);
  await auditSettings(user.id, "settings.preferences_updated");
  revalidatePath("/", "layout");
  return ok({ message: "Preferences saved." });
}

export async function updatePrivacyAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const { user } = await requireUser();
  const parsed = privacySchema.safeParse({ privacyMode: formData.get("privacyMode") === "on" });
  if (!parsed.success) return zodToErr(parsed.error);

  await preferencesRepo.update(getDb(), user.id, { privacyMode: parsed.data.privacyMode });
  // Consent changes are always audited (spec §6 G6).
  await auditSettings(user.id, "consent.privacy_mode_updated");
  revalidatePath("/settings/privacy");
  return ok({ message: parsed.data.privacyMode ? "Privacy Mode is on." : "Privacy Mode is off." });
}

const themeSchema = z.enum(["system", "light", "dark"]);

/** Quick theme switch from the header — same persistence as the preferences form. */
export async function updateThemeAction(theme: unknown): Promise<void> {
  const { user } = await requireUser();
  const parsed = themeSchema.safeParse(theme);
  if (!parsed.success) return;
  await preferencesRepo.update(getDb(), user.id, { theme: parsed.data });
  revalidatePath("/", "layout");
}

export async function updateNotificationsAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const { user } = await requireUser();
  const parsed = notificationPrefsSchema.safeParse({
    digestFrequency: formData.get("digestFrequency"),
    quietHoursStart: formData.get("quietHoursStart") ?? "",
    quietHoursEnd: formData.get("quietHoursEnd") ?? "",
  });
  if (!parsed.success) return zodToErr(parsed.error);

  await preferencesRepo.update(getDb(), user.id, {
    notificationPrefs: {
      digestFrequency: parsed.data.digestFrequency,
      quietHoursStart: parsed.data.quietHoursStart || null,
      quietHoursEnd: parsed.data.quietHoursEnd || null,
    },
  });
  await auditSettings(user.id, "settings.notifications_updated");
  return ok({ message: "Notification preferences saved." });
}
