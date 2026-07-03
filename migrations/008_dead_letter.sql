-- Migration 008: dead_letter
-- Failed / rejected payloads that could not be processed.

CREATE TABLE IF NOT EXISTS dead_letter (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID REFERENCES run(id) ON DELETE SET NULL,
  origin        TEXT NOT NULL,
  payload       JSONB NOT NULL,
  error_type    TEXT,
  error_message TEXT,
  retry_count   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_run_id
  ON dead_letter(run_id);
CREATE INDEX IF NOT EXISTS idx_dead_letter_created
  ON dead_letter(created_at DESC);
