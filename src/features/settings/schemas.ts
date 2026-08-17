import { z } from "zod";

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Phase 1 supports en-MY/MYR only; the enums widen when locales/FX land (post-V1). */
export const preferencesSchema = z.object({
  locale: z.enum(["en-MY"]),
  currency: z.enum(["MYR"]),
  timezone: z
    .string()
    .min(1, "Choose a timezone.")
    .max(64)
    .refine(isValidTimezone, "Choose a valid timezone."),
  theme: z.enum(["system", "light", "dark"]),
});

export const profileSchema = z.object({
  displayName: z.string().trim().max(80, "Keep your name under 80 characters."),
});

export const privacySchema = z.object({
  privacyMode: z.boolean(),
});

export const notificationPrefsSchema = z.object({
  digestFrequency: z.enum(["off", "daily", "weekly", "monthly"]),
  quietHoursStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM.")
    .optional()
    .or(z.literal("")),
  largeBill: z.string().optional().or(z.literal("")),
  quietHoursEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM.")
    .optional()
    .or(z.literal("")),
});

export const onboardingLocaleSchema = preferencesSchema.pick({
  locale: true,
  currency: true,
  timezone: true,
});

export const onboardingBufferSchema = z.object({
  budgetStyle: z.enum(["fixed", "flexible", "rollover", "zero_based"]),
  /** Raw user input like "300" or "RM 300.00" — parsed to minor units in the action. */
  safetyBuffer: z.string().trim().max(20),
});
