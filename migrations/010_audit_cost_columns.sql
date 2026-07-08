-- Migration 010: Audit Cost Columns
-- Adds per-model-call token counts to the audit table for cost tracking.
-- Also adds indexes recommended by S07 for dashboard query performance.
--
-- Cache semantics (per S07):
--   cache_read_input_tokens     = cache hit (cheap)
--   cache_creation_input_tokens = cache write (premium — never conflate with cache_read)
--
-- Populated from DeepInfra / gemma-4-26B API responses on every Brief /
-- Analyst / Synthesis / Search-Agent-turn call.

ALTER TABLE audit
  ADD COLUMN IF NOT EXISTS input_tokens                 INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens                INTEGER,
  ADD COLUMN IF NOT EXISTS cache_read_input_tokens      INTEGER,
  ADD COLUMN IF NOT EXISTS cache_creation_input_tokens  INTEGER;

-- Indexes for Metabase dashboard widget queries (S07 §17.3)
CREATE INDEX IF NOT EXISTS idx_audit_created_at_status
  ON audit (created_at DESC, (payload->>'status'));

CREATE INDEX IF NOT EXISTS idx_audit_slot_name
  ON audit ((payload->>'slot_name'));
