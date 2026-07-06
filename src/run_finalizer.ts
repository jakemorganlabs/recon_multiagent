/**
 * Run Finalizer
 *
 * Determines the final run status after grounding, persists the final dossier,
 * updates the run row, and writes a grounding audit summary.
 *
 * Status decision tree:
 * - complete:    all claims verified (claims_verified == claims_total)
 * - insufficient: >= 50% of claims were recast as gaps OR claims_total == 0
 * - gapped:       some recast, but < 50% of total claims
 *
 * No Anthropic code. Pure deterministic orchestration.
 */

import { updateRunStatus, writeAudit } from './db.js';
import { writeDossier } from './dossier_writer.js';
import { logCompleted, logError } from './log.js';
import type { Dossier, Brief } from './types.js';

export interface FinalizerInput {
  runId: string;
  dossier: Dossier;
  claimsTotal: number;
  claimsVerified: number;
  recastGaps: number;
  brief: Brief;
}

export interface FinalizerResult {
  runId: string;
  status: 'complete' | 'gapped' | 'insufficient' | 'failed';
  dumpedDossier: boolean;
  dbId: string | null;
}

/**
 * Finalize a run after the grounding gate.
 *
 * 1. Persist the grounded dossier (upsert by run_id).
 * 2. Determine run status based on claim verification rates.
 * 3. Update run.status in the DB.
 * 4. Write grounding audit summary.
 */
export async function finalizeRun(
  input: FinalizerInput
): Promise<FinalizerResult> {
  const { runId, dossier, claimsTotal, claimsVerified, recastGaps } = input;
  const start = performance.now();

  // 1. Persist dossier
  let dbId: string | null = null;
  let persistFailed = false;
  try {
    const writeResult = await writeDossier(runId, dossier);
    if (writeResult.persisted) {
      dbId = writeResult.persisted.db_id;
    }
  } catch (err) {
    persistFailed = true;
    const msg = err instanceof Error ? err.message : String(err);
    logError(runId, 'run_finalizer', performance.now() - start, msg);
    await writeAudit(runId, 'finalizer_dossier_write_failed', { error: msg });
  }

  // 2. Determine status
  let status: FinalizerResult['status'];
  if (persistFailed) {
    status = 'failed';
  } else if (claimsTotal === 0) {
    status = 'insufficient';
  } else if (claimsVerified === claimsTotal) {
    status = 'complete';
  } else {
    const gapRatio = recastGaps / claimsTotal;
    status = gapRatio >= 0.5 ? 'insufficient' : 'gapped';
  }

  // 3. Update run status
  try {
    await updateRunStatus(runId, status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(runId, 'run_finalizer', performance.now() - start, msg);
    await writeAudit(runId, 'finalizer_status_update_failed', { error: msg });
    status = 'failed';
  }

  const latency = performance.now() - start;
  logCompleted(runId, 'run_finalizer', latency, {
    status,
    claims_total: claimsTotal,
    claims_verified: claimsVerified,
    recast_gaps: recastGaps,
    db_id: dbId,
  });

  await writeAudit(runId, 'run_finalized', {
    status,
    claims_total: claimsTotal,
    claims_verified: claimsVerified,
    recast_gaps: recastGaps,
    db_id: dbId,
  });

  return {
    runId,
    status,
    dumpedDossier: dbId !== null,
    dbId,
  };
}

/**
 * Convenience: compute status without persisting anything.
 * Useful in tests and dry-run modes.
 */
export function determineRunStatus(
  claimsTotal: number,
  claimsVerified: number,
  recastGaps: number
): 'complete' | 'gapped' | 'insufficient' {
  if (claimsTotal === 0) return 'insufficient';
  if (claimsVerified === claimsTotal) return 'complete';
  const gapRatio = recastGaps / claimsTotal;
  return gapRatio >= 0.5 ? 'insufficient' : 'gapped';
}
