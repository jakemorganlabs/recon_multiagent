/**
 * Analyst Agent Tests
 *
 * Tests the Deterministic sealed-from-web agent that:
 * - Reads evidence from shared state ONLY
 * - Never fetches pages
 * - Fills slots from evidence, abstains when unsupported
 * - Cites evidence_ids for every filled signal
 * - One-shot repair loop on schema failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAnalystAgent } from '../src/analyst_agent.js';
import type { Brief, EvidenceItem } from '../src/types.js';

// Mock db.js to isolate from postgres
vi.mock('../src/db.js', async () => {
  return {
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

function makeBrief(extraSlots?: { slot_name: string; required: boolean; question: string }[]): Brief {
  return {
    target: { name: 'Northwind Robotics' },
    slots: [
      { slot_name: 'overview', required: true, question: 'What is this company?' },
      { slot_name: 'leadership', required: true, question: 'Who leads it?' },
      ...(extraSlots ?? []),
    ],
  };
}

function makeEvidence(items: Partial<EvidenceItem>[]): EvidenceItem[] {
  let i = 1;
  return items.map((it) => ({
    evidence_id: it.evidence_id ?? `ev-test-${i++}`,
    query: it.query ?? 'test query',
    source_url: it.source_url ?? 'https://example.com',
    page_title: it.page_title ?? 'Test Page',
    snippet: it.snippet ?? 'A snippet about something.',
    fetched_text: it.fetched_text,
    content_hash: it.content_hash ?? 'a'.repeat(64),
    retrieval_rank: it.retrieval_rank ?? i,
    fetched_at: it.fetched_at ?? new Date().toISOString(),
  }));
}

function mockDeepInfraResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    }),
    text: vi.fn().mockResolvedValue(''),
  };
}

function buildSignalResponse(signals: object[]): string {
  return JSON.stringify(signals);
}

describe('Analyst Agent', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('fills a slot from evidence', async () => {
    const brief = makeBrief();
    const evidence = makeEvidence([
      {
        evidence_id: 'ev-1',
        snippet: 'Northwind Robotics is a leading provider of autonomous warehouse drones founded in 2019.',
      },
    ]);

    const signals = [
      {
        signal_id: 'sig-overview-1',
        slot: 'overview',
        status: 'filled',
        value: 'Northwind Robotics is a leading provider of autonomous warehouse drones founded in 2019.',
        confidence: 0.88,
        rationale: 'Evidence ev-1 directly describes the company.',
        evidence_ids: ['ev-1'],
      },
      {
        signal_id: 'sig-leadership-1',
        slot: 'leadership',
        status: 'insufficient_evidence',
        value: null,
        confidence: null,
        rationale: 'No evidence mentions leadership.',
        evidence_ids: [],
      },
    ];

    vi.mocked(fetch).mockResolvedValue(
      mockDeepInfraResponse(buildSignalResponse(signals)) as unknown as Response
    );

    const result = await runAnalystAgent('run-test-01', brief, evidence, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
      confidenceFloor: 0.6,
    });

    expect(result.stoppedBecause).toBe('completed');
    expect(result.signalCount).toBe(2);
    expect(result.repairAttempts).toBe(0);

    const overview = result.signals.find((s) => s.slot === 'overview');
    expect(overview?.status).toBe('filled');
    expect(overview?.evidence_ids).toContain('ev-1');
    expect(overview?.confidence).toBeGreaterThan(0);

    const leadership = result.signals.find((s) => s.slot === 'leadership');
    expect(leadership?.status).toBe('insufficient_evidence');
    expect(leadership?.evidence_ids).toHaveLength(0);
  });

  it('abstains when there is no evidence for a slot', async () => {
    const brief = makeBrief();
    const evidence = makeEvidence([
      {
        evidence_id: 'ev-1',
        snippet: 'Northwind Robotics builds warehouse drones.',
      },
    ]);

    const signals = [
      {
        signal_id: 'sig-overview-1',
        slot: 'overview',
        status: 'filled',
        value: 'Northwind Robotics builds warehouse drones.',
        confidence: 0.85,
        rationale: 'Direct from evidence.',
        evidence_ids: ['ev-1'],
      },
      {
        signal_id: 'sig-leadership-1',
        slot: 'leadership',
        status: 'insufficient_evidence',
        value: null,
        confidence: null,
        rationale: 'No evidence items mention leadership.',
        evidence_ids: [],
      },
    ];

    vi.mocked(fetch).mockResolvedValue(
      mockDeepInfraResponse(buildSignalResponse(signals)) as unknown as Response
    );

    const result = await runAnalystAgent('run-test-02', brief, evidence, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.abstainCount).toBe(1);
    const leadership = result.signals.find((s) => s.slot === 'leadership');
    expect(leadership?.status).toBe('insufficient_evidence');
    expect(leadership?.value).toBeUndefined();
  });

  it('handles wrapped JSON response from Gemma', async () => {
    const brief = makeBrief();
    const evidence = makeEvidence([
      { evidence_id: 'ev-1', snippet: 'Something here.' },
    ]);

    const signals = [
      {
        signal_id: 'sig-overview-1',
        slot: 'overview',
        status: 'filled',
        value: 'Northwind Robotics.',
        confidence: 0.7,
        rationale: 'From evidence.',
        evidence_ids: ['ev-1'],
      },
      {
        signal_id: 'sig-leadership-1',
        slot: 'leadership',
        status: 'insufficient_evidence',
        value: null,
        confidence: null,
        rationale: 'None.',
        evidence_ids: [],
      },
    ];

    const wrapped = '```json\n' + buildSignalResponse(signals) + '\n```';

    vi.mocked(fetch).mockResolvedValue(
      mockDeepInfraResponse(wrapped) as unknown as Response
    );

    const result = await runAnalystAgent('run-test-03', brief, evidence, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.stoppedBecause).toBe('completed');
    expect(result.signals).toHaveLength(2);
  });

  it('one-shot repairs on schema failure', async () => {
    const brief = makeBrief();
    const evidence = makeEvidence([
      { evidence_id: 'ev-1', snippet: 'Snippet here.' },
    ]);

    const bad = JSON.stringify({ status: 'ok' });
    const good = buildSignalResponse([
      {
        signal_id: 'sig-overview-1',
        slot: 'overview',
        status: 'filled',
        value: 'Northwind Robotics.',
        confidence: 0.8,
        rationale: 'Evidence.',
        evidence_ids: ['ev-1'],
      },
      {
        signal_id: 'sig-leadership-1',
        slot: 'leadership',
        status: 'insufficient_evidence',
        value: null,
        confidence: null,
        rationale: 'No evidence.',
        evidence_ids: [],
      },
    ]);

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockDeepInfraResponse(bad) as unknown as Response)
      .mockResolvedValueOnce(mockDeepInfraResponse(good) as unknown as Response);

    const result = await runAnalystAgent('run-test-04', brief, evidence, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.repairAttempts).toBe(1);
    expect(result.stoppedBecause).toBe('completed');
    expect(result.signals).toHaveLength(2);
  });

  it('emits abstain placeholders after second schema failure', async () => {
    const brief = makeBrief();
    const evidence = makeEvidence([]);

    const alwaysBad = JSON.stringify({ garbage: true });

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockDeepInfraResponse(alwaysBad) as unknown as Response)
      .mockResolvedValueOnce(mockDeepInfraResponse(alwaysBad) as unknown as Response);

    const result = await runAnalystAgent('run-test-05', brief, evidence, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.repairAttempts).toBe(2);
    expect(result.stoppedBecause).toBe('schema_failed');
    expect(result.abstainCount).toBe(2);
  });

  it('fills missing slots with abstain if model omits them', async () => {
    const brief = makeBrief();
    const evidence = makeEvidence([
      { evidence_id: 'ev-1', snippet: 'Something.' },
    ]);

    const partial = buildSignalResponse([
      {
        signal_id: 'sig-overview-1',
        slot: 'overview',
        status: 'filled',
        value: 'Northwind Robotics.',
        confidence: 0.82,
        rationale: 'Evidence.',
        evidence_ids: ['ev-1'],
      },
    ]);

    vi.mocked(fetch).mockResolvedValue(
      mockDeepInfraResponse(partial) as unknown as Response
    );

    const result = await runAnalystAgent('run-test-06', brief, evidence, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.signalCount).toBe(2);
    const leadership = result.signals.find((s) => s.slot === 'leadership');
    expect(leadership?.status).toBe('insufficient_evidence');
  });

  it('handles DeepInfra API error gracefully', async () => {
    const brief = makeBrief();
    const evidence = makeEvidence([]);

    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await runAnalystAgent('run-test-07', brief, evidence, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    expect(result.stoppedBecause).toBe('error');
    expect(result.abstainCount).toBe(2);
    expect(result.signals.every((s) => s.status === 'insufficient_evidence')).toBe(true);
  });

  it('signals are schema-valid (filled has value + confidence + evidence_ids)', async () => {
    const brief = makeBrief();
    const evidence = makeEvidence([
      { evidence_id: 'ev-1', snippet: 'Warehouse drone company.' },
    ]);

    const signals = [
      {
        signal_id: 'sig-overview-1',
        slot: 'overview',
        status: 'filled',
        value: 'Warehouse drone company.',
        confidence: 0.9,
        rationale: 'Direct evidence.',
        evidence_ids: ['ev-1'],
      },
      {
        signal_id: 'sig-leadership-1',
        slot: 'leadership',
        status: 'insufficient_evidence',
        value: null,
        confidence: null,
        rationale: 'No evidence.',
        evidence_ids: [],
      },
    ];

    vi.mocked(fetch).mockResolvedValue(
      mockDeepInfraResponse(buildSignalResponse(signals)) as unknown as Response
    );

    const result = await runAnalystAgent('run-test-08', brief, evidence, {
      baseUrl: 'http://localhost:9999/v1/openai',
      apiKey: 'test-key',
      model: 'google/gemma-4-26B-A4B-it',
      temperature: 0,
    });

    const filled = result.signals.filter((s) => s.status === 'filled');
    for (const s of filled) {
      expect(s.value).toBeDefined();
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
      expect(s.evidence_ids.length).toBeGreaterThan(0);
    }

    const abstained = result.signals.filter((s) => s.status === 'insufficient_evidence');
    for (const s of abstained) {
      expect(s.value).toBeUndefined();
      expect(s.evidence_ids).toHaveLength(0);
    }
  });
});
