import { isNull, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { auditActorEnum, budgetStyleEnum, themePreferenceEnum, userStatusEnum } from "./enums";

/** Case-insensitive text (PostgreSQL citext extension, created in migration 0000). */
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: citext("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),
    emailVerifiedAt: timestamptz("email_verified_at"),
    status: userStatusEnum("status").notNull().default("active"),
    purgeAfter: timestamptz("purge_after"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    deletedAt: timestamptz("deleted_at"),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email).where(isNull(t.deletedAt)),
    check(
      "users_purge_after_required",
      sql`${t.status} <> 'pending_purge' OR ${t.purgeAfter} IS NOT NULL`,
    ),
  ],
);

export const userPreferences = pgTable(
  "user_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    locale: text("locale").notNull().default("en-MY"),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    timezone: text("timezone").notNull().default("Asia/Kuala_Lumpur"),
    theme: themePreferenceEnum("theme").notNull().default("system"),
    incomePattern: jsonb("income_pattern"),
    safetyBufferMinor: bigint("safety_buffer_minor", { mode: "number" }).notNull().default(0),
    budgetStyle: budgetStyleEnum("budget_style"),
    privacyMode: boolean("privacy_mode").notNull().default(false),
    aiConsentAt: timestamptz("ai_consent_at"),
    notificationPrefs: jsonb("notification_prefs")
      .notNull()
      .default(sql`'{}'::jsonb`),
    onboardingState: jsonb("onboarding_state")
      .notNull()
      .default(sql`'{}'::jsonb`),
    dataRetentionMonths: integer("data_retention_months"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("user_preferences_buffer_non_negative", sql`${t.safetyBufferMinor} >= 0`),
    check(
      "user_preferences_retention_positive",
      sql`${t.dataRetentionMonths} IS NULL OR ${t.dataRetentionMonths} > 0`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    revokedAt: timestamptz("revoked_at"),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    index("sessions_user_expiry_idx").on(t.userId, t.expiresAt),
    check("sessions_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    usedAt: timestamptz("used_at"),
  },
  (t) => [
    uniqueIndex("password_reset_tokens_hash_unique").on(t.tokenHash),
    index("password_reset_tokens_user_idx").on(t.userId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    actor: auditActorEnum("actor").notNull().default("user"),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    diff: jsonb("diff"),
    ipHash: text("ip_hash"),
    // Salted hash of the acted-on identifier (e.g. normalized email) so login rate
    // limiting can query failures without storing raw identifiers.
    subjectHash: text("subject_hash"),
    userAgent: text("user_agent"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_user_created_idx").on(t.userId, t.createdAt),
    index("audit_logs_event_subject_idx").on(t.eventType, t.subjectHash, t.createdAt),
    index("audit_logs_event_ip_idx").on(t.eventType, t.ipHash, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);
