CREATE TYPE "public"."journal_kind" AS ENUM('life_event', 'decision', 'note');--> statement-breakpoint
CREATE TYPE "public"."scenario_event_type" AS ENUM('one_time_expense', 'income_change', 'rent_change', 'cancel_recurring', 'add_installment', 'savings_change', 'emergency_expense');--> statement-breakpoint
CREATE TYPE "public"."scenario_status" AS ENUM('draft', 'saved', 'archived');--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "journal_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"exclude_from_baselines" boolean DEFAULT false NOT NULL,
	"expected_outcome" jsonb,
	"review_on" date,
	"outcome_review" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "journal_entries_title_not_empty" CHECK (length(trim("journal_entries"."title")) > 0),
	CONSTRAINT "journal_entries_period_valid" CHECK ("journal_entries"."ends_on" IS NULL OR "journal_entries"."ends_on" >= "journal_entries"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "journal_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_links_entity_type_valid" CHECK ("journal_links"."entity_type" IN ('transaction', 'category', 'recurring_pattern', 'scenario'))
);
--> statement-breakpoint
CREATE TABLE "scenario_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scenario_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" "scenario_event_type" NOT NULL,
	"effective_on" date NOT NULL,
	"amount_minor" bigint,
	"recurrence" jsonb,
	"refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "scenario_status" DEFAULT 'draft' NOT NULL,
	"assumptions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"base_snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "scenarios_name_not_empty" CHECK (length(trim("scenarios"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_links" ADD CONSTRAINT "journal_links_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_links" ADD CONSTRAINT "journal_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_events" ADD CONSTRAINT "scenario_events_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_events" ADD CONSTRAINT "scenario_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_user_period_idx" ON "journal_entries" USING btree ("user_id","starts_on");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_links_entry_entity_unique" ON "journal_links" USING btree ("journal_entry_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "journal_links_entity_idx" ON "journal_links" USING btree ("user_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "scenario_events_scenario_idx" ON "scenario_events" USING btree ("scenario_id","effective_on");--> statement-breakpoint
CREATE UNIQUE INDEX "scenarios_user_saved_name_unique" ON "scenarios" USING btree ("user_id",lower("name")) WHERE "scenarios"."deleted_at" IS NULL AND "scenarios"."status" = 'saved';--> statement-breakpoint
CREATE INDEX "scenarios_user_status_idx" ON "scenarios" USING btree ("user_id","status");