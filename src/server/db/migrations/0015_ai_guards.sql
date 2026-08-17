-- 0015_ai_guards
-- Purpose: database-level Phase 8 ownership invariant (ERD doc §4):
--   feedback may only reference the caller's own suggestion or insight —
--   cross-user feedback attachment is impossible even if the service layer
--   is bypassed.
-- Rollback: drop trigger ai_feedback_owner and its function.

CREATE OR REPLACE FUNCTION ai_feedback_check_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ref_user uuid;
BEGIN
  IF NEW.suggestion_id IS NOT NULL THEN
    SELECT user_id INTO ref_user FROM ai_suggestions WHERE id = NEW.suggestion_id;
    IF NOT FOUND OR ref_user <> NEW.user_id THEN
      RAISE EXCEPTION 'feedback suggestion belongs to another user';
    END IF;
  END IF;
  IF NEW.insight_id IS NOT NULL THEN
    SELECT user_id INTO ref_user FROM insights WHERE id = NEW.insight_id;
    IF NOT FOUND OR ref_user <> NEW.user_id THEN
      RAISE EXCEPTION 'feedback insight belongs to another user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ai_feedback_owner
BEFORE INSERT OR UPDATE OF suggestion_id, insight_id, user_id ON ai_feedback
FOR EACH ROW EXECUTE FUNCTION ai_feedback_check_owner();
