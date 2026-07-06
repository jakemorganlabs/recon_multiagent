/**
 * Grounding Gate Tests
 *
 * Tests the deterministic verification gate that:
 * - Checks every claim's three-hop citation chain
 * - Recasts failed claims as gap notes (never drops)
 * - Keeps dossier structural shape intact
 * - Returns verification counts for status determination
 * - No model judgment; pure deterministic code
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runGroundingGate } from '../src/grounding_gate.js';
import type { Dossier, Signal, EvidenceItem } from '../src/types.js';

// Mock db.js
vi.mock('../src/db.js', async () => {
  return {
    writeAudit: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock log.js
vi.mock('../src/log.js', async () => {
  return {
    logCompleted: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
  };
});

function makeDossier(claims: Dossier['sections']): Dossier {
  return {
    executive_summary: 'Test dossier.',
    sections: claims,
    grounding_passed: false,
  };
}

function makeSignal(signalId: string, slot: string, opts?: Partial<Omit<Signal, 'signal_id' | 'slot'>>): Signal {
  return {
    signal_id: signalId,
    slot,
    status: opts?.status ?? 'filled',
    value: opts?.value ?? 'test value',
    confidence: opts?.confidence ?? 0.85,
    rationale: opts?.rationale ?? 'test rationale',
    evidence_ids: opts?.evidence_ids ?? [],
  };
}

function makeEvidence(evidenceId: string, snippet: string, fetchedText?: string): EvidenceItem {
  return {
    evidence_id: evidenceId,
    query: 'test query',
    source_url: 'https://example.com',
    page_title: 'Test',
    snippet,
    fetched_text: fetchedText ?? snippet,
    content_hash: 'a'.repeat(64),
    retrieval_rank: 1,
    fetched_at: new Date().toISOString(),
  };
}

describe('Grounding Gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('verifies a claim when all three hops pass', async () => {
    const dossier = makeDossier({
      overview: {
        claims: [
          { text: 'Northwind Robotics is a drone company.', signal_ids: ['sig-overview-1'] },
        ],
      },
    });

    const signals: Signal[] = [
      makeSignal('sig-overview-1', 'overview', {
        evidence_ids: ['ev-1'],
      }),
    ];

    const evidence: EvidenceItem[] = [
      makeEvidence('ev-1', 'Northwind Robotics is a drone company.'),
    ];

    const result = await runGroundingGate('run-g-01', dossier, signals, evidence);

    expect(result.claimsTotal).toBe(1);
    expect(result.claimsVerified).toBe(1);
    expect(result.recastGaps).toBe(0);
    expect(result.dossier.grounding_passed).toBe(true);
    expect(result.verifications[0].verified).toBe(true);
  });

  it('recasts claim as gap when signal is abstaining', async () => {
    const dossier = makeDossier({
      overview: {
        claims: [
          { text: 'Leadership info here.', signal_ids: ['sig-abstain-1'] },
        ],
      },
    });

    const signals: Signal[] = [
      makeSignal('sig-abstain-1', 'overview', {
        status: 'abstain',
        evidence_ids: [],
      }),
    ];

    const evidence: EvidenceItem[] = [];

    const result = await runGroundingGate('run-g-02', dossier, signals, evidence);

    expect(result.claimsVerified).toBe(0);
    expect(result.recastGaps).toBe(1);
    expect(result.dossier.grounding_passed).toBe(false);
    expect(result.dossier.sections.overview.claims[0].gap).toBe(true);
    expect(result.dossier.gaps!.some((g) => g.slot === 'overview')).toBe(true);
  });

  it('recasts claim as gap when evidence_id missing', async () => {
    const dossier = makeDossier({
      overview: {
        claims: [
          { text: 'Missing evidence.', signal_ids: ['sig-ev-missing'] },
        ],
      },
    });

    const signals: Signal[] = [
      makeSignal('sig-ev-missing', 'overview', {
        evidence_ids: ['ev-does-not-exist'],
      }),
    ];

    const evidence: EvidenceItem[] = [];

    const result = await runGroundingGate('run-g-03', dossier, signals, evidence);

    expect(result.claimsVerified).toBe(0);
    expect(result.recastGaps).toBe(1);
    expect(result.dossier.sections.overview.claims[0].gap).toBe(true);
  });

  it('recasts claim as gap when snippet not in evidence text', async () => {
    const dossier = makeDossier({
      overview: {
        claims: [
          { text: 'Claim text.', signal_ids: ['sig-snippet-1'] },
        ],
      },
    });

    const signals: Signal[] = [
      makeSignal('sig-snippet-1', 'overview', {
        evidence_ids: ['ev-1'],
      }),
    ];

    // The snippet "original snippet" does not appear in fetched_text "different content here"
    const evidence: EvidenceItem[] = [
      makeEvidence('ev-1', 'original snippet', 'different content here'),
    ];

    const result = await runGroundingGate('run-g-04', dossier, signals, evidence);

    expect(result.claimsVerified).toBe(0);
    expect(result.recastGaps).toBe(1);
    expect(result.verifications[0].reason).toContain('not found');
  });

  it('preserves dossier gaps and adds new ones', async () => {
    const dossier: Dossier = {
      executive_summary: 'Test.',
      sections: {
        overview: {
          claims: [
            { text: 'Claim A.', signal_ids: ['sig-1'] },
            { text: 'Claim B.', signal_ids: ['sig-bad'] },
          ],
        },
      },
      gaps: [{ slot: 'leadership', reason: 'No evidence.' }],
      grounding_passed: false,
    };

    const signals: Signal[] = [
      makeSignal('sig-1', 'overview', { evidence_ids: ['ev-1'] }),
      makeSignal('sig-bad', 'overview', { status: 'abstain', evidence_ids: [] }),
    ];

    const evidence: EvidenceItem[] = [
      makeEvidence('ev-1', 'Claim A.'),
    ];

    const result = await runGroundingGate('run-g-05', dossier, signals, evidence);

    expect(result.dossier.gaps!.length).toBe(2); // existing + recast
    expect(result.dossier.gaps!.some((g) => g.slot === 'leadership')).toBe(true);
    expect(result.dossier.gaps!.some((g) => g.slot === 'overview')).toBe(true);
  });

  it('handles multiple claims across sections', async () => {
    const dossier = makeDossier({
      overview: {
        claims: [
          { text: 'Overview claim.', signal_ids: ['sig-overview-1'] },
        ],
      },
      funding: {
        claims: [
          { text: 'Funding claim.', signal_ids: ['sig-funding-1'] },
        ],
      },
    });

    const signals: Signal[] = [
      makeSignal('sig-overview-1', 'overview', { evidence_ids: ['ev-o'] }),
      makeSignal('sig-funding-1', 'funding', { evidence_ids: ['ev-f'] }),
    ];

    const evidence: EvidenceItem[] = [
      makeEvidence('ev-o', 'Overview claim.'),
      makeEvidence('ev-f', 'Funding claim.'),
    ];

    const result = await runGroundingGate('run-g-06', dossier, signals, evidence);

    expect(result.claimsTotal).toBe(2);
    expect(result.claimsVerified).toBe(2);
    expect(result.recastGaps).toBe(0);
  });

  it('handles empty dossier with zero claims', async () => {
    const dossier = makeDossier({});
    const result = await runGroundingGate('run-g-07', dossier, [], []);

    expect(result.claimsTotal).toBe(0);
    expect(result.claimsVerified).toBe(0);
    expect(result.recastGaps).toBe(0);
    expect(result.dossier.grounding_passed).toBe(true); // vacuously true
  });

  it('handles claim citing multiple signals where one is bad', async () => {
    const dossier = makeDossier({
      overview: {
        claims: [
          { text: 'Multi-cited claim.', signal_ids: ['sig-good', 'sig-bad'] },
        ],
      },
    });

    const signals: Signal[] = [
      makeSignal('sig-good', 'overview', { evidence_ids: ['ev-1'] }),
      makeSignal('sig-bad', 'overview', { status: 'abstain', evidence_ids: [] }),
    ];

    const evidence: EvidenceItem[] = [
      makeEvidence('ev-1', 'Multi-cited claim.'),
    ];

    const result = await runGroundingGate('run-g-08', dossier, signals, evidence);

    // If a claim cites multiple signals, ALL must pass
    expect(result.claimsVerified).toBe(0);
    expect(result.recastGaps).toBe(1);
  });

  it('does not duplicate gap entries on re-run', async () => {
    const dossier: Dossier = {
      executive_summary: 'Test.',
      sections: {
        overview: {
          claims: [
            { text: 'Claim A.', signal_ids: ['sig-bad'] },
          ],
        },
      },
      gaps: [],
      grounding_passed: false,
    };

    const signals: Signal[] = [
      makeSignal('sig-bad', 'overview', { status: 'abstain', evidence_ids: [] }),
    ];

    const evidence: EvidenceItem[] = [];

    // First run
    const result1 = await runGroundingGate('run-g-09', dossier, signals, evidence);
    expect(result1.dossier.gaps!.length).toBe(1);

    // Re-running with same (now-recast) dossier should not duplicate gaps
    const result2 = await runGroundingGate('run-g-09', result1.dossier, signals, evidence);
    expect(result2.dossier.gaps!.length).toBe(1); // still 1, not duplicated
  });
});
