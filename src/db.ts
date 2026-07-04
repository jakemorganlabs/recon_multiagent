/**
 * Shared-state database operations.
 *
 * Exposes idempotent request lookup, run creation, brief writes,
 * audit logging, and status transitions. Uses the PostgreSQL `pg` driver.
 */

import { Pool } from 'pg';
import type { Brief } from './types.js';

export interface RunRow {
  id: string;
  request_hash: string;
  status: string;
  target_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface BriefRow {
  id: string;
  run_id: string;
  target: Brief['target'];
  slots: Brief['slots'];
  seed_urls: string[] | null;
  depth: number;
  created_at: string;
  updated_at: string;
}

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  _pool = new Pool({ connectionString: url });
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/** Lookup a run by request_hash to enforce idempotency. */
export async function findRunByHash(requestHash: string): Promise<RunRow | null> {
  const pool = getPool();
  const res = await pool.query<RunRow>(
    'SELECT id, request_hash, status, target_name, created_at, updated_at FROM run WHERE request_hash = $1',
    [requestHash]
  );
  return res.rows[0] ?? null;
}

/** Create a new run row. Returns the generated run_id. */
export async function createRun(requestHash: string, targetName?: string): Promise<string> {
  const pool = getPool();
  const res = await pool.query<{ id: string }>(
    `INSERT INTO run (request_hash, status, target_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [requestHash, 'pending', targetName ?? null]
  );
  return res.rows[0].id;
}

/** Update the run status. */
export async function updateRunStatus(runId: string, status: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    'UPDATE run SET status = $1, updated_at = now() WHERE id = $2',
    [status, runId]
  );
}

/** Insert a brief row linked to a run. */
export async function createBrief(
  runId: string,
  brief: Brief
): Promise<string> {
  const pool = getPool();
  const res = await pool.query<{ id: string }>(
    `INSERT INTO brief (run_id, target, slots, seed_urls, depth)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      runId,
      JSON.stringify(brief.target),
      JSON.stringify(brief.slots),
      brief.seed_urls ? JSON.stringify(brief.seed_urls) : null,
      brief.depth ?? 1,
    ]
  );
  return res.rows[0].id;
}

/** Insert an audit row for every state transition or significant event. */
export async function writeAudit(
  runId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO audit (run_id, event_type, payload)
     VALUES ($1, $2, $3)`,
    [runId, eventType, JSON.stringify(payload)]
  );
}

/** Convenience: wrap multiple DB operations in a transaction. */
export async function withTransaction<T>(fn: (client: Pool) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(pool);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
