-- 0009_planning_guards
-- Purpose: database-level Phase 5 invariants (ERD doc §4). These hold even if
-- the service layer is bypassed:
--   1. Budget periods for one budget can never overlap (btree_gist exclusion
--      on the inclusive daterange).
--   2. Ownership is airtight: a period belongs to its budget's user; an
--      allocation belongs to its period's user and to a category of the same
--      user; a contribution belongs to its goal's user, and a linked-transfer
--      contribution references the user's own transaction in the goal's
--      currency (no silent cross-currency mixing).
--   3. A goal's contribution ledger can never sum below zero (withdrawals are
--      bounded by what was contributed).
--   4. A savings goal's linked account belongs to the goal's user.
-- Rollback: drop the exclusion constraint, triggers budget_periods_owner,
-- budget_allocations_owner, goal_contributions_guard, goal_contributions_balance,
-- savings_goals_linked_account and their functions; btree_gist may remain.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE budget_periods ADD CONSTRAINT budget_periods_no_overlap
EXCLUDE USING gist (
  budget_id WITH =,
  daterange(period_start, period_end, '[]') WITH &&
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION budget_periods_check_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  budget_user uuid;
BEGIN
  SELECT user_id INTO budget_user FROM budgets WHERE id = NEW.budget_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'budget not found';
  END IF;
  IF budget_user <> NEW.user_id THEN
    RAISE EXCEPTION 'budget period user does not own the budget';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER budget_periods_owner
BEFORE INSERT OR UPDATE OF budget_id, user_id ON budget_periods
FOR EACH ROW EXECUTE FUNCTION budget_periods_check_owner();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION budget_allocations_check_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  period_user uuid;
  category_user uuid;
BEGIN
  SELECT user_id INTO period_user FROM budget_periods WHERE id = NEW.budget_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'budget period not found';
  END IF;
  IF period_user <> NEW.user_id THEN
    RAISE EXCEPTION 'allocation user does not own the budget period';
  END IF;
  SELECT user_id INTO category_user FROM categories WHERE id = NEW.category_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'allocation category not found';
  END IF;
  IF category_user <> NEW.user_id THEN
    RAISE EXCEPTION 'allocation category belongs to another user';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER budget_allocations_owner
BEFORE INSERT OR UPDATE OF budget_period_id, category_id, user_id ON budget_allocations
FOR EACH ROW EXECUTE FUNCTION budget_allocations_check_owner();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION goal_contributions_check_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  goal_user uuid;
  goal_currency char(3);
  txn_user uuid;
  txn_currency char(3);
BEGIN
  SELECT user_id, currency INTO goal_user, goal_currency FROM savings_goals WHERE id = NEW.goal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'goal not found';
  END IF;
  IF goal_user <> NEW.user_id THEN
    RAISE EXCEPTION 'contribution user does not own the goal';
  END IF;
  IF NEW.transaction_id IS NOT NULL THEN
    SELECT user_id, currency INTO txn_user, txn_currency FROM transactions WHERE id = NEW.transaction_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'linked transaction not found';
    END IF;
    IF txn_user <> NEW.user_id THEN
      RAISE EXCEPTION 'linked transaction belongs to another user';
    END IF;
    IF txn_currency <> goal_currency THEN
      RAISE EXCEPTION 'linked transaction currency (%) must match the goal currency (%)', txn_currency, goal_currency;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER goal_contributions_guard
BEFORE INSERT OR UPDATE OF goal_id, user_id, transaction_id ON goal_contributions
FOR EACH ROW EXECUTE FUNCTION goal_contributions_check_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION goal_contributions_check_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_goal uuid;
  total bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_goal := OLD.goal_id;
  ELSE
    target_goal := NEW.goal_id;
  END IF;
  SELECT COALESCE(SUM(amount_minor), 0) INTO total FROM goal_contributions WHERE goal_id = target_goal;
  IF total < 0 THEN
    RAISE EXCEPTION 'goal contributions cannot sum below zero (would be %)', total;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER goal_contributions_balance
AFTER INSERT OR UPDATE OR DELETE ON goal_contributions
FOR EACH ROW EXECUTE FUNCTION goal_contributions_check_balance();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION savings_goals_check_linked_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account_user uuid;
BEGIN
  IF NEW.linked_account_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT user_id INTO account_user FROM accounts WHERE id = NEW.linked_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'linked account not found';
  END IF;
  IF account_user <> NEW.user_id THEN
    RAISE EXCEPTION 'linked account belongs to another user';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER savings_goals_linked_account
BEFORE INSERT OR UPDATE OF linked_account_id, user_id ON savings_goals
FOR EACH ROW EXECUTE FUNCTION savings_goals_check_linked_account();
