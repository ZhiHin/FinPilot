import { sql } from "drizzle-orm";
import {
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
import { notificationSeverityEnum } from "./recurring";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Phase 7 intelligence domain (ERD §3): the derived-result cache (`forecasts`,
 * ADR-015 — cached, invalidated by inputs hash, never trusted as source of
 * truth) and deterministic insight records with verified evidence. Deviation
 * from the ERD, recorded: `confidence` is integer basis points (0–10000), per
 * the ADR-003 integer-math discipline (same deviation as recurring patterns).
 * `generated_by` is always 'deterministic' in Phase 7 — the generative value
 * and the model/prompt columns activate in Phase 8.
 */

export const forecastKindEnum = pgEnum("forecast_kind", [
  "cash_flow",
  "category_spend",
  "goal_projection",
  "safe_to_spend",
]);

export const insightStatusEnum = pgEnum("insight_status", ["new", "read", "dismissed", "actioned"]);

export const insightGeneratedByEnum = pgEnum("insight_generated_by", [
  "deterministic",
  "generative",
]);

export const forecasts = pgTable(
  "forecasts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: forecastKindEnum("kind").notNull(),
    /** Account set / category / goal the series covers (Zod-validated). */
    scope: jsonb("scope")
      .notNull()
      .default(sql`'{}'::jsonb`),
    horizonDays: integer("horizon_days").notNull(),
    /** Documented method id + version (e.g. "recurring+baseline" v1). */
    method: text("method").notNull(),
    methodVersion: text("method_version").notNull(),
    /** Dates × optimistic/expected/conservative — verified numbers only. */
    series: jsonb("series").notNull(),
    inputsHash: text("inputs_hash").notNull(),
    generatedAt: timestamptz("generated_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("forecasts_user_kind_hash_unique").on(t.userId, t.kind, t.inputsHash),
    index("forecasts_user_kind_idx").on(t.userId, t.kind),
    check("forecasts_horizon_valid", sql`${t.horizonDays} IN (30, 60, 90)`),
  ],
);

export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** spend_change|anomaly|low_balance|budget_suggestion|… (ERD open set). */
    type: text("type").notNull(),
    severity: notificationSeverityEnum("severity").notNull().default("info"),
    title: text("title").notNull(),
    /** Deterministic template text in Phase 7 (LLM phrasing arrives Phase 8). */
    body: text("body").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    /** Compared period + headline numbers (verified, minor units). */
    comparison: jsonb("comparison")
      .notNull()
      .default(sql`'{}'::jsonb`),
    confidenceBp: integer("confidence_bp").notNull().default(0),
    /** Warnings & exclusions, e.g. pending counts left out of the math. */
    dataQuality: jsonb("data_quality")
      .notNull()
      .default(sql`'{}'::jsonb`),
    generatedBy: insightGeneratedByEnum("generated_by").notNull().default("deterministic"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    status: insightStatusEnum("status").notNull().default("new"),
    /** One insight per producer + subject + period (idempotent generation). */
    dedupKey: text("dedup_key").notNull(),
    validUntil: timestamptz("valid_until"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("insights_user_dedup_unique").on(t.userId, t.dedupKey),
    index("insights_user_status_idx").on(t.userId, t.status, t.createdAt),
    check("insights_confidence_range", sql`${t.confidenceBp} BETWEEN 0 AND 10000`),
    check("insights_period_valid", sql`${t.periodEnd} >= ${t.periodStart}`),
  ],
);

export const insightEvidence = pgTable(
  "insight_evidence",
  {
    id: uuid("id").primaryKey(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insights.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** aggregate|calculation|transaction_set|category_delta|merchant_delta */
    evidenceType: text("evidence_type").notNull(),
    /** Verified numbers only — never free text from any model. */
    payload: jsonb("payload").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => [index("insight_evidence_insight_idx").on(t.insightId, t.displayOrder)],
);
