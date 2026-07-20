/**
 * Run Finalizer Tests
 *
 * Tests status determination after grounding:
 * - complete: all claims verified
 * - gapped: some recast, but < 50%
 * - insufficient: >= 50% recast or zero claims
 * - failed: DB errors
 * - Dossier persistence + audit summary writing
 */

import { describe, it, expect, vi } from 'vitest';
import { finalizeRun, determineRunStatus } from '../src/run_finalizer.js';
import type { Brief, Dossier } from '../src/types.js';

// Mock db.js
vi.mock('../src/db.js', async () => {
  return {
    updateRunStatus: vi.fn().mockResolvedValue(undefined),
    writeAudit: vi.fn().mockResolvedValue(undefined),
    getPool: vi.fn().mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'dbid-test' }] }),
    }),
  };
});

// Mock log.js
vi.mock('../src/log.js', async () => {
  return {
    logCompleted: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock dossier_writer.js
vi.mock('../src/dossier_writer.js', async () => {
  return {
    writeDossier: vi.fn().mockResolvedValue({
      persisted: { run_id: 'run-id', db_id: 'dbid-123' },
      failures: [],
    }),
    getDossierByRunId: vi.fn().mockResolvedValue(null),
  };
});

function makeBrief(): Brief {
  return {
    target: { name: 'Northwind Robotics' },
    slots: [
      { slot_name: 'overview', required: true, question: 'What is this company?' },
      { slot_name: 'leadership', required: false, question: 'Who leads it?' },
    ],
  };
}

function makeDossier(claimsTotal: number, recastGaps: number): Dossier {
  const claims: { text: string; signal_ids: string[]; gap?: boolean }[] = [];
  for (let i = 0; i < claimsTotal - recastGaps; i++) {
    claims.push({ text: `Verified claim ${i}.`, signal_ids: ['sig-1'] });
  }
  for (let i = 0; i < recastGaps; i++) {
    claims.push({ text: `Gap claim ${i}.`, signal_ids: [], gap: true });
  }
  return {
    executive_summary: 'Test.',
    sections: { overview: { claims } },
    grounding_passed: recastGaps === 0,
  };
}

describe('Run Finalizer: determineRunStatus', () => {
  it('returns complete when all claims verified', () => {
    expect(determineRunStatus(3, 3, 0)).toBe('complete');
  });

  it('returns complete for zero recasts and non-zero claims', () => {
    expect(determineRunStatus(5, 5, 0)).toBe('complete');
  });

  it('returns gapped when some recast but < 50%', () => {
    expect(determineRunStatus(4, 3, 1)).toBe('gapped');
    expect(determineRunStatus(10, 9, 1)).toBe('gapped');
  });

  it('returns insufficient when >= 50% recast', () => {
    expect(determineRunStatus(4, 0, 2)).toBe('insufficient');
    expect(determineRunStatus(10, 3, 5)).toBe('insufficient');
    expect(determineRunStatus(2, 0, 1)).toBe('insufficient');
  });

  it('returns insufficient when zero total claims', () => {
    expect(determineRunStatus(0, 0, 0)).toBe('insufficient');
  });

  it('returns gapped for threshold edge case exactly 49%', () => {
    // 1 gap out of 20 claims = 5%
    expect(determineRunStatus(20, 19, 1)).toBe('gapped');
  });
});

describe('Run Finalizer: finalizeRun', () => {
  it('finalizes with complete status', async () => {
    const dossier = makeDossier(3, 0);
    const result = await finalizeRun({
      runId: 'run-f-01',
      dossier,
      claimsTotal: 3,
      claimsVerified: 3,
      recastGaps: 0,
      brief: makeBrief(),
    });
    expect(result.status).toBe('complete');
    expect(result.dumpedDossier).toBe(true);
  });

  it('finalizes with gapped status', async () => {
    const dossier = makeDossier(4, 1);
    const result = await finalizeRun({
      runId: 'run-f-02',
      dossier,
      claimsTotal: 4,
      claimsVerified: 3,
      recastGaps: 1,
      brief: makeBrief(),
    });
    expect(result.status).toBe('gapped');
    expect(result.dumpedDossier).toBe(true);
  });

  it('finalizes with insufficient status', async () => {
    const dossier = makeDossier(4, 2);
    const result = await finalizeRun({
      runId: 'run-f-03',
      dossier,
      claimsTotal: 4,
      claimsVerified: 2,
      recastGaps: 2,
      brief: makeBrief(),
    });
    expect(result.status).toBe('insufficient');
  });

  it('returns failed when DB write fails', async () => {
    const { writeDossier } = await import('../src/dossier_writer.js');
    vi.mocked(writeDossier).mockRejectedValueOnce(new Error('DB deadlock'));

    const dossier = makeDossier(2, 0);
    const result = await finalizeRun({
      runId: 'run-f-04',
      dossier,
      claimsTotal: 2,
      claimsVerified: 2,
      recastGaps: 0,
      brief: makeBrief(),
    });

    expect(result.status).toBe('failed');
    expect(result.dumpedDossier).toBe(false);
    expect(result.dbId).toBeNull();
  });
});
