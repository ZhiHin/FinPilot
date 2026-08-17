import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./identity";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Phase 9 simulation & journal domain (ERD §3). The binding invariant (spec
 * V1): scenario simulation READS real data but NEVER writes to the ledger —
 * scenario output lives entirely in `scenarios`/`scenario_events` and computed
 * projections. Journal entries annotate periods/decisions; entries with
 * `exclude_from_baselines` change anomaly/budget-suggestion/forecast baselines
 * deterministically (spec V2) and never alter the ledger either.
 */

export const scenarioStatusEnum = pgEnum("scenario_status", ["draft", "saved", "archived"]);

export const scenarioEventTypeEnum = pgEnum("scenario_event_type", [
  "one_time_expense",
  "income_change",
  "rent_change",
  "cancel_recurring",
  "add_installment",
  "savings_change",
  "emergency_expense",
]);

export const journalKindEnum = pgEnum("journal_kind", ["life_event", "decision", "note"]);

export const scenarios = pgTable(
  "scenarios",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: scenarioStatusEnum("status").notNull().default("draft"),
    /** Buffer / income-confidence overrides for the simulation (Zod-validated). */
    assumptions: jsonb("assumptions")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** When the baseline snapshot was last taken ("based on data as of …"). */
    baseSnapshotAt: timestamptz("base_snapshot_at").notNull().defaultNow(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    deletedAt: timestamptz("deleted_at"),
  },
  (t) => [
    // Saved scenarios need distinct names; drafts may share the placeholder.
    uniqueIndex("scenarios_user_saved_name_unique")
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL AND ${t.status} = 'saved'`),
    index("scenarios_user_status_idx").on(t.userId, t.status),
    check("scenarios_name_not_empty", sql`length(trim(${t.name})) > 0`),
  ],
);

export const scenarioEvents = pgTable(
  "scenario_events",
  {
    id: uuid("id").primaryKey(),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: scenarioEventTypeEnum("event_type").notNull(),
    effectiveOn: date("effective_on").notNull(),
    /** Signed minor units; null for events whose amount lives in params. */
    amountMinor: bigint("amount_minor", { mode: "number" }),
    recurrence: jsonb("recurrence"),
    /** Referenced real entities (categoryId / patternId / goalId) — read-only. */
    refs: jsonb("refs")
      .notNull()
      .default(sql`'{}'::jsonb`),
    params: jsonb("params")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("scenario_events_scenario_idx").on(t.scenarioId, t.effectiveOn)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: journalKindEnum("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    /** Spec V2: excluded periods leave anomaly/suggestion/forecast baselines. */
    excludeFromBaselines: boolean("exclude_from_baselines").notNull().default(false),
    /** e.g. { "saveMinorPerMonth": 9000, "note": "cancel Netflix" }. */
    expectedOutcome: jsonb("expected_outcome"),
    reviewOn: date("review_on"),
    /** Filled at review: { verdict: happened|partly|no, note, reviewedAt }. */
    outcomeReview: jsonb("outcome_review"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    deletedAt: timestamptz("deleted_at"),
  },
  (t) => [
    index("journal_entries_user_period_idx").on(t.userId, t.startsOn),
    check("journal_entries_title_not_empty", sql`length(trim(${t.title})) > 0`),
    check("journal_entries_period_valid", sql`${t.endsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`),
  ],
);

export const journalLinks = pgTable(
  "journal_links",
  {
    id: uuid("id").primaryKey(),
    journalEntryId: uuid("journal_entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("journal_links_entry_entity_unique").on(t.journalEntryId, t.entityType, t.entityId),
    index("journal_links_entity_idx").on(t.userId, t.entityType, t.entityId),
    check(
      "journal_links_entity_type_valid",
      sql`${t.entityType} IN ('transaction', 'category', 'recurring_pattern', 'scenario')`,
    ),
  ],
);
