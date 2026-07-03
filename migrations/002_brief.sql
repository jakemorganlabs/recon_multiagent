-- Migration 002: brief
-- Structured research request extracted from the raw ask.

CREATE TABLE IF NOT EXISTS brief (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  target        JSONB NOT NULL,
  slots         JSONB NOT NULL DEFAULT '[]',
  seed_urls     JSONB,
  depth         INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brief_run_id
  ON brief(run_id);
