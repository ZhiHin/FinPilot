CREATE TYPE "public"."budget_cycle" AS ENUM('calendar_month', 'payday');--> statement-breakpoint
CREATE TYPE "public"."budget_mode" AS ENUM('fixed', 'flexible', 'rollover', 'zero_based');--> statement-breakpoint
CREATE TYPE "public"."budget_period_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."goal_contribution_kind" AS ENUM('allocation', 'linked_transfer');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."goal_type" AS ENUM('emergency', 'purchase', 'travel', 'education', 'debt_payoff', 'custom');--> statement-breakpoint
CREATE TABLE "budget_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"budget_period_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"planned_minor" bigint DEFAULT 0 NOT NULL,
	"rollover_in_minor" bigint DEFAULT 0 NOT NULL,
	"rollover_enabled" boolean DEFAULT false NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_allocations_planned_non_negative" CHECK ("budget_allocations"."planned_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "budget_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"budget_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "budget_period_status" DEFAULT 'open' NOT NULL,
	"expected_income_minor" bigint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_periods_valid_range" CHECK ("budget_periods"."period_end" > "budget_periods"."period_start"),
	CONSTRAINT "budget_periods_income_non_negative" CHECK ("budget_periods"."expected_income_minor" IS NULL OR "budget_periods"."expected_income_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mode" "budget_mode" NOT NULL,
	"cycle_type" "budget_cycle" NOT NULL,
	"cycle_anchor" jsonb,
	"currency" char(3) DEFAULT 'MYR' NOT NULL,
	"carry_negative" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_payday_anchor_required" CHECK ("budgets"."cycle_type" <> 'payday' OR "budgets"."cycle_anchor" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "goal_contributions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"goal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"contributed_on" date NOT NULL,
	"kind" "goal_contribution_kind" DEFAULT 'allocation' NOT NULL,
	"transaction_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_contributions_amount_nonzero" CHECK ("goal_contributions"."amount_minor" <> 0),
	CONSTRAINT "goal_contributions_transfer_requires_txn" CHECK ("goal_contributions"."kind" <> 'linked_transfer' OR "goal_contributions"."transaction_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "savings_goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "goal_type" NOT NULL,
	"target_amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'MYR' NOT NULL,
	"target_date" date,
	"priority" integer DEFAULT 3 NOT NULL,
	"linked_account_id" uuid,
	"contribution_schedule" jsonb,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "savings_goals_target_positive" CHECK ("savings_goals"."target_amount_minor" > 0),
	CONSTRAINT "savings_goals_priority_range" CHECK ("savings_goals"."priority" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_budget_period_id_budget_periods_id_fk" FOREIGN KEY ("budget_period_id") REFERENCES "public"."budget_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_savings_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_allocations_period_category_unique" ON "budget_allocations" USING btree ("budget_period_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_periods_budget_start_unique" ON "budget_periods" USING btree ("budget_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_user_name_unique" ON "budgets" USING btree ("user_id",lower("name")) WHERE "budgets"."is_active" = true;--> statement-breakpoint
CREATE INDEX "goal_contributions_goal_date_idx" ON "goal_contributions" USING btree ("goal_id","contributed_on");--> statement-breakpoint
CREATE UNIQUE INDEX "savings_goals_user_name_unique" ON "savings_goals" USING btree ("user_id",lower("name")) WHERE "savings_goals"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "savings_goals_user_idx" ON "savings_goals" USING btree ("user_id") WHERE "savings_goals"."deleted_at" is null;