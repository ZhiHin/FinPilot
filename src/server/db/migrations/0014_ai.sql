CREATE TYPE "public"."ai_feedback_verdict" AS ENUM('helpful', 'not_helpful', 'wrong');--> statement-breakpoint
CREATE TYPE "public"."ai_request_status" AS ENUM('ok', 'error', 'refused', 'fallback');--> statement-breakpoint
CREATE TYPE "public"."ai_source" AS ENUM('deterministic', 'model', 'generative');--> statement-breakpoint
CREATE TYPE "public"."ai_suggestion_kind" AS ENUM('category_correction', 'merchant_rule', 'budget_change', 'subscription_detect', 'duplicate_txn', 'refund_match', 'goal_adjustment');--> statement-breakpoint
CREATE TYPE "public"."ai_suggestion_status" AS ENUM('pending', 'approved', 'edited', 'dismissed', 'snoozed', 'expired');--> statement-breakpoint
CREATE TABLE "ai_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"suggestion_id" uuid,
	"insight_id" uuid,
	"verdict" "ai_feedback_verdict" NOT NULL,
	"reason_code" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_feedback_exactly_one_target" CHECK (("ai_feedback"."suggestion_id" IS NULL) <> ("ai_feedback"."insight_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"status" "ai_request_status" NOT NULL,
	"error_redacted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "ai_suggestion_kind" NOT NULL,
	"target_entity_type" text NOT NULL,
	"target_entity_id" uuid,
	"proposed_change" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"confidence_bp" integer DEFAULT 0 NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "ai_suggestion_status" DEFAULT 'pending' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"source" "ai_source" DEFAULT 'deterministic' NOT NULL,
	"model_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_suggestions_confidence_range" CHECK ("ai_suggestions"."confidence_bp" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_suggestion_id_ai_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."ai_suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_feedback_user_idx" ON "ai_feedback" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_requests_user_created_idx" ON "ai_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_suggestions_live_target_unique" ON "ai_suggestions" USING btree ("user_id","kind","target_entity_id") WHERE "ai_suggestions"."status" IN ('pending', 'snoozed') AND "ai_suggestions"."target_entity_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_suggestions_user_status_idx" ON "ai_suggestions" USING btree ("user_id","status","created_at");