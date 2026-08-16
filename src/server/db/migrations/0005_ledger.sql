CREATE TYPE "public"."account_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."account_type" AS ENUM('cash', 'current', 'savings', 'ewallet', 'credit_card', 'loan', 'investment', 'asset_other', 'liability_other');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('receipt', 'statement', 'other');--> statement-breakpoint
CREATE TYPE "public"."categorization_source" AS ENUM('user', 'rule', 'model', 'import', 'default');--> statement-breakpoint
CREATE TYPE "public"."category_group_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."link_type" AS ENUM('transfer_pair', 'refund_of', 'duplicate_of', 'installment_of');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('pending', 'clean', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."snapshot_source" AS ENUM('reconciliation', 'daily_job', 'import');--> statement-breakpoint
CREATE TYPE "public"."txn_status" AS ENUM('pending', 'posted');--> statement-breakpoint
CREATE TYPE "public"."txn_type" AS ENUM('income', 'expense', 'transfer', 'refund', 'adjustment', 'debt_payment');--> statement-breakpoint
CREATE TABLE "account_balance_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"balance_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"source" "snapshot_source" NOT NULL,
	"discrepancy_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"currency" char(3) DEFAULT 'MYR' NOT NULL,
	"opening_balance_minor" bigint DEFAULT 0 NOT NULL,
	"opening_balance_date" date NOT NULL,
	"credit_limit_minor" bigint,
	"color" text,
	"icon" text,
	"is_liquid" boolean NOT NULL,
	"include_in_net_worth" boolean DEFAULT true NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "accounts_credit_limit_only_cards" CHECK ("accounts"."type" = 'credit_card' OR "accounts"."credit_limit_minor" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_id" uuid,
	"kind" "attachment_kind" NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"scan_status" "scan_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categorization_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "category_group_kind" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_key" text NOT NULL,
	"default_category_id" uuid,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transaction_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"link_type" "link_type" NOT NULL,
	"from_transaction_id" uuid NOT NULL,
	"to_transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_links_not_self" CHECK ("transaction_links"."from_transaction_id" <> "transaction_links"."to_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_splits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"is_reimbursable" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_tags" (
	"transaction_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "transaction_tags_transaction_id_tag_id_pk" PRIMARY KEY("transaction_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "txn_type" NOT NULL,
	"status" "txn_status" DEFAULT 'posted' NOT NULL,
	"is_excluded" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"txn_date" date NOT NULL,
	"posted_at" timestamp with time zone,
	"description_original" text DEFAULT '' NOT NULL,
	"description_clean" text,
	"merchant_id" uuid,
	"category_id" uuid,
	"categorization_source" "categorization_source" DEFAULT 'user' NOT NULL,
	"category_confidence" real,
	"applied_rule_id" uuid,
	"notes" text,
	"is_reimbursable" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "txn_amount_nonzero" CHECK ("transactions"."type" = 'adjustment' OR "transactions"."amount_minor" <> 0),
	CONSTRAINT "txn_sign_expense" CHECK ("transactions"."type" <> 'expense' OR "transactions"."amount_minor" < 0),
	CONSTRAINT "txn_sign_income" CHECK ("transactions"."type" <> 'income' OR "transactions"."amount_minor" > 0),
	CONSTRAINT "txn_sign_refund" CHECK ("transactions"."type" <> 'refund' OR "transactions"."amount_minor" > 0),
	CONSTRAINT "txn_confidence_range" CHECK ("transactions"."category_confidence" IS NULL OR ("transactions"."category_confidence" >= 0 AND "transactions"."category_confidence" <= 1))
);
--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ADD CONSTRAINT "account_balance_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ADD CONSTRAINT "account_balance_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_group_id_category_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."category_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_groups" ADD CONSTRAINT "category_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_default_category_id_categories_id_fk" FOREIGN KEY ("default_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_links" ADD CONSTRAINT "transaction_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_links" ADD CONSTRAINT "transaction_links_from_transaction_id_transactions_id_fk" FOREIGN KEY ("from_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_links" ADD CONSTRAINT "transaction_links_to_transaction_id_transactions_id_fk" FOREIGN KEY ("to_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_applied_rule_id_categorization_rules_id_fk" FOREIGN KEY ("applied_rule_id") REFERENCES "public"."categorization_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "balance_snapshots_unique" ON "account_balance_snapshots" USING btree ("account_id","as_of","source");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_name_unique" ON "accounts" USING btree ("user_id",lower("name")) WHERE "accounts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "accounts_user_status_idx" ON "accounts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "attachments_user_idx" ON "attachments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "attachments_txn_idx" ON "attachments" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_group_name_unique" ON "categories" USING btree ("user_id","group_id",lower("name")) WHERE "categories"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "categories_user_idx" ON "categories" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categorization_rules_priority_unique" ON "categorization_rules" USING btree ("user_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "category_groups_user_name_unique" ON "category_groups" USING btree ("user_id",lower("name")) WHERE "category_groups"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_user_key_unique" ON "merchants" USING btree ("user_id","normalized_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_name_unique" ON "tags" USING btree ("user_id",lower("name")) WHERE "tags"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_links_unique" ON "transaction_links" USING btree ("link_type","from_transaction_id","to_transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_links_from_idx" ON "transaction_links" USING btree ("from_transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_links_to_idx" ON "transaction_links" USING btree ("to_transaction_id");--> statement-breakpoint
CREATE INDEX "splits_transaction_idx" ON "transaction_splits" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "txn_user_date_idx" ON "transactions" USING btree ("user_id","txn_date","id");--> statement-breakpoint
CREATE INDEX "txn_user_account_date_idx" ON "transactions" USING btree ("user_id","account_id","txn_date");--> statement-breakpoint
CREATE INDEX "txn_user_category_date_idx" ON "transactions" USING btree ("user_id","category_id","txn_date");--> statement-breakpoint
CREATE INDEX "txn_user_merchant_idx" ON "transactions" USING btree ("user_id","merchant_id");--> statement-breakpoint
CREATE INDEX "txn_needs_review_idx" ON "transactions" USING btree ("user_id") WHERE "transactions"."needs_review" = true and "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "txn_description_trgm_idx" ON "transactions" USING gin ("description_original" gin_trgm_ops);