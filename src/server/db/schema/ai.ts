import { sql } from "drizzle-orm";
import {
  check,
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
import { insights } from "./intel";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Phase 8 AI domain (ERD §3). Hard boundaries hold at the schema level too:
 * - `ai_suggestions` is the ACTION QUEUE — the only path by which any AI
 *   output may lead to a data change, and only via explicit user approval
 *   (spec B4). The proposed change is an exact, Zod-validated patch.
 * - `ai_requests` is metadata-only telemetry (tokens, duration, status,
 *   redacted error) — never raw prompts or financial payloads.
 * - Deviation recorded (consistent with Phases 6–7): confidence is stored as
 *   integer basis points, not numeric 0..1 (ADR-003 integer discipline).
 */

export const aiSuggestionKindEnum = pgEnum("ai_suggestion_kind", [
  "category_correction",
  "merchant_rule",
  "budget_change",
  "subscription_detect",
  "duplicate_txn",
  "refund_match",
  "goal_adjustment",
]);

export const aiSuggestionStatusEnum = pgEnum("ai_suggestion_status", [
  "pending",
  "approved",
  "edited",
  "dismissed",
  "snoozed",
  "expired",
]);

export const aiSourceEnum = pgEnum("ai_source", ["deterministic", "model", "generative"]);

export const aiFeedbackVerdictEnum = pgEnum("ai_feedback_verdict", [
  "helpful",
  "not_helpful",
  "wrong",
]);

export const aiRequestStatusEnum = pgEnum("ai_request_status", [
  "ok",
  "error",
  "refused",
  "fallback",
]);

export const aiSuggestions = pgTable(
  "ai_suggestions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: aiSuggestionKindEnum("kind").notNull(),
    targetEntityType: text("target_entity_type").notNull(),
    targetEntityId: uuid("target_entity_id"),
    /** The exact patch that Approve applies — Zod-validated before write. */
    proposedChange: jsonb("proposed_change").notNull(),
    rationale: text("rationale").notNull(),
    confidenceBp: integer("confidence_bp").notNull().default(0),
    /** Verified numbers / reason codes only. */
    evidence: jsonb("evidence")
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: aiSuggestionStatusEnum("status").notNull().default("pending"),
    snoozedUntil: timestamptz("snoozed_until"),
    resolvedAt: timestamptz("resolved_at"),
    source: aiSourceEnum("source").notNull().default("deterministic"),
    modelVersion: text("model_version"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    // One live suggestion per kind + target (idempotent producers).
    uniqueIndex("ai_suggestions_live_target_unique")
      .on(t.userId, t.kind, t.targetEntityId)
      .where(sql`${t.status} IN ('pending', 'snoozed') AND ${t.targetEntityId} IS NOT NULL`),
    index("ai_suggestions_user_status_idx").on(t.userId, t.status, t.createdAt),
    check("ai_suggestions_confidence_range", sql`${t.confidenceBp} BETWEEN 0 AND 10000`),
  ],
);

export const aiFeedback = pgTable(
  "ai_feedback",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    suggestionId: uuid("suggestion_id").references(() => aiSuggestions.id, {
      onDelete: "cascade",
    }),
    insightId: uuid("insight_id").references(() => insights.id, { onDelete: "cascade" }),
    verdict: aiFeedbackVerdictEnum("verdict").notNull(),
    reasonCode: text("reason_code"),
    comment: text("comment"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_feedback_user_idx").on(t.userId, t.createdAt),
    // ERD §4: exactly one of suggestion_id / insight_id is set.
    check(
      "ai_feedback_exactly_one_target",
      sql`(${t.suggestionId} IS NULL) <> (${t.insightId} IS NULL)`,
    ),
  ],
);

export const aiRequests = pgTable(
  "ai_requests",
  {
    id: uuid("id").primaryKey(),
    /** Nullable for system-initiated calls. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    feature: text("feature").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    status: aiRequestStatusEnum("status").notNull(),
    /** Redacted message only — never prompts, never financial payloads. */
    errorRedacted: text("error_redacted"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("ai_requests_user_created_idx").on(t.userId, t.createdAt)],
);
