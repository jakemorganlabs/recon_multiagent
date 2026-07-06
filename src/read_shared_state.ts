/**
 * Read Shared State Tool
 *
 * The ONLY tool available to the Analyst Agent (and later, Synthesis Agent).
 * Takes a run_id and returns the evidence rows the Search Agent gathered.
 * There is NO path to the open web from this tool.
 *
 * This is what makes the Analyst "sealed from the web" — not a prompt
 * instruction the model might forget, but a structural property of the
 * tool binding: the Analyst node has only this tool, so it cannot fetch.
 *
 * No Anthropic code. Deterministic DB read only.
 */

import { getPool } from './db.js';
import type { EvidenceItem } from './types.js';

export interface ReadSharedStateInput {
  run_id: string;
  /** Optional: only return evidence matching this query substring */
  queryFilter?: string;
  /** Optional: limit number of evidence items returned (oldest first) */
  limit?: number;
}

export interface ReadSharedStateOutput {
  run_id: string;
  evidenceCount: number;
  evidence: EvidenceItem[];
}

/**
 * Read evidence rows for a given run_id.
 * Ordered by retrieval_rank asc, then fetched_at desc.
 */
export async function readSharedState(
  input: ReadSharedStateInput
): Promise<ReadSharedStateOutput> {
  const { run_id, queryFilter, limit } = input;
  const pool = getPool();

  let sql = `
    SELECT
      evidence_id,
      query,
      source_url,
      page_title,
      snippet,
      fetched_text,
      content_hash,
      retrieval_rank,
      fetched_at
    FROM evidence
    WHERE run_id = $1
  `;
  const params: (string | number)[] = [run_id];

  if (queryFilter) {
    sql += ` AND query ILIKE $2`;
    params.push(`%${queryFilter}%`);
  }

  sql += ` ORDER BY retrieval_rank ASC NULLS LAST, fetched_at DESC`;

  if (limit) {
    sql += ` LIMIT $${params.length + 1}`;
    params.push(limit);
  }

  const res = await pool.query<{
    evidence_id: string;
    query: string;
    source_url: string;
    page_title: string | null;
    snippet: string;
    fetched_text: string | null;
    content_hash: string;
    retrieval_rank: number | null;
    fetched_at: string;
  }>(sql, params);

  const evidence: EvidenceItem[] = res.rows.map((row) => ({
    evidence_id: row.evidence_id,
    query: row.query,
    source_url: row.source_url,
    page_title: row.page_title ?? undefined,
    snippet: row.snippet,
    fetched_text: row.fetched_text ?? undefined,
    content_hash: row.content_hash,
    retrieval_rank: row.retrieval_rank ?? undefined,
    fetched_at: row.fetched_at,
  }));

  return {
    run_id,
    evidenceCount: evidence.length,
    evidence,
  };
}
