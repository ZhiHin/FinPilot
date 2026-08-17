import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./identity";
import { accounts, categories, merchants } from "./ledger";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Phase 6 recurring domain (ERD §3): detected/confirmed recurring patterns,
 * their subscription extension (1:1), and the deduplicated notification
 * centre. Deviation from the ERD, recorded: `confidence` is stored as integer
 * basis points (0–10000) instead of numeric 0..1 — every other ratio in the
 * codebase is integer bp (ADR-003 integer-math discipline).
 */

export const recurringDirectionEnum = pgEnum("recurring_direction", ["inflow", "outflow"]);

export const recurringFrequencyEnum = pgEnum("recurring_frequency", [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annual",
  "custom",
]);

export const recurringSourceEnum = pgEnum("recurring_source", ["user_confirmed", "inferred"]);

export const recurringStatusEnum = pgEnum("recurring_status", ["active", "paused", "ended"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "trial",
  "canceled",
  "unknown",
]);

export const notificationSeverityEnum = pgEnum("notification_severity", [
  "info",
  "attention",
  "risk",
]);

export const recurringPatterns = pgTable(
  "recurring_patterns",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    direction: recurringDirectionEnum("direction").notNull(),
    frequency: recurringFrequencyEnum("frequency").notNull(),
    /** Day rules / interval details for custom schedules (Zod-validated). */
    schedule: jsonb("schedule")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Positive magnitude; `direction` carries the sign semantics. */
    typicalAmountMinor: bigint("typical_amount_minor", { mode: "number" }).notNull(),
    amountToleranceMinor: bigint("amount_tolerance_minor", { mode: "number" }).notNull().default(0),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    nextExpectedOn: date("next_expected_on").notNull(),
    lastSeenOn: date("last_seen_on"),
    /** Basis points 0–10000; inference caps at 9500, confirmation = 10000. */
    confidenceBp: integer("confidence_bp").notNull().default(0),
    source: recurringSourceEnum("source").notNull().default("inferred"),
    status: recurringStatusEnum("status").notNull().default("active"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    isInstallment: boolean("is_installment").notNull().default(false),
    /** BNPL total is an ESTIMATE until the user confirms it. */
    installmentsTotal: integer("installments_total"),
    installmentsObserved: integer("installments_observed").notNull().default(0),
    /**
     * Detector idempotency: stable key derived from merchant/normalized
     * description + frequency. Null for user-created custom patterns.
     */
    inferenceKey: text("inference_key"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("recurring_user_inference_unique")
      .on(t.userId, t.inferenceKey)
      .where(sql`${t.inferenceKey} IS NOT NULL`),
    index("recurring_user_next_idx").on(t.userId, t.nextExpectedOn),
    check("recurring_amount_positive", sql`${t.typicalAmountMinor} > 0`),
    check("recurring_tolerance_non_negative", sql`${t.amountToleranceMinor} >= 0`),
    check("recurring_confidence_range", sql`${t.confidenceBp} BETWEEN 0 AND 10000`),
    check(
      "recurring_installments_valid",
      sql`${t.installmentsObserved} >= 0 AND (${t.installmentsTotal} IS NULL OR (${t.installmentsTotal} > 0 AND ${t.installmentsObserved} <= ${t.installmentsTotal}))`,
    ),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey(),
    recurringPatternId: uuid("recurring_pattern_id")
      .notNull()
      .references(() => recurringPatterns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    serviceName: text("service_name").notNull(),
    billingCycle: text("billing_cycle").notNull().default("monthly"),
    currentPriceMinor: bigint("current_price_minor", { mode: "number" }).notNull(),
    previousPriceMinor: bigint("previous_price_minor", { mode: "number" }),
    priceChangedAt: timestamptz("price_changed_at"),
    /** Evidence counts for the price change ("RM 16.90 ×5 → RM 23.90 ×2"). */
    priceEvidence: jsonb("price_evidence"),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    /** User-stated only — we never infer whether they still use a service. */
    usageConfirmedAt: timestamptz("usage_confirmed_at"),
    renewalDate: date("renewal_date"),
    priceChangeAcknowledgedAt: timestamptz("price_change_acknowledged_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("subscriptions_pattern_unique").on(t.recurringPatternId),
    check("subscriptions_price_positive", sql`${t.currentPriceMinor} > 0`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    severity: notificationSeverityEnum("severity").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Deep-link refs (same-app hrefs, entity ids) — validated before render. */
    data: jsonb("data")
      .notNull()
      .default(sql`'{}'::jsonb`),
    dedupKey: text("dedup_key").notNull(),
    readAt: timestamptz("read_at"),
    dismissedAt: timestamptz("dismissed_at"),
    /** In-app now; the shape is email-ready (channel, sentAt) for post-V1. */
    delivery: jsonb("delivery")
      .notNull()
      .default(sql`'{"channel":"in_app"}'::jsonb`),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Dedup guarantee (ERD §4): at most one live notification per key. The
    // service additionally never re-creates a key that was dismissed.
    uniqueIndex("notifications_user_dedup_unique")
      .on(t.userId, t.dedupKey)
      .where(sql`${t.dismissedAt} IS NULL`),
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_user_unread_idx")
      .on(t.userId, t.createdAt)
      .where(sql`${t.readAt} IS NULL AND ${t.dismissedAt} IS NULL`),
  ],
);
