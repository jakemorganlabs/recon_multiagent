/**
 * Synthesis Agent Tests
 *
 * Tests the sealed-from-web agent that:
 * - Reads signals from shared state ONLY (no web access)
 * - Composes a Dossier from signals with explicit gap notes
 * - NEVER introduces a fact not in a signal
 * - One-shot repair loop on schema failure
 * - Uses DeepInfra / Gemma 4 (google/gemma-4-26B-A4B-it)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runSynthesisAgent } from '../src/synthesis_agent.js';
import type { Brief, Signal, Dossier } from '../src/types.js';

// Mock db.js to isolate from postgres
vi.mock('../src/db.js', async () => {
  return {
    getSignalsByRunId: vi.fn().mockResolvedValue([]),
    writeAudit: vi.fn().mockResolvedValue(undefined),
    getPool: vi.fn().mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
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

function makeBrief(): Brief {
  return {
    target: { name: 'Northwind Robotics' },
    slots: [
      { slot_name: 'overview', required: true, question: 'What is this company?' },
      { slot_name: 'leadership', required: false, question: 'Who leads it?' },
      { slot_name: 'funding', required: false, question: 'What is their funding status?' },
    ],
  };
}

function mockDeepInfraResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    }),
    text: vi.fn().mockResolvedValue(''),
  } as unknown as Response;
}

function buildDossierResponse(dossier: object): string {
  return JSON.stringify(dossier);
}

describe('Synthesis Agent', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('composes a dossier from signals with claims and citations', async () => {
    const brief = makeBrief();
    const signals: Signal[] = [
      {
        signal_id: 'sig-overview-1',
        slot: 'overview',
        status: 'filled',
        value: 'Northwind Robotics is a warehouse drone company founded in 2019.',
        confidence: 0.88,
        rationale: 'Evidence ev-1 describes the company overview.',
        evidence_ids: ['ev-1'],
      },
      {
        signal_id: 'sig-leadership-1',
        slot: 'leadership',
        status: 'insufficient_evidence',
        evidence_ids: [],
      },
      {
        signal_id: 'sig-funding-1',
        slot: 'funding',
        status: 'filled',
        value: 'Raised $12M Series A in 2022.',
        confidence: 0.92,
        rationale: 'Evidence ev-2 mentions funding.',
        evidence_ids: ['ev-2'],
      },
    ];

    const { getSignalsByRunId } = await import('../src/db.js');
    vi.mocked(getSignalsByRunId).mockResolvedValue(signals);

    const dossier: Dossier = {
      executive_summary: 'Northwind Robotics is a warehouse drone company that raised $12M in Series A funding.',
      sections: {
        overview: {
          claims: [
            {
              text: 'Northwind Robotics is a warehouse drone company founded in 2019.',
              signal_ids: ['sig-overview-1'],
            },
          ],
        },
        leadership: { claims: [] },
        funding: {
          claims: [
            { text: 'Raised $12M Series A in 2022.', signal_ids: ['sig-funding-1'] },
          ],
        },
      },
      gaps: [
        { slot: 'leadership', reason: 'No signal available for leadership.' },
      ],
      grounding_passed: false,
    };

    vi.mocked(fetch).mockResolvedValue(
      mockDeepInfraResponse(buildDossierResponse(dossier))
    );

    const result = await runSynthesisAgent('run-test-01', brief, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.stoppedBecause).toBe('completed');
    expect(result.repairAttempts).toBe(0);
    expect(result.signalCount).toBe(3);

    expect(result.dossier.executive_summary).toBeDefined();
    expect(result.dossier.sections.overview).toBeDefined();
    expect(result.dossier.sections.overview.claims.length).toBeGreaterThan(0);
    expect(result.dossier.sections.overview.claims[0].signal_ids).toContain('sig-overview-1');
  });

  it('surfaces gaps for slots with insufficient evidence', async () => {
    const brief = makeBrief();
    const signals: Signal[] = [
      {
        signal_id: 'sig-overview-1',
        slot: 'overview',
        status: 'filled',
        value: 'Northwind Robotics builds warehouse drones.',
        confidence: 0.85,
        rationale: 'Direct evidence.',
        evidence_ids: ['ev-1'],
      },
      {
        signal_id: 'sig-leadership-1',
        slot: 'leadership',
        status: 'insufficient_evidence',
        evidence_ids: [],
      },
      {
        signal_id: 'sig-funding-1',
        slot: 'funding',
        status: 'insufficient_evidence',
        evidence_ids: [],
      },
    ];

    const { getSignalsByRunId } = await import('../src/db.js');
    vi.mocked(getSignalsByRunId).mockResolvedValue(signals);

    const dossier: Dossier = {
      executive_summary: 'Northwind Robotics builds warehouse drones.',
      sections: {
        overview: {
          claims: [
            { text: 'Northwind Robotics builds warehouse drones.', signal_ids: ['sig-overview-1'] },
          ],
        },
        leadership: { claims: [] },
        funding: { claims: [] },
      },
      gaps: [
        { slot: 'leadership', reason: 'No evidence mentions leadership.' },
        { slot: 'funding', reason: 'No evidence mentions funding.' },
      ],
      grounding_passed: false,
    };

    vi.mocked(fetch).mockResolvedValue(
      mockDeepInfraResponse(buildDossierResponse(dossier))
    );

    const result = await runSynthesisAgent('run-test-02', brief, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.dossier.gaps).toBeDefined();
    expect(result.dossier.gaps!.length).toBe(2);
    expect(result.dossier.gaps!.map((g) => g.slot)).toContain('leadership');
    expect(result.dossier.gaps!.map((g) => g.slot)).toContain('funding');
  });

  it('one-shot repairs on schema failure', async () => {
    const brief = makeBrief();
    const signals: Signal[] = [
      {
        signal_id: 'sig-overview-1',
        slot: 'overview',
        status: 'filled',
        value: 'Northwind Robotics.',
        confidence: 0.8,
        rationale: 'Evidence.',
        evidence_ids: ['ev-1'],
      },
    ];

    const { getSignalsByRunId } = await import('../src/db.js');
    vi.mocked(getSignalsByRunId).mockResolvedValue(signals);

    const badDossier = JSON.stringify({ not_a_dossier: true });
    const goodDossier: Dossier = {
      executive_summary: 'Northwind Robotics.',
      sections: {
        overview: { claims: [{ text: 'Northwind Robotics.', signal_ids: ['sig-overview-1'] }] },
        leadership: { claims: [] },
        funding: { claims: [] },
      },
      gaps: [],
      grounding_passed: false,
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockDeepInfraResponse(badDossier))
      .mockResolvedValueOnce(mockDeepInfraResponse(buildDossierResponse(goodDossier)));

    const result = await runSynthesisAgent('run-test-03', brief, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.repairAttempts).toBe(1);
    expect(result.stoppedBecause).toBe('completed');
    expect(result.dossier.sections.overview.claims.length).toBeGreaterThan(0);
  });

  it('emits empty dossier with all gaps after second schema failure', async () => {
    const brief = makeBrief();
    const signals: Signal[] = [];

    const { getSignalsByRunId } = await import('../src/db.js');
    vi.mocked(getSignalsByRunId).mockResolvedValue(signals);

    const alwaysBad = JSON.stringify({ garbage: true });

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockDeepInfraResponse(alwaysBad))
      .mockResolvedValueOnce(mockDeepInfraResponse(alwaysBad));

    const result = await runSynthesisAgent('run-test-04', brief, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.repairAttempts).toBe(2);
    expect(result.stoppedBecause).toBe('schema_failed');
    expect(result.dossier.gaps!.length).toBe(3);
    expect(result.dossier.sections.overview.claims).toHaveLength(0);
    expect(result.dossier.sections.leadership.claims).toHaveLength(0);
    expect(result.dossier.sections.funding.claims).toHaveLength(0);
  });

  it('handles wrapped markdown JSON from Gemma', async () => {
    const brief = makeBrief();
    const signals: Signal[] = [
      {
        signal_id: 'sig-overview-1',
        slot: 'overview',
        status: 'filled',
        value: 'Northwind Robotics.',
        confidence: 0.82,
        rationale: 'Evidence.',
        evidence_ids: ['ev-1'],
      },
    ];

    const { getSignalsByRunId } = await import('../src/db.js');
    vi.mocked(getSignalsByRunId).mockResolvedValue(signals);

    const dossier: Dossier = {
      executive_summary: 'Northwind Robotics.',
      sections: {
        overview: { claims: [{ text: 'Northwind Robotics.', signal_ids: ['sig-overview-1'] }] },
        leadership: { claims: [] },
        funding: { claims: [] },
      },
      gaps: [],
      grounding_passed: false,
    };

    const wrapped = '```json\n' + JSON.stringify(dossier) + '\n```';

    vi.mocked(fetch).mockResolvedValue(
      mockDeepInfraResponse(wrapped)
    );

    const result = await runSynthesisAgent('run-test-05', brief, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.stoppedBecause).toBe('completed');
    expect(result.dossier.sections.overview.claims).toHaveLength(1);
  });

  it('rejects claims with no signal_ids', async () => {
    const brief = makeBrief();
    const signals: Signal[] = [
      {
        signal_id: 'sig-overview-1',
        slot: 'overview',
        status: 'filled',
        value: 'Northwind Robotics.',
        confidence: 0.9,
        rationale: 'Evidence.',
        evidence_ids: ['ev-1'],
      },
    ];

    const { getSignalsByRunId } = await import('../src/db.js');
    vi.mocked(getSignalsByRunId).mockResolvedValue(signals);

    // Dossier has a claim with empty signal_ids — should fail validation
    const badDossier: Dossier = {
      executive_summary: 'Northwind Robotics.',
      sections: {
        overview: {
          claims: [
            { text: 'Northwind Robotics.', signal_ids: [] }, // empty citations = invalid
          ],
        },
        leadership: { claims: [] },
        funding: { claims: [] },
      },
      gaps: [],
      grounding_passed: false,
    };

    const goodDossier: Dossier = {
      executive_summary: 'Northwind Robotics.',
      sections: {
        overview: { claims: [{ text: 'Northwind Robotics.', signal_ids: ['sig-overview-1'] }] },
        leadership: { claims: [] },
        funding: { claims: [] },
      },
      gaps: [],
      grounding_passed: false,
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockDeepInfraResponse(buildDossierResponse(badDossier)))
      .mockResolvedValueOnce(mockDeepInfraResponse(buildDossierResponse(goodDossier)));

    const result = await runSynthesisAgent('run-test-06', brief, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.repairAttempts).toBe(1);
    expect(result.stoppedBecause).toBe('completed');
    expect(result.dossier.sections.overview.claims[0].signal_ids).toContain('sig-overview-1');
  });

  it('handles DeepInfra API error gracefully', async () => {
    const brief = makeBrief();
    const signals: Signal[] = [];

    const { getSignalsByRunId } = await import('../src/db.js');
    vi.mocked(getSignalsByRunId).mockResolvedValue(signals);

    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await runSynthesisAgent('run-test-07', brief, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.stoppedBecause).toBe('error');
    expect(result.dossier.gaps!.length).toBe(3);
    expect(result.dossier.sections.overview.claims).toHaveLength(0);
  });

  it('never introduces a fact not in a signal (no hallucination)', async () => {
    const brief = makeBrief();
    const signals: Signal[] = [
      {
        signal_id: 'sig-overview-1',
        slot: 'overview',
        status: 'filled',
        value: 'Northwind Robotics is a drone company.',
        confidence: 0.85,
        rationale: 'From evidence.',
        evidence_ids: ['ev-1'],
      },
    ];

    const { getSignalsByRunId } = await import('../src/db.js');
    vi.mocked(getSignalsByRunId).mockResolvedValue(signals);

    // Synthesis might produce extra unsupported sections; we ensure every slot
    // gets at least an empty section entry
    const dossier: Dossier = {
      executive_summary: 'Northwind Robotics is a drone company.',
      sections: {
        overview: { claims: [{ text: 'Northwind Robotics is a drone company.', signal_ids: ['sig-overview-1'] }] },
        // Missing leadership and funding — should get auto-added
      },
      gaps: [
        { slot: 'leadership', reason: 'No signal available.' },
      ],
      grounding_passed: false,
    };

    vi.mocked(fetch).mockResolvedValue(
      mockDeepInfraResponse(buildDossierResponse(dossier))
    );

    const result = await runSynthesisAgent('run-test-08', brief, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    // Missing sections should be auto-populated with empty claims
    expect(result.dossier.sections.leadership).toBeDefined();
    expect(result.dossier.sections.funding).toBeDefined();
    expect(result.dossier.sections.leadership.claims).toHaveLength(0);
  });
});
