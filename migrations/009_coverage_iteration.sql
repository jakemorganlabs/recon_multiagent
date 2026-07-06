-- Migration 009: coverage_iteration
-- Add deterministic coverage loop counter to the run table.
-- Tracked by the orchestrator, not the model.

ALTER TABLE run
  ADD COLUMN IF NOT EXISTS coverage_iterations INT NOT NULL DEFAULT 0;

-- Backfill existing rows to 0 so the NOT NULL constraint passes
UPDATE run SET coverage_iterations = 0 WHERE coverage_iterations IS NULL;
