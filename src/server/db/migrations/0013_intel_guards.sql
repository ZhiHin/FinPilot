-- 0013_intel_guards
-- Purpose: database-level Phase 7 ownership invariant (ERD doc §4):
--   insight evidence must belong to its insight's user — cross-user evidence
--   attachment is impossible even if the service layer is bypassed.
-- Rollback: drop trigger insight_evidence_owner and its function.

CREATE OR REPLACE FUNCTION insight_evidence_check_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  insight_user uuid;
BEGIN
  SELECT user_id INTO insight_user FROM insights WHERE id = NEW.insight_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'insight not found';
  END IF;
  IF insight_user <> NEW.user_id THEN
    RAISE EXCEPTION 'evidence user does not own the insight';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER insight_evidence_owner
BEFORE INSERT OR UPDATE OF insight_id, user_id ON insight_evidence
FOR EACH ROW EXECUTE FUNCTION insight_evidence_check_owner();
