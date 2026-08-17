CREATE TYPE "public"."import_row_status" AS ENUM('pending', 'valid', 'invalid', 'duplicate', 'skipped', 'committed');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'mapping', 'validating', 'review', 'committing', 'completed', 'failed', 'canceled', 'undone');--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"import_profile_id" uuid,
	"filename" text NOT NULL,
	"file_sha256" text,
	"encoding" text,
	"delimiter" text,
	"idempotency_key" text NOT NULL,
	"status" "import_status" DEFAULT 'mapping' NOT NULL,
	"mapping" jsonb,
	"row_count" integer DEFAULT 0 NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_label" text,
	"mapping" jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"parsed" jsonb,
	"status" "import_row_status" DEFAULT 'pending' NOT NULL,
	"error_reason" text,
	"content_hash" text,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "import_content_hash" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_import_profile_id_import_profiles_id_fk" FOREIGN KEY ("import_profile_id") REFERENCES "public"."import_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_idempotency_unique" ON "import_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "import_jobs_user_created_idx" ON "import_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_profiles_user_name_unique" ON "import_profiles" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_job_number_unique" ON "import_rows" USING btree ("import_job_id","row_number");--> statement-breakpoint
CREATE INDEX "import_rows_job_status_idx" ON "import_rows" USING btree ("import_job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "txn_import_hash_unique" ON "transactions" USING btree ("account_id","import_content_hash") WHERE "transactions"."import_content_hash" is not null;