-- Migration 006: dossier
-- Final structured report with per-slot sections and claim-level citations.

CREATE TABLE IF NOT EXISTS dossier (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  executive_summary TEXT,
  sections         JSONB NOT NULL DEFAULT '{}',
  grounding_passed BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_dossier_run_id UNIQUE (run_id)
);

CREATE INDEX IF NOT EXISTS idx_dossier_run_id
  ON dossier(run_id);
