-- 0002_audit_append_only
-- Purpose: audit_logs is append-only. Any UPDATE or DELETE raises, regardless of role,
-- so the audit trail cannot be quietly rewritten (spec §6 G6; ERD doc §4).
-- One carve-out: the users FK is ON DELETE SET NULL, so an UPDATE that only
-- anonymizes user_id (NULL, all other columns identical) is allowed — audit rows
-- must survive account purge without becoming editable.
-- Rollback: DROP TRIGGER audit_logs_append_only ON audit_logs; DROP FUNCTION audit_logs_block_mutation();
CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.user_id IS NULL
     AND OLD.user_id IS NOT NULL
     AND (to_jsonb(NEW) - 'user_id') = (to_jsonb(OLD) - 'user_id')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
