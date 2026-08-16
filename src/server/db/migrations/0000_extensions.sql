-- 0000_extensions
-- Purpose: PostgreSQL extensions required by the Phase 1 identity schema.
-- citext provides case-insensitive email uniqueness (users.email).
-- Rollback: DROP EXTENSION citext; (only if no citext columns remain)
CREATE EXTENSION IF NOT EXISTS citext;
