-- Migration 003: evidence
-- Every retrieved web passage with full provenance.
-- content_hash, source_url, snippet, fetched_at are mandatory for re-checkability.

CREATE TABLE IF NOT EXISTS evidence (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  evidence_id      TEXT NOT NULL,
  query            TEXT NOT NULL,
  source_url       TEXT NOT NULL,
  page_title       TEXT,
  snippet          TEXT NOT NULL,
  fetched_text     TEXT,                     -- optional full fetched text
  content_hash     TEXT NOT NULL,             -- sha256(fetched_text)
  retrieval_rank   INT,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_evidence_run_evidence_id UNIQUE (run_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_run_id
  ON evidence(run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_source_url
  ON evidence(source_url);
