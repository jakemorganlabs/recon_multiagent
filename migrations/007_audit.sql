-- Migration 007: audit
-- Immutable log of significant state transitions for compliance / debug.

CREATE TABLE IF NOT EXISTS audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_run_id_created
  ON audit(run_id, created_at DESC);
