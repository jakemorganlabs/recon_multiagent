-- Migration 005: tool_call
-- Record of every tool invocation for audit and budget tracking.

CREATE TABLE IF NOT EXISTS tool_call (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  agent         TEXT NOT NULL,
  tool_name     TEXT NOT NULL,
  query         TEXT,
  request       JSONB NOT NULL DEFAULT '{}',
  response      JSONB,
  duration_ms   INT,
  status        TEXT NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok','error','timeout','rate_limited')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_call_run_id
  ON tool_call(run_id);
CREATE INDEX IF NOT EXISTS idx_tool_call_agent_created
  ON tool_call(agent, created_at DESC);
