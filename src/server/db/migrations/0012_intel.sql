CREATE TYPE "public"."forecast_kind" AS ENUM('cash_flow', 'category_spend', 'goal_projection', 'safe_to_spend');--> statement-breakpoint
CREATE TYPE "public"."insight_generated_by" AS ENUM('deterministic', 'generative');--> statement-breakpoint
CREATE TYPE "public"."insight_status" AS ENUM('new', 'read', 'dismissed', 'actioned');--> statement-breakpoint
CREATE TABLE "forecasts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "forecast_kind" NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"horizon_days" integer NOT NULL,
	"method" text NOT NULL,
	"method_version" text NOT NULL,
	"series" jsonb NOT NULL,
	"inputs_hash" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "forecasts_horizon_valid" CHECK ("forecasts"."horizon_days" IN (30, 60, 90))
);
--> statement-breakpoint
CREATE TABLE "insight_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"insight_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"evidence_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"severity" "notification_severity" DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"comparison" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_bp" integer DEFAULT 0 NOT NULL,
	"data_quality" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_by" "insight_generated_by" DEFAULT 'deterministic' NOT NULL,
	"model" text,
	"prompt_version" text,
	"status" "insight_status" DEFAULT 'new' NOT NULL,
	"dedup_key" text NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insights_confidence_range" CHECK ("insights"."confidence_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "insights_period_valid" CHECK ("insights"."period_end" >= "insights"."period_start")
);
--> statement-breakpoint
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forecasts_user_kind_hash_unique" ON "forecasts" USING btree ("user_id","kind","inputs_hash");--> statement-breakpoint
CREATE INDEX "forecasts_user_kind_idx" ON "forecasts" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "insight_evidence_insight_idx" ON "insight_evidence" USING btree ("insight_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "insights_user_dedup_unique" ON "insights" USING btree ("user_id","dedup_key");--> statement-breakpoint
CREATE INDEX "insights_user_status_idx" ON "insights" USING btree ("user_id","status","created_at");