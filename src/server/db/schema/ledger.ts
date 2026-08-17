import { isNull, sql } from "drizzle-orm";
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
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./identity";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const localDate = (name: string) => date(name, { mode: "string" });

/* ---------------------------------- enums ---------------------------------- */

export const accountTypeEnum = pgEnum("account_type", [
  "cash",
  "current",
  "savings",
  "ewallet",
  "credit_card",
  "loan",
  "investment",
  "asset_other",
  "liability_other",
]);

export const accountStatusEnum = pgEnum("account_status", ["active", "archived"]);

export const txnTypeEnum = pgEnum("txn_type", [
  "income",
  "expense",
  "transfer",
  "refund",
  "adjustment",
  "debt_payment",
]);

export const txnStatusEnum = pgEnum("txn_status", ["pending", "posted"]);

export const categorizationSourceEnum = pgEnum("categorization_source", [
  "user",
  "rule",
  "model",
  "import",
  "default",
]);

export const linkTypeEnum = pgEnum("link_type", [
  "transfer_pair",
  "refund_of",
  "duplicate_of",
  "installment_of",
]);

export const categoryGroupKindEnum = pgEnum("category_group_kind", ["income", "expense"]);

export const snapshotSourceEnum = pgEnum("snapshot_source", [
  "reconciliation",
  "daily_job",
  "import",
]);

export const attachmentKindEnum = pgEnum("attachment_kind", ["receipt", "statement", "other"]);

export const scanStatusEnum = pgEnum("scan_status", ["pending", "clean", "rejected"]);

/* --------------------------------- accounts -------------------------------- */

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("MYR"),
    openingBalanceMinor: bigint("opening_balance_minor", { mode: "number" }).notNull().default(0),
    openingBalanceDate: localDate("opening_balance_date").notNull(),
    creditLimitMinor: bigint("credit_limit_minor", { mode: "number" }),
    color: text("color"),
    icon: text("icon"),
    isLiquid: boolean("is_liquid").notNull(),
    includeInNetWorth: boolean("include_in_net_worth").notNull().default(true),
    status: accountStatusEnum("status").notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    deletedAt: timestamptz("deleted_at"),
  },
  (t) => [
    uniqueIndex("accounts_user_name_unique")
      .on(t.userId, sql`lower(${t.name})`)
      .where(isNull(t.deletedAt)),
    index("accounts_user_status_idx").on(t.userId, t.status),
    check(
      "accounts_credit_limit_only_cards",
      sql`${t.type} = 'credit_card' OR ${t.creditLimitMinor} IS NULL`,
    ),
  ],
);

export const accountBalanceSnapshots = pgTable(
  "account_balance_snapshots",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    asOf: localDate("as_of").notNull(),
    balanceMinor: bigint("balance_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    source: snapshotSourceEnum("source").notNull(),
    discrepancyMinor: bigint("discrepancy_minor", { mode: "number" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("balance_snapshots_unique").on(t.accountId, t.asOf, t.source)],
);

/* ----------------------------- classification ------------------------------ */

export const categoryGroups = pgTable(
  "category_groups",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: categoryGroupKindEnum("kind").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("category_groups_user_name_unique")
      .on(t.userId, sql`lower(${t.name})`)
      .where(isNull(t.archivedAt)),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => categoryGroups.id),
    name: text("name").notNull(),
    icon: text("icon"),
    color: text("color"),
    isSystem: boolean("is_system").notNull().default(false),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("categories_user_group_name_unique")
      .on(t.userId, t.groupId, sql`lower(${t.name})`)
      .where(isNull(t.archivedAt)),
    index("categories_user_idx").on(t.userId),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    deletedAt: timestamptz("deleted_at"),
  },
  (t) => [
    uniqueIndex("tags_user_name_unique")
      .on(t.userId, sql`lower(${t.name})`)
      .where(isNull(t.deletedAt)),
  ],
);

export const merchants = pgTable(
  "merchants",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    canonicalName: text("canonical_name").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    defaultCategoryId: uuid("default_category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    aliases: jsonb("aliases")
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("merchants_user_key_unique").on(t.userId, t.normalizedKey)],
);

export const categorizationRules = pgTable(
  "categorization_rules",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priority: integer("priority").notNull(),
    conditions: jsonb("conditions").notNull(),
    actions: jsonb("actions").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastAppliedAt: timestamptz("last_applied_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("categorization_rules_priority_unique").on(t.userId, t.priority)],
);

/* -------------------------------- transactions ----------------------------- */

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    type: txnTypeEnum("type").notNull(),
    status: txnStatusEnum("status").notNull().default("posted"),
    isExcluded: boolean("is_excluded").notNull().default(false),
    needsReview: boolean("needs_review").notNull().default(false),
    /** Signed minor units: negative = outflow (ADR-003). */
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    txnDate: localDate("txn_date").notNull(),
    postedAt: timestamptz("posted_at"),
    descriptionOriginal: text("description_original").notNull().default(""),
    descriptionClean: text("description_clean"),
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    categorizationSource: categorizationSourceEnum("categorization_source")
      .notNull()
      .default("user"),
    categoryConfidence: real("category_confidence"),
    appliedRuleId: uuid("applied_rule_id").references(() => categorizationRules.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    isReimbursable: boolean("is_reimbursable").notNull().default(false),
    /** Occurrence-indexed statement hash; unique per account (import idempotency). */
    importContentHash: text("import_content_hash"),
    version: integer("version").notNull().default(1),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    deletedAt: timestamptz("deleted_at"),
  },
  (t) => [
    index("txn_user_date_idx").on(t.userId, t.txnDate, t.id),
    index("txn_user_account_date_idx").on(t.userId, t.accountId, t.txnDate),
    index("txn_user_category_date_idx").on(t.userId, t.categoryId, t.txnDate),
    index("txn_user_merchant_idx").on(t.userId, t.merchantId),
    index("txn_needs_review_idx")
      .on(t.userId)
      .where(sql`${t.needsReview} = true and ${t.deletedAt} is null`),
    index("txn_description_trgm_idx").using("gin", sql`${t.descriptionOriginal} gin_trgm_ops`),
    uniqueIndex("txn_import_hash_unique")
      .on(t.accountId, t.importContentHash)
      .where(sql`${t.importContentHash} is not null`),
    check("txn_amount_nonzero", sql`${t.type} = 'adjustment' OR ${t.amountMinor} <> 0`),
    check("txn_sign_expense", sql`${t.type} <> 'expense' OR ${t.amountMinor} < 0`),
    check("txn_sign_income", sql`${t.type} <> 'income' OR ${t.amountMinor} > 0`),
    check("txn_sign_refund", sql`${t.type} <> 'refund' OR ${t.amountMinor} > 0`),
    check(
      "txn_confidence_range",
      sql`${t.categoryConfidence} IS NULL OR (${t.categoryConfidence} >= 0 AND ${t.categoryConfidence} <= 1)`,
    ),
  ],
);

export const transactionSplits = pgTable(
  "transaction_splits",
  {
    id: uuid("id").primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    isReimbursable: boolean("is_reimbursable").notNull().default(false),
    note: text("note"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("splits_transaction_idx").on(t.transactionId)],
);

export const transactionLinks = pgTable(
  "transaction_links",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    linkType: linkTypeEnum("link_type").notNull(),
    fromTransactionId: uuid("from_transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    toTransactionId: uuid("to_transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transaction_links_unique").on(t.linkType, t.fromTransactionId, t.toTransactionId),
    index("transaction_links_from_idx").on(t.fromTransactionId),
    index("transaction_links_to_idx").on(t.toTransactionId),
    check("transaction_links_not_self", sql`${t.fromTransactionId} <> ${t.toTransactionId}`),
  ],
);

export const transactionTags = pgTable(
  "transaction_tags",
  {
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.tagId] })],
);

/* --------------------------------- attachments ----------------------------- */

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    kind: attachmentKindEnum("kind").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    scanStatus: scanStatusEnum("scan_status").notNull().default("pending"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    deletedAt: timestamptz("deleted_at"),
  },
  (t) => [
    index("attachments_user_idx").on(t.userId),
    index("attachments_txn_idx").on(t.transactionId),
  ],
);
