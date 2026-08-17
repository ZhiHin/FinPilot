CREATE TYPE "public"."notification_severity" AS ENUM('info', 'attention', 'risk');--> statement-breakpoint
CREATE TYPE "public"."recurring_direction" AS ENUM('inflow', 'outflow');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'custom');--> statement-breakpoint
CREATE TYPE "public"."recurring_source" AS ENUM('user_confirmed', 'inferred');--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'trial', 'canceled', 'unknown');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"severity" "notification_severity" DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedup_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"delivery" jsonb DEFAULT '{"channel":"in_app"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_patterns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"merchant_id" uuid,
	"name" text NOT NULL,
	"direction" "recurring_direction" NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"typical_amount_minor" bigint NOT NULL,
	"amount_tolerance_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'MYR' NOT NULL,
	"next_expected_on" date NOT NULL,
	"last_seen_on" date,
	"confidence_bp" integer DEFAULT 0 NOT NULL,
	"source" "recurring_source" DEFAULT 'inferred' NOT NULL,
	"status" "recurring_status" DEFAULT 'active' NOT NULL,
	"category_id" uuid,
	"account_id" uuid,
	"is_installment" boolean DEFAULT false NOT NULL,
	"installments_total" integer,
	"installments_observed" integer DEFAULT 0 NOT NULL,
	"inference_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_amount_positive" CHECK ("recurring_patterns"."typical_amount_minor" > 0),
	CONSTRAINT "recurring_tolerance_non_negative" CHECK ("recurring_patterns"."amount_tolerance_minor" >= 0),
	CONSTRAINT "recurring_confidence_range" CHECK ("recurring_patterns"."confidence_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "recurring_installments_valid" CHECK ("recurring_patterns"."installments_observed" >= 0 AND ("recurring_patterns"."installments_total" IS NULL OR ("recurring_patterns"."installments_total" > 0 AND "recurring_patterns"."installments_observed" <= "recurring_patterns"."installments_total")))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recurring_pattern_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"service_name" text NOT NULL,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"current_price_minor" bigint NOT NULL,
	"previous_price_minor" bigint,
	"price_changed_at" timestamp with time zone,
	"price_evidence" jsonb,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"usage_confirmed_at" timestamp with time zone,
	"renewal_date" date,
	"price_change_acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_price_positive" CHECK ("subscriptions"."current_price_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_patterns" ADD CONSTRAINT "recurring_patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_patterns" ADD CONSTRAINT "recurring_patterns_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_patterns" ADD CONSTRAINT "recurring_patterns_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_patterns" ADD CONSTRAINT "recurring_patterns_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_recurring_pattern_id_recurring_patterns_id_fk" FOREIGN KEY ("recurring_pattern_id") REFERENCES "public"."recurring_patterns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedup_unique" ON "notifications" USING btree ("user_id","dedup_key") WHERE "notifications"."dismissed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at") WHERE "notifications"."read_at" IS NULL AND "notifications"."dismissed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_user_inference_unique" ON "recurring_patterns" USING btree ("user_id","inference_key") WHERE "recurring_patterns"."inference_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "recurring_user_next_idx" ON "recurring_patterns" USING btree ("user_id","next_expected_on");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_pattern_unique" ON "subscriptions" USING btree ("recurring_pattern_id");