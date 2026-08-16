CREATE TYPE "public"."audit_actor" AS ENUM('user', 'system', 'ai');--> statement-breakpoint
CREATE TYPE "public"."budget_style" AS ENUM('fixed', 'flexible', 'rollover', 'zero_based');--> statement-breakpoint
CREATE TYPE "public"."theme_preference" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'deactivated', 'pending_purge');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"actor" "audit_actor" DEFAULT 'user' NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"diff" jsonb,
	"ip_hash" text,
	"subject_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	CONSTRAINT "sessions_expiry_after_creation" CHECK ("sessions"."expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'en-MY' NOT NULL,
	"currency" char(3) DEFAULT 'MYR' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kuala_Lumpur' NOT NULL,
	"theme" "theme_preference" DEFAULT 'system' NOT NULL,
	"income_pattern" jsonb,
	"safety_buffer_minor" bigint DEFAULT 0 NOT NULL,
	"budget_style" "budget_style",
	"privacy_mode" boolean DEFAULT false NOT NULL,
	"ai_consent_at" timestamp with time zone,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarding_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data_retention_months" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_buffer_non_negative" CHECK ("user_preferences"."safety_buffer_minor" >= 0),
	CONSTRAINT "user_preferences_retention_positive" CHECK ("user_preferences"."data_retention_months" IS NULL OR "user_preferences"."data_retention_months" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_purge_after_required" CHECK ("users"."status" <> 'pending_purge' OR "users"."purge_after" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_user_created_idx" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_event_subject_idx" ON "audit_logs" USING btree ("event_type","subject_hash","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_event_ip_idx" ON "audit_logs" USING btree ("event_type","ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_expiry_idx" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE "users"."deleted_at" is null;