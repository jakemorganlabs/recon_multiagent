-- Migration 004: signal
-- Structured fact for a named slot, citing the evidence it came from.

CREATE TYPE signal_status AS ENUM ('filled', 'insufficient_evidence', 'abstain');

CREATE TABLE IF NOT EXISTS signal (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  signal_id     TEXT NOT NULL,
  slot          TEXT NOT NULL,
  status        signal_status NOT NULL DEFAULT 'abstain',
  value         TEXT,                        -- null when abstaining / insufficient
  confidence    NUMERIC(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  rationale     TEXT,
  evidence_ids  JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_signal_run_signal_id UNIQUE (run_id, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_run_id
  ON signal(run_id);
CREATE INDEX IF NOT EXISTS idx_signal_slot_status
  ON signal(slot, status);
