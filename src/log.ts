/**
 * Structured Logger
 *
 * Emits one JSON line per event to stdout.
 * Mandatory fields: run_id, stage, status, latency_ms.
 * Optional fields: model_id, tokens, error, extra.
 *
 * Long fields (brief content, evidence text) are truncated to first 200 chars.
 */

export interface LogEntry {
  /** ISO timestamp */
  ts: string;
  /** Log level */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Which run this event belongs to (UUID) */
  run_id: string;
  /** Pipeline stage name */
  stage: string;
  /** Outcome of this stage */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'clarify' | 'aborted';
  /** Wall-clock latency in milliseconds */
  latency_ms: number;
  /** Model used (if applicable) */
  model_id?: string;
  /** Total tokens consumed (if applicable) */
  tokens?: number;
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
  if (entry.error !== undefined) out.error = entry.error;
  if (entry.extra !== undefined) out.extra = truncateDeep(entry.extra);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out));
}

/** Convenience: emit an info log for a completed stage. */
export function logCompleted(
  run_id: string,
  stage: string,
  latency_ms: number,
  extra?: Record<string, unknown>
): void {
  log({
    ts: new Date().toISOString(),
    level: 'info',
    run_id,
    stage,
    status: 'completed',
    latency_ms,
    extra,
  });
}

/** Convenience: emit an error log. */
export function logError(
  run_id: string,
  stage: string,
  latency_ms: number,
  error: string,
  extra?: Record<string, unknown>
): void {
  log({
    ts: new Date().toISOString(),
    level: 'error',
    run_id,
    stage,
    status: 'failed',
    latency_ms,
    error,
    extra,
  });
}
