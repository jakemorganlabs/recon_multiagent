/**
 * Dossier Writer
 *
 * Persists Synthesis Agent outputs to the dossier table.
 * Steps:
 * 1. Validate Dossier against dossier.schema.json.
 * 2. Upserts (idempotent): ON CONFLICT (run_id) DO UPDATE.
 * 3. Returns persisted ID + any failures.
 *
 * Invariant: the Dossier schema is checked BEFORE write; invalid objects never reach the DB.
 * Deliberately does NOT: rewrite claims, synthesize new citations, or invoke any model.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { getPool, writeAudit } from './db.js';
import { logCompleted, logError } from './log.js';
import type { Dossier } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '../schemas/dossier.schema.json');
const dossierSchema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateDossier = ajv.compile(dossierSchema);

export interface DossierWriteResult {
  persisted: { run_id: string; db_id: string } | null;
  failures: { error: string }[];
}

/**
 * Persist a Dossier. Idempotent by run_id (upsert).
 */
export async function persistDossier(
  runId: string,
  dossier: Dossier
): Promise<string> {
  const valid = validateDossier(dossier);
  if (!valid) {
    const errors = validateDossier.errors ?? [{ message: 'Unknown error' }];
    const msg = errors
      .map((e) => `${'instancePath' in e ? e.instancePath : '?'} ${e.message}`)
      .join('; ');
    throw new Error(`Dossier schema validation failed: ${msg}`);
  }

  const pool = getPool();
  const res = await pool.query<{ id: string }>(
    `INSERT INTO dossier
       (run_id, executive_summary, sections, grounding_passed)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (run_id) DO UPDATE SET
       executive_summary = EXCLUDED.executive_summary,
       sections          = EXCLUDED.sections,
       grounding_passed  = EXCLUDED.grounding_passed,
       created_at        = now()
     RETURNING id`,
    [
      runId,
      dossier.executive_summary ?? null,
      JSON.stringify(dossier.sections),
      dossier.grounding_passed ?? false,
    ]
  );
  return res.rows[0].id;
}

/**
 * Write a Dossier with full logging and audit.
 * Returns write result regardless of success/failure.
 */
export async function writeDossier(
  runId: string,
  dossier: Dossier
): Promise<DossierWriteResult> {
  const start = performance.now();

  try {
    const dbId = await persistDossier(runId, dossier);
    const latency = performance.now() - start;

    logCompleted(runId, 'dossier_writer', latency, {
      db_id: dbId,
      section_count: Object.keys(dossier.sections).length,
      grounding_passed: dossier.grounding_passed ?? false,
    });

    await writeAudit(runId, 'dossier_persisted', {
      db_id: dbId,
      section_count: Object.keys(dossier.sections).length,
      grounding_passed: dossier.grounding_passed ?? false,
    });

    return {
      persisted: { run_id: runId, db_id: dbId },
      failures: [],
    };
  } catch (err) {
    const latency = performance.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    logError(runId, 'dossier_writer', latency, msg);
    await writeAudit(runId, 'dossier_failed', { error: msg });

    return {
      persisted: null,
      failures: [{ error: msg }],
    };
  }
}

/** Read a dossier row for a given run_id. */
export async function getDossierByRunId(
  runId: string
): Promise<Dossier | null> {
  const pool = getPool();
  const res = await pool.query<{
    executive_summary: string | null;
    sections: Record<string, { claims: { text: string; signal_ids: string[]; gap?: boolean }[]; summary?: string }>;
    grounding_passed: boolean;
  }>(
    `SELECT executive_summary, sections, grounding_passed
     FROM dossier
     WHERE run_id = $1`,
    [runId]
  );

  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    executive_summary: row.executive_summary ?? undefined,
    sections: row.sections,
    grounding_passed: row.grounding_passed,
  };
}
