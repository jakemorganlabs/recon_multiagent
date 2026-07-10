/**
 * Structured Logger
 *
 * Emits one JSON line per event to stdout.
 * Mandatory fields per S17.1: run_id, stage, status, latency_ms.
 * Optional per-stage extras: model_id, tokens, similarity_top, gate_fired.
 *
 * Stages: request_trigger, brief_normalize, search_agent_turns, analyst,
 * coverage_check, synthesis, grounding_gate, persist.
 * (Per-component sub-stages — analyst_agent, search_agent, synthesis_agent,
 * dossier_writer, signal_writer, run_finalizer, pipeline, pipeline_end_to_end,
 * brief_clarify, brief_created — are also accepted so each component can log
 * its own lifecycle without colliding with the canonical pipeline stages.)
 *
 * Long fields (brief content, evidence text, dossier prose) truncated to 200 chars.
 * Full content belongs in the audit row, not the log line.
 */

export interface LogEntry {
  /** ISO timestamp */
  ts: string;
  /** Log level */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Which run this event belongs to (UUID) */
  run_id: string;
  /** Pipeline stage name */
  stage:
    | 'request_trigger'
    | 'brief_normalize'
    | 'brief_clarify'
    | 'brief_created'
    | 'search_agent_turns'
    | 'search_agent'
    | 'analyst'
    | 'analyst_agent'
    | 'coverage_check'
    | 'synthesis'
    | 'synthesis_agent'
    | 'grounding_gate'
    | 'persist'
    | 'dossier_writer'
    | 'signal_writer'
    | 'run_finalizer'
    | 'pipeline'
    | 'pipeline_end_to_end';
  /** Outcome of this stage */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'clarify' | 'aborted';
  /** Wall-clock latency in milliseconds */
  latency_ms: number;
  /** Model used (if applicable) */
  model_id?: string;
  /** Total tokens consumed (if applicable) */
  tokens?: number;
  /** Top similarity score from search (Search Agent stage) */
  similarity_top?: number;
  /** Whether the grounding gate fired (Grounding Gate stage) */
  gate_fired?: boolean;
  /** Error message (if status === 'failed') */
  error?: string;
  /** Arbitrary extra fields; long values are truncated. */
  extra?: Record<string, unknown>;
}

const TRUNCATE_AT = 200;

function truncateString(value: unknown): unknown {
  if (typeof value === 'string' && value.length > TRUNCATE_AT) {
    return value.slice(0, TRUNCATE_AT) + '...';
  }
  return value;
}

function truncateDeep(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return truncateString(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(truncateDeep);
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = truncateDeep(v);
  }
  return result;
}

export function log(entry: LogEntry): void {
  const out: Record<string, unknown> = {
    ts: entry.ts,
    level: entry.level,
    run_id: entry.run_id,
    stage: entry.stage,
    status: entry.status,
    latency_ms: entry.latency_ms,
  };

  if (entry.model_id !== undefined) out.model_id = entry.model_id;
  if (entry.tokens !== undefined) out.tokens = entry.tokens;
  if (entry.similarity_top !== undefined) out.similarity_top = entry.similarity_top;
  if (entry.gate_fired !== undefined) out.gate_fired = entry.gate_fired;
  if (entry.error !== undefined) out.error = entry.error;
  if (entry.extra !== undefined) out.extra = truncateDeep(entry.extra);

  console.log(JSON.stringify(out));
}

/** Convenience: emit an info log for a completed stage. */
export function logCompleted(
  runId: string,
  stage: LogEntry['stage'],
  latencyMs: number,
  extra?: Record<string, unknown>
): void {
  log({
    ts: new Date().toISOString(),
    level: 'info',
    run_id: runId,
    stage,
    status: 'completed',
    latency_ms: Math.round(latencyMs),
    extra,
  });
}

/** Convenience: emit an error log. */
export function logError(
  runId: string,
  stage: LogEntry['stage'],
  latencyMs: number,
  error: string,
  extra?: Record<string, unknown>
): void {
  log({
    ts: new Date().toISOString(),
    level: 'error',
    run_id: runId,
    stage,
    status: 'failed',
    latency_ms: Math.round(latencyMs),
    error,
    extra,
  });
}
