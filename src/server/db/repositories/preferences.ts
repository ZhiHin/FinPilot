import { eq, sql } from "drizzle-orm";

import type { Db } from "../client";
import { userPreferences } from "../schema";

export type PreferencesRow = typeof userPreferences.$inferSelect;

/**
 * Patch shape for preference updates. userId deliberately absent: the row is always
 * addressed by the authenticated user id, never by anything client-supplied.
 */
export type PreferencesPatch = Partial<
  Pick<
    PreferencesRow,
    | "locale"
    | "currency"
    | "timezone"
    | "theme"
    | "incomePattern"
    | "safetyBufferMinor"
    | "budgetStyle"
    | "privacyMode"
    | "aiConsentAt"
    | "notificationPrefs"
    | "onboardingState"
    | "dataRetentionMonths"
  >
>;

export const preferencesRepo = {
  /** Creates the en-MY / MYR / Kuala Lumpur defaults for a new user. */
  async createDefaults(
    db: Db,
    userId: string,
    overrides: PreferencesPatch = {},
  ): Promise<PreferencesRow> {
    const [row] = await db
      .insert(userPreferences)
      .values({ userId, ...overrides })
      .returning();
    return row;
  },

  async get(db: Db, userId: string): Promise<PreferencesRow | null> {
    const [row] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    return row ?? null;
  },

  async update(db: Db, userId: string, patch: PreferencesPatch): Promise<PreferencesRow | null> {
    const [row] = await db
      .update(userPreferences)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(userPreferences.userId, userId))
      .returning();
    return row ?? null;
  },
} as const;
