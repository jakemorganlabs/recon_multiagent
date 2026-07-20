import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistEvidence, persistEvidenceBatch } from '../src/evidence_writer.js';
import type { EvidenceItem } from '../src/types.js';

const mockQuery = vi.fn();

vi.mock('../src/db.js', () => ({
  getPool: () => ({
    query: (...args: unknown[]) => mockQuery(...args),
  }),
}));

function makeEvidenceItem(overrides?: Partial<EvidenceItem>): EvidenceItem {
  const snippet = 'Acme Corp is a leading widget provider.';
  const fullText = snippet + ' Founded in 1999, they have 500 employees.';
  return {
    evidence_id: 'ev-001',
    query: 'acme corp overview',
    source_url: 'https://example.com/acme',
    page_title: 'Acme Corp',
    snippet,
    fetched_text: fullText,
    content_hash: '64-char-hex-placeholder-hash-here1234567890abcdef0123456789',
    retrieval_rank: 1,
    fetched_at: '2024-07-04T16:00:00Z',
    ...overrides,
  };
}

describe('persistEvidence', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{ id: 'ev-uuid-123' }] });
  });

  it('throws when schema validation fails', async () => {
    const badItem = makeEvidenceItem({ evidence_id: '' });

    await expect(persistEvidence({ run_id: 'run-1', item: badItem })).rejects.toThrow(
      /schema validation failed/
    );
  });

  it('throws when content_hash mismatches', async () => {
    const item = makeEvidenceItem({ content_hash: 'a'.repeat(64) });

    await expect(persistEvidence({ run_id: 'run-1', item })).rejects.toThrow(
      /content_hash mismatch/
    );
  });

  it('succeeds when item is valid and hash matches', async () => {
    // Use the correct hash
    const fullText = 'Acme Corp is a leading widget provider.';
    const snippet = fullText.substring(0, 20);
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(fullText).digest('hex');

    const item: EvidenceItem = {
      evidence_id: 'ev-001',
      query: 'acme corp overview',
      source_url: 'https://example.com/acme',
      snippet,
      fetched_text: fullText,
      content_hash: hash,
      retrieval_rank: 1,
      fetched_at: '2024-07-04T16:00:00Z',
    };

    const id = await persistEvidence({ run_id: 'run-1', item });
    expect(id).toBe('ev-uuid-123');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('persistEvidenceBatch', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{ id: 'ev-uuid-123' }] });
  });

  it('processes all items and tracks failures', async () => {
    const { createHash } = await import('node:crypto');
    const text1 = 'Text one';
    const text2 = 'Text two';

    const items: EvidenceItem[] = [
      {
        evidence_id: 'ev-1',
        query: 'q1',
        source_url: 'https://a.com',
        snippet: text1.substring(0, 20),
        fetched_text: text1,
        content_hash: createHash('sha256').update(text1).digest('hex'),
        retrieval_rank: 1,
        fetched_at: '2024-07-04T16:00:00Z',
      },
      {
        evidence_id: 'ev-2',
        query: 'q2',
        source_url: 'https://b.com',
        snippet: text2.substring(0, 20),
        fetched_text: text2,
        content_hash: createHash('sha256').update(text2).digest('hex'),
        retrieval_rank: 2,
        fetched_at: '2024-07-04T16:00:00Z',
      },
      // Bad item, hash mismatch
      {
        evidence_id: 'ev-3',
        query: 'q3',
        source_url: 'https://c.com',
        snippet: 'bad',
        content_hash: 'a'.repeat(64),
        retrieval_rank: 3,
        fetched_at: '2024-07-04T16:00:00Z',
      },
    ];

    const { ids, failures } = await persistEvidenceBatch('run-1', items);

    expect(ids.length).toBe(2); // first two succeed
    expect(failures.length).toBe(1);
    expect(failures[0].index).toBe(2);
  });
});
