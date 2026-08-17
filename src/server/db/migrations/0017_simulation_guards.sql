-- 0017_simulation_guards
-- Purpose: database-level Phase 9 ownership invariants (ERD doc §4):
--   scenario events may only belong to the caller's own scenario, and
--   journal links may only belong to the caller's own journal entry -
--   cross-user attachment is impossible even if the service layer is
--   bypassed.
-- Rollback: drop triggers scenario_events_owner / journal_links_owner and
--   their functions.

CREATE OR REPLACE FUNCTION scenario_events_check_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ref_user uuid;
BEGIN
  SELECT user_id INTO ref_user FROM scenarios WHERE id = NEW.scenario_id;
  IF NOT FOUND OR ref_user <> NEW.user_id THEN
    RAISE EXCEPTION 'scenario event belongs to another user''s scenario';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER scenario_events_owner
BEFORE INSERT OR UPDATE OF scenario_id, user_id ON scenario_events
FOR EACH ROW EXECUTE FUNCTION scenario_events_check_owner();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION journal_links_check_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ref_user uuid;
BEGIN
  SELECT user_id INTO ref_user FROM journal_entries WHERE id = NEW.journal_entry_id;
  IF NOT FOUND OR ref_user <> NEW.user_id THEN
    RAISE EXCEPTION 'journal link belongs to another user''s entry';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_links_owner
BEFORE INSERT OR UPDATE OF journal_entry_id, user_id ON journal_links
FOR EACH ROW EXECUTE FUNCTION journal_links_check_owner();
