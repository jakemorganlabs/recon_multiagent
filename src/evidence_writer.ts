/**
 * Evidence Persistence
 *
 * Validates every kept evidence item against the EvidenceItem JSON Schema,
 * computes content_hash, and writes it to the `evidence` table.
 *
 * No Anthropic code. Deterministic validation + DB layer.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { getPool } from './db.js';
import type { EvidenceItem } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '../schemas/evidence_item.schema.json');
const evidenceSchema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateEvidence = ajv.compile(evidenceSchema);

export interface PersistEvidenceInput {
  run_id: string;
  item: EvidenceItem;
}

/**
 * Persist an evidence item after validating it against the schema.
 * Throws if schema validation fails (defense in depth).
 */
export async function persistEvidence(
  data: PersistEvidenceInput
): Promise<string> {
  const { run_id, item } = data;

  const valid = validateEvidence(item);
  if (!valid) {
    const errors = validateEvidence.errors ?? [{ message: 'Unknown error' }];
    const msg = errors
      .map((e) => `${'instancePath' in e ? e.instancePath : '?'} ${e.message}`)
      .join('; ');
    throw new Error(`EvidenceItem schema validation failed: ${msg}`);
  }

  // Ensure content_hash is SHA-256 of fetched_text (or snippet fallback)
  const hashSource = item.fetched_text ?? item.snippet;
  const expectedHash = createHash('sha256').update(hashSource).digest('hex');
  if (item.content_hash !== expectedHash) {
    throw new Error(
      `content_hash mismatch: expected ${expectedHash}, got ${item.content_hash}`
    );
  }

  const pool = getPool();
  const res = await pool.query<{ id: string }>(
    `INSERT INTO evidence
       (run_id, evidence_id, query, source_url, page_title,
        snippet, fetched_text, content_hash, retrieval_rank, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (run_id, evidence_id) DO UPDATE SET
        snippet = EXCLUDED.snippet,
        fetched_text = EXCLUDED.fetched_text,
        content_hash = EXCLUDED.content_hash,
        fetched_at = EXCLUDED.fetched_at
     RETURNING id`,
    [
      run_id,
      item.evidence_id,
      item.query,
      item.source_url,
      item.page_title ?? null,
      item.snippet,
      item.fetched_text ?? null,
      item.content_hash,
      item.retrieval_rank ?? null,
      item.fetched_at,
    ]
  );
  return res.rows[0].id;
}

/**
 * Batch-persist multiple evidence items. Each is validated independently.
 * Returns an array of inserted IDs and a record of any failures.
 */
export async function persistEvidenceBatch(
  run_id: string,
  items: EvidenceItem[]
): Promise<{ ids: string[]; failures: { index: number; error: string }[] }> {
  const ids: string[] = [];
  const failures: { index: number; error: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    try {
      const id = await persistEvidence({ run_id, item: items[i] });
      ids.push(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ index: i, error: msg });
    }
  }

  return { ids, failures };
}
