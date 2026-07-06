/**
 * Signal Writer Tests
 *
 * Tests idempotent signal persistence with schema validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistSignal, persistSignals } from '../src/signal_writer.js';
import type { Signal } from '../src/types.js';

const mockQuery = vi.fn();

vi.mock('../src/db.js', () => ({
  getPool: () => ({
    query: (...args: unknown[]) => mockQuery(...args),
  }),
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/log.js', () => ({
  logCompleted: vi.fn().mockResolvedValue(undefined),
  logError: vi.fn().mockResolvedValue(undefined),
}));

function makeSignal(overrides?: Partial<Signal>): Signal {
  return {
    signal_id: 'sig-001',
    slot: 'overview',
    status: 'filled',
    value: 'Test company overview.',
    confidence: 0.85,
    rationale: 'From evidence.',
    evidence_ids: ['ev-1', 'ev-2'],
    ...overrides,
  } as Signal;
}

describe('persistSignal', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{ id: 'sig-uuid-123' }] });
  });

  it('succeeds when signal is schema-valid', async () => {
    const signal = makeSignal();
    const id = await persistSignal('run-1', signal);
    expect(id).toBe('sig-uuid-123');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('throws when signal_id is missing', async () => {
    const signal = makeSignal({ signal_id: '' });
    await expect(persistSignal('run-1', signal)).rejects.toThrow(/schema validation failed/);
  });

  it('throws when slot is invalid', async () => {
    const signal = makeSignal({ slot: 'invalid_slot' as Signal['slot'] });
    await expect(persistSignal('run-1', signal)).rejects.toThrow(/schema validation failed/);
  });

  it('throws when filled signal lacks value', async () => {
    const signal = makeSignal({ value: undefined });
    await expect(persistSignal('run-1', signal)).rejects.toThrow(/schema validation failed/);
  });

  it('nulled value/confidence for insufficient_evidence status', async () => {
    const signal = makeSignal({
      status: 'insufficient_evidence',
      value: undefined,
      confidence: undefined,
      evidence_ids: [],
      rationale: 'No evidence.',
    });
    const id = await persistSignal('run-1', signal);
    expect(id).toBe('sig-uuid-123');

    const callArgs = mockQuery.mock.calls[0];
    // Check that value and confidence are passed as null (params $5, $6)
    const params = callArgs[1] as (string | number | null | string[])[];
    expect(params[4]).toBeNull(); // value
    expect(params[5]).toBeNull(); // confidence
  });
});

describe('persistSignals', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{ id: 'sig-uuid-123' }] });
  });

  it('processes multiple signals and tracks failures', async () => {
    const signals: Signal[] = [
      makeSignal({ signal_id: 'sig-1', slot: 'overview' }),
      makeSignal({ signal_id: 'sig-2', slot: 'products', status: 'insufficient_evidence', value: undefined, confidence: undefined, evidence_ids: [] }),
      makeSignal({ signal_id: '', slot: 'leadership' }), // invalid
    ];

    const result = await persistSignals('run-1', signals);

    expect(result.totalAttempted).toBe(3);
    expect(result.persisted.length).toBe(2); // first two succeed
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].signal_id).toBe('');
  });

  it('returns empty on empty array', async () => {
    const result = await persistSignals('run-1', []);
    expect(result.totalAttempted).toBe(0);
    expect(result.persisted.length).toBe(0);
    expect(result.failures.length).toBe(0);
  });
});
