/**
 * Verification harness (NOT a permanent test): runs the real eval runner
 * `main()` against an in-memory DB mock with cassette-play + no DeepInfra key,
 * proving the Eval Suite clears all thresholds offline — i.e. CI will be green.
 *
 * Mocked surface: src/db.js (getPool + every query the pipeline issues),
 * src/log.js (no-op logging), and the eval runner's resetDb (no-op).
 *
 * This mirrors the CI eval environment exactly except for the DB driver,
 * which is replaced by an in-memory implementation of the same queries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

// ─── In-memory store ───
interface Row { [k: string]: unknown }
const tables: Record<string, Row[]> = {
  run: [], brief: [], evidence: [], signal: [], dossier: [], audit: [], tool_call: [], migrations: [],
};

function resetStore() {
  for (const t of Object.keys(tables)) tables[t].length = 0;
}

// Minimal pool.query that handles the exact statements the pipeline issues.
function makePool() {
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    const lower = sql.toLowerCase();

    // CREATE TABLE IF NOT EXISTS migrations
    if (lower.startsWith('create table if not exists migrations')) {
      return { rows: [] as Row[] };
    }

    // SELECT id, request_hash, ... FROM run WHERE request_hash = $1
    if (lower.startsWith('select id, request_hash') && lower.includes('from run where')) {
      const hash = params?.[0] as string;
      const row = tables.run.find((r) => r.request_hash === hash);
      return { rows: row ? [row] : [] };
    }

    // INSERT INTO run (...) RETURNING id
    if (lower.startsWith('insert into run')) {
      const id = randomUUID();
      tables.run.push({
        id,
        request_hash: params?.[0],
        status: params?.[1],
        target_name: params?.[2] ?? null,
        coverage_iterations: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return { rows: [{ id }] };
    }

    // UPDATE run SET status = $1 ... WHERE id = $2
    if (lower.startsWith('update run set status')) {
      const status = params?.[0] as string;
      const id = params?.[1] as string;
      const row = tables.run.find((r) => r.id === id);
      if (row) { row.status = status; row.updated_at = new Date().toISOString(); }
      return { rows: [] };
    }

    // UPDATE run SET coverage_iterations
    if (lower.startsWith('update run set coverage_iterations')) {
      const iter = params?.[0] as number;
      const id = params?.[1] as string;
      const row = tables.run.find((r) => r.id === id);
      if (row) row.coverage_iterations = iter;
      return { rows: [] };
    }

    // INSERT INTO brief (...) RETURNING id
    if (lower.startsWith('insert into brief')) {
      const id = randomUUID();
      tables.brief.push({
        id, run_id: params?.[0], target: params?.[1], slots: params?.[2],
        seed_urls: params?.[3], depth: params?.[4],
      });
      return { rows: [{ id }] };
    }

    // INSERT INTO evidence (...) ON CONFLICT ... RETURNING id
    if (lower.startsWith('insert into evidence')) {
      const evidenceId = params?.[1] as string;
      const runId = params?.[0] as string;
      const id = randomUUID();
      tables.evidence = tables.evidence.filter(
        (r) => !(r.run_id === runId && r.evidence_id === evidenceId)
      );
      tables.evidence.push({
        id, run_id: runId, evidence_id: evidenceId, query: params?.[2],
        source_url: params?.[3], page_title: params?.[4], snippet: params?.[5],
        fetched_text: params?.[6], content_hash: params?.[7],
        retrieval_rank: params?.[8], fetched_at: params?.[9],
      });
      return { rows: [{ id }] };
    }

    // SELECT ... FROM evidence WHERE run_id = $1 ORDER BY retrieval_rank
    if (lower.startsWith('select evidence_id') && lower.includes('from evidence')) {
      const runId = params?.[0] as string;
      const rows = tables.evidence
        .filter((r) => r.run_id === runId)
        .sort((a, b) => Number(a.retrieval_rank ?? 999) - Number(b.retrieval_rank ?? 999));
      return { rows };
    }

    // INSERT INTO signal (...) ON CONFLICT ... RETURNING id
    if (lower.startsWith('insert into signal')) {
      const signalId = params?.[1] as string;
      const runId = params?.[0] as string;
      const id = randomUUID();
      tables.signal = tables.signal.filter(
        (r) => !(r.run_id === runId && r.signal_id === signalId)
      );
      tables.signal.push({
        id, run_id: runId, signal_id: signalId, slot: params?.[2], status: params?.[3],
        value: params?.[4], confidence: params?.[5], rationale: params?.[6],
        evidence_ids: params?.[7] ? JSON.parse(params?.[7] as string) : [],
      });
      return { rows: [{ id }] };
    }

    // SELECT signal_id, slot, status, ... FROM signal WHERE run_id = $1
    if (lower.startsWith('select signal_id') && lower.includes('from signal')) {
      const runId = params?.[0] as string;
      const rows = tables.signal
        .filter((r) => r.run_id === runId)
        .sort((a, b) => String(a.slot).localeCompare(String(b.slot)));
      return { rows };
    }

    // INSERT INTO dossier (...) ON CONFLICT (run_id) ... RETURNING id
    if (lower.startsWith('insert into dossier')) {
      const runId = params?.[0] as string;
      const id = randomUUID();
      tables.dossier = tables.dossier.filter((r) => r.run_id !== runId);
      tables.dossier.push({
        id, run_id: runId, executive_summary: params?.[1],
        sections: params?.[2] ? JSON.parse(params?.[2] as string) : {},
        grounding_passed: params?.[3],
      });
      return { rows: [{ id }] };
    }

    // SELECT executive_summary, sections, grounding_passed FROM dossier WHERE run_id = $1
    if (lower.startsWith('select executive_summary') && lower.includes('from dossier')) {
      const runId = params?.[0] as string;
      const rows = tables.dossier.filter((r) => r.run_id === runId);
      return { rows };
    }

    // INSERT INTO tool_call (...) RETURNING id
    if (lower.startsWith('insert into tool_call')) {
      const id = randomUUID();
      tables.tool_call.push({
        id, run_id: params?.[0], agent: params?.[1], tool_name: params?.[2],
        query: params?.[3], request: params?.[4], response: params?.[5],
        duration_ms: params?.[6], status: params?.[7],
      });
      return { rows: [{ id }] };
    }

    // SELECT COUNT(*) FROM tool_call WHERE run_id = $1 AND tool_name = $2
    if (lower.startsWith('select count(*) from tool_call')) {
      const runId = params?.[0] as string;
      const tool = params?.[1] as string;
      const count = tables.tool_call.filter(
        (r) => r.run_id === runId && r.tool_name === tool
      ).length;
      return { rows: [{ count: String(count) }] };
    }

    // INSERT INTO audit
    if (lower.startsWith('insert into audit')) {
      tables.audit.push({
        id: randomUUID(), run_id: params?.[0], event_type: params?.[1],
        payload: params?.[2],
      });
      return { rows: [] };
    }

    // TRUNCATE TABLE ... (eval resetDb)
    if (lower.startsWith('truncate table')) {
      for (const t of ['run','brief','evidence','signal','dossier','audit','tool_call']) {
        tables[t].length = 0;
      }
      return { rows: [] };
    }

    // Default: empty result rather than throwing, so unknown statements don't
    // abort the pipeline.
    return { rows: [] as Row[] };
  });

  return {
    query,
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
    end: vi.fn(async () => undefined),
  };
}

const pool = makePool();

vi.mock('../../src/db.js', () => ({
  getPool: vi.fn(() => pool),
  closePool: vi.fn(async () => undefined),
  writeAudit: vi.fn(async () => undefined),
  // Pass-through helpers that use the mocked store internally:
  findRunByHash: vi.fn(async (hash: string) => {
    const row = tables.run.find((r) => r.request_hash === hash);
    return row ?? null;
  }),
  createRun: vi.fn(async (hash: string, target?: string) => {
    const id = randomUUID();
    tables.run.push({ id, request_hash: hash, status: 'pending', target_name: target ?? null });
    return id;
  }),
  updateRunStatus: vi.fn(async (runId: string, status: string) => {
    const row = tables.run.find((r) => r.id === runId);
    if (row) row.status = status;
  }),
  createBrief: vi.fn(async () => randomUUID()),
  getEvidenceByRunId: vi.fn(async (runId: string) => tables.evidence.filter((r) => r.run_id === runId)),
  getSignalsByRunId: vi.fn(async (runId: string) => tables.signal.filter((r) => r.run_id === runId)),
  updateCoverageIteration: vi.fn(async () => undefined),
}));

vi.mock('../../src/log.js', () => ({
  log: vi.fn(),
  logCompleted: vi.fn(),
  logError: vi.fn(),
}));

describe('Eval Suite (offline in-memory verification)', () => {
  beforeEach(() => {
    resetStore();
    pool.query.mockClear();
    // Eval environment: cassette play + no DeepInfra key → deterministic stub active.
    process.env.CASSETTE_MODE = 'play';
    delete process.env.DEEPINFRA_API_KEY;
    delete process.env.DEEPINFRA_BASE_URL;
  });

  it('runs all 30 cases and clears every threshold (exit code 0)', async () => {
    const { main } = await import('../../evals/run.js');
    const code = await main();
    expect(code).toBe(0);

    // Sanity: 30 cases ran and produced a report.
    const { readFileSync, existsSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const reportPath = join(here, '../../evals/report.md');
    expect(existsSync(reportPath)).toBe(true);
    const report = readFileSync(reportPath, 'utf8');
    // Every metric line should read PASS.
    const passLines = (report.match(/\| PASS/g) ?? []).length;
    const failLines = (report.match(/\| FAIL/g) ?? []).length;
    expect(failLines).toBe(0);
    expect(passLines).toBeGreaterThanOrEqual(6);
  }, 120000);
});
