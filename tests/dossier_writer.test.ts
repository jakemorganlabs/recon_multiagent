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
import type { Dossier } from '../src/types.js';

// Mock db.js — each test sets up pool.query via getPool mock
vi.mock('../src/db.js', async () => {
  return {
    writeAudit: vi.fn().mockResolvedValue(undefined),
    getPool: vi.fn().mockReturnValue({ query: vi.fn() }),
  };
});

vi.mock('../src/log.js', async () => {
  return {
    logCompleted: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
  };
});

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
    const { getPool } = await import('../src/db.js');
    const pool = getPool();
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ id: 'dbid-123' }] });

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
    const { getPool } = await import('../src/db.js');
    const pool = getPool();
    vi.mocked(pool.query).mockResolvedValue({
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
    });

    const dossier = await getDossierByRunId('run-dw-03');
    expect(dossier).not.toBeNull();
    expect(dossier!.executive_summary).toBe('Test summary.');
    expect(dossier!.sections.overview.claims[0].text).toBe('Northwind Robotics is a drone company.');
    expect(dossier!.grounding_passed).toBe(true);
  });

  it('returns null when no dossier exists for run_id', async () => {
    const { getPool } = await import('../src/db.js');
    const pool = getPool();
    vi.mocked(pool.query).mockResolvedValue({ rows: [] });

    const dossier = await getDossierByRunId('run-dw-04');
    expect(dossier).toBeNull();
  });

  it('upserts on duplicate run_id (does not throw)', async () => {
    const { getPool } = await import('../src/db.js');
    const pool = getPool();
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ id: 'dbid-111' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'dbid-222' }] });

    const dossier = makeDossier();
    await writeDossier('run-dw-05', dossier);
    const result2 = await writeDossier('run-dw-05', dossier);

    expect(result2.persisted).not.toBeNull();
    expect(result2.persisted!.db_id).toBe('dbid-222');
  });
});
