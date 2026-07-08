/**
 * Signal Writer
 *
 * Persists Analyst Agent outputs to the signal table.
 * Steps:
 * 1. Validates each signal against signal.schema.json.
 * 2. Upserts (idempotent): ON CONFLICT (run_id, signal_id) DO UPDATE.
 * 3. Returns persisted IDs + any failures.
 *
 *
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { getPool, writeAudit } from './db.js';
import { logCompleted, logError } from './log.js';
import type { Signal } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '../schemas/signal.schema.json');
const signalSchema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateSignal = ajv.compile(signalSchema);

export interface SignalWriteResult {
  persisted: { signal_id: string; slot: string; db_id: string }[];
  failures: { signal_id?: string; error: string }[];
  totalAttempted: number;
}

/**
 * Persist one signal. Idempotent by (run_id, signal_id).
 *
 * Non-filled signals have value/confidence nulled during write.
 */
export async function persistSignal(
  runId: string,
  signal: Signal
): Promise<string> {
  const valid = validateSignal(signal);
  if (!valid) {
    const errors = validateSignal.errors ?? [{ message: 'Unknown error' }];
    const msg = errors
      .map((e) => `${'instancePath' in e ? e.instancePath : '?'} ${e.message}`)
      .join('; ');
    throw new Error(`Signal schema validation failed: ${msg}`);
  }

  const pool = getPool();
  const res = await pool.query<{ id: string }>(
    `INSERT INTO signal
       (run_id, signal_id, slot, status, value, confidence, rationale, evidence_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (run_id, signal_id) DO UPDATE SET
       slot          = EXCLUDED.slot,
       status        = EXCLUDED.status,
       value         = EXCLUDED.value,
       confidence    = EXCLUDED.confidence,
       rationale     = EXCLUDED.rationale,
       evidence_ids  = EXCLUDED.evidence_ids
     RETURNING id`,
    [
      runId,
      signal.signal_id,
      signal.slot,
      signal.status,
      signal.status === 'filled' ? signal.value : null,
      signal.status === 'filled' ? signal.confidence : null,
      signal.rationale ?? null,
      JSON.stringify(signal.evidence_ids),
    ]
  );
  return res.rows[0].id;
}

/**
 * Batch-persist Analyst signals. Covers the entire output in one call.
 * Idempotent: rerunning with same signals overwrites rather than duplicates.
 */
export async function persistSignals(
  runId: string,
  signals: Signal[]
): Promise<SignalWriteResult> {
  const start = performance.now();
  const persisted: SignalWriteResult['persisted'] = [];
  const failures: SignalWriteResult['failures'] = [];

  for (const signal of signals) {
    try {
      const dbId = await persistSignal(runId, signal);
      persisted.push({ signal_id: signal.signal_id, slot: signal.slot, db_id: dbId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(runId, 'signal_writer', 0, msg);
      failures.push({ signal_id: signal.signal_id, error: msg });
    }
  }

  const latency = performance.now() - start;
  logCompleted(runId, 'signal_writer', latency, {
    attempted: signals.length,
    persisted: persisted.length,
    failures: failures.length,
  });

  await writeAudit(runId, 'signals_persisted', {
    attempted: signals.length,
    persisted: persisted.length,
    failure_count: failures.length,
  });

  return {
    persisted,
    failures,
    totalAttempted: signals.length,
  };
}
