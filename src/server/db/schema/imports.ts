import { sql } from "drizzle-orm";
import {
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
import { accounts, transactions } from "./ledger";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const importStatusEnum = pgEnum("import_status", [
  "uploaded",
  "mapping",
  "validating",
  "review",
  "committing",
  "completed",
  "failed",
  "canceled",
  "undone",
]);

export const importRowStatusEnum = pgEnum("import_row_status", [
  "pending",
  "valid",
  "invalid",
  "duplicate",
  "skipped",
  "committed",
]);

export const importProfiles = pgTable(
  "import_profiles",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sourceLabel: text("source_label"),
    /** Column mapping + date format + amount mode + header rows (Zod-validated). */
    mapping: jsonb("mapping").notNull(),
    lastUsedAt: timestamptz("last_used_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("import_profiles_user_name_unique").on(t.userId, sql`lower(${t.name})`)],
);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    importProfileId: uuid("import_profile_id").references(() => importProfiles.id, {
      onDelete: "set null",
    }),
    /** Sanitized display name only — the uploaded file itself is never stored. */
    filename: text("filename").notNull(),
    fileSha256: text("file_sha256"),
    encoding: text("encoding"),
    delimiter: text("delimiter"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: importStatusEnum("status").notNull().default("mapping"),
    mapping: jsonb("mapping"),
    rowCount: integer("row_count").notNull().default(0),
    stats: jsonb("stats")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** User-safe error only — never raw driver/parser output. */
    error: text("error"),
    committedAt: timestamptz("committed_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("import_jobs_idempotency_unique").on(t.idempotencyKey),
    index("import_jobs_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey(),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    /** Original cells, verbatim (data only, never evaluated). */
    raw: jsonb("raw").notNull(),
    /** { dateIso, amountMinor, description } once validated. */
    parsed: jsonb("parsed"),
    status: importRowStatusEnum("status").notNull().default("pending"),
    errorReason: text("error_reason"),
    contentHash: text("content_hash"),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("import_rows_job_number_unique").on(t.importJobId, t.rowNumber),
    index("import_rows_job_status_idx").on(t.importJobId, t.status),
  ],
);
