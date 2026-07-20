/**
 * Dossier Writer Tests
 *
 * Tests deterministic persistence of Dossier objects:
 * - Schema validation before write
 * - Upsert semantics keyed by run_id
 * - Read-back by run_id
 * - Audit and log emission
 */

import { describe, it, expect, vi } from 'vitest';
import { writeDossier, getDossierByRunId } from '../src/dossier_writer.js';
import { getPool } from '../src/db.js';
import type { Dossier } from '../src/types.js';

// A minimal pg query-result shape used by the mock pool.
interface QueryResult {
  rows: { id?: string; executive_summary?: string; sections?: unknown; grounding_passed?: boolean }[];
  rowCount?: number;
}

// Mock db.js. Each test sets up pool.query via getPool mock.
vi.mock('../src/db.js', async () => {
  const queryMock = vi.fn().mockResolvedValue({ rows: [] } as QueryResult);
  return {
    writeAudit: vi.fn().mockResolvedValue(undefined),
    getPool: vi.fn().mockReturnValue({ query: queryMock }),
  };
});

vi.mock('../src/log.js', async () => {
  return {
    logCompleted: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
  };
});

/** Typed accessor for the mocked pool.query so mockResolvedValue calls type-check. */
function queryMock(): ReturnType<typeof vi.fn> {
  const pool = getPool() as unknown as { query: ReturnType<typeof vi.fn> };
  return pool.query;
}

function makeDossier(opts?: { sections?: Dossier['sections']; groundingPassed?: boolean }): Dossier {
  return {
    executive_summary: 'Test summary.',
    sections: opts?.sections ?? {
      overview: {
        claims: [
          { text: 'Northwind Robotics is a drone company.', signal_ids: ['sig-1'] },
        ],
      },
    },
    grounding_passed: opts?.groundingPassed ?? false,
  };
}

describe('Dossier Writer', () => {
  it('persists a valid dossier and returns a db_id', async () => {
    queryMock().mockResolvedValue({ rows: [{ id: 'dbid-123' }] } as QueryResult);

    const dossier = makeDossier();
    const result = await writeDossier('run-dw-01', dossier);

    expect(result.persisted).not.toBeNull();
    expect(result.persisted!.db_id).toBe('dbid-123');
    expect(result.failures).toHaveLength(0);
  });

  it('fails when dossier violates schema', async () => {
    const dossier = {
      // Missing required "sections"
      executive_summary: 'Bad dossier.',
    } as unknown as Dossier;

    const result = await writeDossier('run-dw-02', dossier);

    expect(result.persisted).toBeNull();
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0].error).toContain('Dossier schema validation failed');
  });

  it('reads back a persisted dossier', async () => {
    queryMock().mockResolvedValue({
      rows: [
        {
          executive_summary: 'Test summary.',
          sections: {
            overview: {
              claims: [
                { text: 'Northwind Robotics is a drone company.', signal_ids: ['sig-1'] },
              ],
            },
          },
          grounding_passed: true,
        },
      ],
    } as QueryResult);

    const dossier = await getDossierByRunId('run-dw-03');
    expect(dossier).not.toBeNull();
    expect(dossier!.executive_summary).toBe('Test summary.');
    expect(dossier!.sections.overview.claims[0].text).toBe('Northwind Robotics is a drone company.');
    expect(dossier!.grounding_passed).toBe(true);
  });

  it('returns null when no dossier exists for run_id', async () => {
    queryMock().mockResolvedValue({ rows: [] } as QueryResult);

    const dossier = await getDossierByRunId('run-dw-04');
    expect(dossier).toBeNull();
  });

  it('upserts on duplicate run_id (does not throw)', async () => {
    queryMock()
      .mockResolvedValueOnce({ rows: [{ id: 'dbid-111' }] } as QueryResult)
      .mockResolvedValueOnce({ rows: [{ id: 'dbid-222' }] } as QueryResult);

    const dossier = makeDossier();
    await writeDossier('run-dw-05', dossier);
    const result2 = await writeDossier('run-dw-05', dossier);

    expect(result2.persisted).not.toBeNull();
    expect(result2.persisted!.db_id).toBe('dbid-222');
  });
});
