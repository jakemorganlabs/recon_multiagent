-- Migration 001: run
-- Parent table for every research request. request_hash enforces idempotency.

CREATE TABLE IF NOT EXISTS run (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_hash  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','aborted',
                      'search_complete','clarify','complete','gapped','insufficient')),
  target_name   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_run_request_hash
  ON run(request_hash);

CREATE INDEX IF NOT EXISTS idx_run_status_created
  ON run(status, created_at DESC);
