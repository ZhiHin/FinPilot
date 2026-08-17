-- 0011_recurring_guards
-- Purpose: database-level Phase 6 ownership invariants (ERD doc §4). These
-- hold even if the service layer is bypassed:
--   1. A recurring pattern may only reference the owner's merchant, category,
--      and account.
--   2. A subscription belongs to its recurring pattern's user, and the
--      pattern's currency is the subscription's price currency by definition
--      (1:1 extension) — cross-user extension is impossible.
-- Rollback: drop triggers recurring_patterns_owner, subscriptions_owner and
-- their functions.

CREATE OR REPLACE FUNCTION recurring_patterns_check_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ref_user uuid;
BEGIN
  IF NEW.merchant_id IS NOT NULL THEN
    SELECT user_id INTO ref_user FROM merchants WHERE id = NEW.merchant_id;
    IF NOT FOUND OR ref_user <> NEW.user_id THEN
      RAISE EXCEPTION 'recurring pattern merchant belongs to another user';
    END IF;
  END IF;
  IF NEW.category_id IS NOT NULL THEN
    SELECT user_id INTO ref_user FROM categories WHERE id = NEW.category_id;
    IF NOT FOUND OR ref_user <> NEW.user_id THEN
      RAISE EXCEPTION 'recurring pattern category belongs to another user';
    END IF;
  END IF;
  IF NEW.account_id IS NOT NULL THEN
    SELECT user_id INTO ref_user FROM accounts WHERE id = NEW.account_id;
    IF NOT FOUND OR ref_user <> NEW.user_id THEN
      RAISE EXCEPTION 'recurring pattern account belongs to another user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recurring_patterns_owner
BEFORE INSERT OR UPDATE OF merchant_id, category_id, account_id, user_id ON recurring_patterns
FOR EACH ROW EXECUTE FUNCTION recurring_patterns_check_owner();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION subscriptions_check_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pattern_user uuid;
BEGIN
  SELECT user_id INTO pattern_user FROM recurring_patterns WHERE id = NEW.recurring_pattern_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recurring pattern not found';
  END IF;
  IF pattern_user <> NEW.user_id THEN
    RAISE EXCEPTION 'subscription user does not own the recurring pattern';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscriptions_owner
BEFORE INSERT OR UPDATE OF recurring_pattern_id, user_id ON subscriptions
FOR EACH ROW EXECUTE FUNCTION subscriptions_check_owner();
