-- 0006_ledger_triggers
-- Purpose: database-level financial invariants (ERD doc §4). These hold even if
-- the service layer is bypassed:
--   1. A transaction's currency always matches its account's currency, and the
--      transaction's user always owns the account (invariants 8 and 10).
--   2. Splits sum exactly to their parent amount, checked at COMMIT so multi-row
--      split edits stay atomic (invariant 3). Enforced from both sides (split
--      changes and parent amount changes).
--   3. Links join only same-user transactions; transfer pairs are equal-and-
--      opposite, same-currency, transfer-typed legs (invariants 2 and 10).
-- Rollback: drop triggers transactions_account_currency, transaction_splits_sum,
-- transactions_split_sum, transaction_links_validation and their functions.

CREATE OR REPLACE FUNCTION transactions_check_account_currency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  acct_currency char(3);
  acct_user uuid;
BEGIN
  SELECT currency, user_id INTO acct_currency, acct_user FROM accounts WHERE id = NEW.account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction account not found';
  END IF;
  IF acct_currency <> NEW.currency THEN
    RAISE EXCEPTION 'transaction currency (%) must match the account currency (%)', NEW.currency, acct_currency;
  END IF;
  IF acct_user <> NEW.user_id THEN
    RAISE EXCEPTION 'transaction user does not own the account';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transactions_account_currency
BEFORE INSERT OR UPDATE OF account_id, currency, user_id ON transactions
FOR EACH ROW EXECUTE FUNCTION transactions_check_account_currency();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION transaction_splits_check_sum() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_txn uuid;
  parent_amount bigint;
  parent_user uuid;
  split_total bigint;
  split_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_txn := OLD.transaction_id;
  ELSE
    target_txn := NEW.transaction_id;
  END IF;

  SELECT amount_minor, user_id INTO parent_amount, parent_user
  FROM transactions WHERE id = target_txn;
  IF NOT FOUND THEN
    -- Parent deleted in the same transaction (cascade): nothing to enforce.
    RETURN NULL;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.user_id <> parent_user THEN
    RAISE EXCEPTION 'split user must match the parent transaction user';
  END IF;

  SELECT COALESCE(SUM(amount_minor), 0), COUNT(*) INTO split_total, split_count
  FROM transaction_splits WHERE transaction_id = target_txn;
  IF split_count > 0 AND split_total <> parent_amount THEN
    RAISE EXCEPTION 'transaction splits (%) must sum exactly to the parent amount (%)', split_total, parent_amount;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transaction_splits_sum
AFTER INSERT OR UPDATE OR DELETE ON transaction_splits
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION transaction_splits_check_sum();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION transactions_check_split_sum() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  split_total bigint;
  split_count integer;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0), COUNT(*) INTO split_total, split_count
  FROM transaction_splits WHERE transaction_id = NEW.id;
  IF split_count > 0 AND split_total <> NEW.amount_minor THEN
    RAISE EXCEPTION 'transaction splits (%) must sum exactly to the parent amount (%)', split_total, NEW.amount_minor;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transactions_split_sum
AFTER UPDATE OF amount_minor ON transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION transactions_check_split_sum();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION transaction_links_validate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  f record;
  t record;
BEGIN
  SELECT user_id, type, amount_minor, currency INTO f
  FROM transactions WHERE id = NEW.from_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link source transaction not found';
  END IF;
  SELECT user_id, type, amount_minor, currency INTO t
  FROM transactions WHERE id = NEW.to_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link target transaction not found';
  END IF;

  IF f.user_id <> NEW.user_id OR t.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'linked transactions must belong to the linking user';
  END IF;

  IF NEW.link_type = 'transfer_pair' THEN
    IF f.type <> 'transfer' OR t.type <> 'transfer' THEN
      RAISE EXCEPTION 'transfer_pair requires both legs to be transfer transactions';
    END IF;
    IF f.currency <> t.currency THEN
      RAISE EXCEPTION 'transfer_pair requires the same currency on both legs';
    END IF;
    IF f.amount_minor >= 0 OR t.amount_minor <= 0 OR f.amount_minor + t.amount_minor <> 0 THEN
      RAISE EXCEPTION 'transfer_pair legs must be equal and opposite (outflow -> inflow)';
    END IF;
  END IF;

  IF NEW.link_type = 'refund_of' AND f.type <> 'refund' THEN
    RAISE EXCEPTION 'refund_of source must be a refund transaction';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transaction_links_validation
BEFORE INSERT OR UPDATE ON transaction_links
FOR EACH ROW EXECUTE FUNCTION transaction_links_validate();
