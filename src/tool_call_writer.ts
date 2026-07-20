/**
 * Tool call persistence.
 *
 * Every invocation of search or fetch writes a `tool_call` row matching
 * the S01 migration schema (005_tool_call.sql).
 */

import { getPool } from './db.js';

export interface RecordToolCallInput {
  run_id: string;
  /** Which agent made the call. */
  agent: 'search_agent' | 'analyst_agent' | 'synthesis_agent';
  /** Tool name. search or fetch. */
  tool_name: 'search' | 'fetch';
  /** The search query (optional for fetch calls). */
  query?: string;
  /** Full request payload. */
  request: unknown;
  /** Full response payload. */
  response?: unknown;
  /** Wall-clock duration in ms. */
  duration_ms: number;
  /** Outcome status. */
  status: 'ok' | 'error' | 'timeout' | 'rate_limited';
}

/**
 * Insert a tool_call row for every search or fetch invocation.
 */
export async function recordToolCall(
  data: RecordToolCallInput
): Promise<string> {
  const pool = getPool();
  const res = await pool.query<{ id: string }>(
    `INSERT INTO tool_call
       (run_id, agent, tool_name, query, request, response, duration_ms, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      data.run_id,
      data.agent,
      data.tool_name,
      data.query ?? null,
      JSON.stringify(data.request),
      data.response !== undefined ? JSON.stringify(data.response) : null,
      data.duration_ms,
      data.status,
    ]
  );
  return res.rows[0].id;
}

/**
 * Count how many tool calls of a given type have been recorded for a run.
 * Used by budget enforcement BEFORE the next call is made.
 */
export async function countToolCalls(
  runId: string,
  tool_name: 'search' | 'fetch'
): Promise<number> {
  const pool = getPool();
  const res = await pool.query<{ count: string }>(
    'SELECT COUNT(*) FROM tool_call WHERE run_id = $1 AND tool_name = $2',
    [runId, tool_name]
  );
  return Number(res.rows[0].count);
}
