import { describe, it, expect } from 'vitest';
import { verifyDossier } from '../src/citation_verifier.js';
import type { Dossier, Signal, EvidenceItem } from '../src/types.js';

function baseEvidence(): EvidenceItem {
  return {
    evidence_id: 'ev-001',
    query: 'test query',
    source_url: 'https://example.com/article',
    snippet: 'warehouse  picking arms, the NW-7 cell',
    content_hash: 'a'.repeat(64),
    fetched_at: '2024-01-01T00:00:00Z',
  };
}

function baseDossier(): Dossier {
  return {
    sections: {
      overview: {
        claims: [
          {
            text: 'The company builds autonomous warehouse picking arms.',
            signal_ids: ['sig-overview-1'],
          },
        ],
      },
    },
  };
}

function baseSignal(): Signal {
  return {
    signal_id: 'sig-overview-1',
    slot: 'overview',
    status: 'filled',
    value: 'Autonomous warehouse picking arms',
    confidence: 0.85,
    rationale: 'Cited from product page',
    evidence_ids: ['ev-001'],
  };
}

describe('verifyDossier', () => {
  it('passes when the full three-hop chain is intact', () => {
    const dossier = baseDossier();
    const signals = [baseSignal()];
    const evidence = [baseEvidence()];

    const results = verifyDossier(dossier, signals, evidence);
    expect(results).toHaveLength(1);
    expect(results[0].verified).toBe(true);
    expect(results[0].recast_as_gap).toBe(false);
  });

  it('fails when signal is missing (broken-at-signal)', () => {
    const dossier = baseDossier();
    const signals: Signal[] = []; // signal absent
    const evidence = [baseEvidence()];

    const results = verifyDossier(dossier, signals, evidence);
    expect(results[0].verified).toBe(false);
    expect(results[0].recast_as_gap).toBe(true);
    expect(results[0].reason).toMatch(/does not exist/);
  });

  it('fails when signal is abstaining (broken-at-signal)', () => {
    const dossier = baseDossier();
    const signals = [{ ...baseSignal(), status: 'abstain' as const, value: undefined, confidence: undefined }];
    const evidence = [baseEvidence()];

    const results = verifyDossier(dossier, signals, evidence);
    expect(results[0].verified).toBe(false);
    expect(results[0].reason).toMatch(/abstaining/);
  });

  it('fails when evidence is missing (broken-at-evidence)', () => {
    const dossier = baseDossier();
    const signals = [baseSignal()];
    const evidence: EvidenceItem[] = []; // evidence absent

    const results = verifyDossier(dossier, signals, evidence);
    expect(results[0].verified).toBe(false);
    expect(results[0].reason).toMatch(/does not exist/);
  });

  it('fails when snippet is not present in evidence text (broken-at-snippet)', () => {
    const dossier = baseDossier();
    const signals = [baseSignal()];
    const evidence = [
      {
        ...baseEvidence(),
        fetched_text: 'totally different body text that does not contain the signal snippet at all',
      },
    ];

    const results = verifyDossier(dossier, signals, evidence);
    expect(results[0].verified).toBe(false);
    expect(results[0].reason).toMatch(/not found/);
  });

  it('passes with whitespace-normalized snippet match', () => {
    const dossier = baseDossier();
    const signals = [
      {
        ...baseSignal(),
        evidence_ids: ['ev-001'],
      },
    ];
    const evidence = [
      {
        ...baseEvidence(),
        fetched_text: 'In 2024 the company launched autonomous warehouse picking arms, the NW-7 cell, across three continents.',
        snippet: '  warehouse\t\tpicking arms, the NW-7 cell  ',
      },
    ];

    const results = verifyDossier(dossier, signals, evidence);
    expect(results[0].verified).toBe(true);
  });

  it('handles multiple claims across multiple sections', () => {
    const dossier: Dossier = {
      sections: {
        overview: {
          claims: [
            { text: 'Claim A', signal_ids: ['sig-a'] },
          ],
        },
        products: {
          claims: [
            { text: 'Claim B', signal_ids: ['sig-b'] },
          ],
        },
      },
    };

    const signals: Signal[] = [
      {
        signal_id: 'sig-a',
        slot: 'overview',
        status: 'filled',
        value: 'A',
        confidence: 0.9,
        evidence_ids: ['ev-a'],
      },
      {
        signal_id: 'sig-b',
        slot: 'products',
        status: 'filled',
        value: 'B',
        confidence: 0.9,
        evidence_ids: ['ev-b'],
      },
    ];

    const evidence: EvidenceItem[] = [
      {
        evidence_id: 'ev-a',
        query: 'q',
        source_url: 'https://a.com',
        snippet: 'A',
        content_hash: 'a'.repeat(64),
        fetched_at: '2024-01-01T00:00:00Z',
      },
      {
        evidence_id: 'ev-b',
        query: 'q',
        source_url: 'https://b.com',
        snippet: 'B',
        content_hash: 'b'.repeat(64),
        fetched_at: '2024-01-01T00:00:00Z',
      },
    ];

    const results = verifyDossier(dossier, signals, evidence);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.verified)).toBe(true);
  });

  it('returns per-claim results, not an overall boolean', () => {
    const dossier: Dossier = {
      sections: {
        overview: {
          claims: [
            { text: 'Good claim', signal_ids: ['sig-good'] },
            { text: 'Bad claim', signal_ids: ['sig-bad'] },
          ],
        },
      },
    };

    const signals: Signal[] = [
      {
        signal_id: 'sig-good',
        slot: 'overview',
        status: 'filled',
        value: 'x',
        confidence: 0.9,
        evidence_ids: ['ev-1'],
      },
      {
        signal_id: 'sig-bad',
        slot: 'overview',
        status: 'filled',
        value: 'x',
        confidence: 0.9,
        evidence_ids: ['ev-missing'],
      },
    ];

    const evidence: EvidenceItem[] = [
      {
        evidence_id: 'ev-1',
        query: 'q',
        source_url: 'https://example.com',
        snippet: 'x',
        content_hash: 'c'.repeat(64),
        fetched_at: '2024-01-01T00:00:00Z',
      },
    ];

    const results = verifyDossier(dossier, signals, evidence);
    expect(results[0].verified).toBe(true);
    expect(results[1].verified).toBe(false);
    expect(results[1].recast_as_gap).toBe(true);
  });
});
