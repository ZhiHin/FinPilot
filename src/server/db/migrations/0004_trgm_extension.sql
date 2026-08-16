-- 0004_trgm_extension
-- Purpose: trigram indexing for transaction description search (Phase 2).
-- Rollback: DROP EXTENSION pg_trgm; (only if no trgm indexes remain)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
