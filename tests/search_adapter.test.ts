import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchWeb, computeContentHash } from '../src/search_adapter.js';

describe('searchWeb', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockBraveResponse(results: { title: string; url: string; description?: string }[]) {
    return {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ web: { results } }),
      text: vi.fn().mockResolvedValue(JSON.stringify({ web: { results } })),
    };
  }

  function mockEmptyResponse() {
    return {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ web: { results: [] } }),
      text: vi.fn().mockResolvedValue(''),
    };
  }

  function mockErrorResponse(status: number, body: string) {
    return {
      ok: false,
      status,
      json: vi.fn().mockRejectedValue(new Error('Not JSON')),
      text: vi.fn().mockResolvedValue(body),
    };
  }

  it('returns results on ok Brave response', async () => {
    vi.mocked(fetch).mockResolvedValue(mockBraveResponse([
      { title: 'Acme Corp', url: 'https://example.com/acme', description: 'A company' },
    ]) as unknown as Response);

    const res = await searchWeb('acme corp', { apiKey: 'test-key' });

    expect(res.status).toBe('ok');
    expect(res.results).toHaveLength(1);
    expect(res.results[0].title).toBe('Acme Corp');
    expect(res.results[0].url).toBe('https://example.com/acme');
  });

  it('returns empty status for zero results', async () => {
    vi.mocked(fetch).mockResolvedValue(mockEmptyResponse() as unknown as Response);

    const res = await searchWeb('something obscure', { apiKey: 'test-key' });

    expect(res.status).toBe('empty');
    expect(res.results).toHaveLength(0);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      calls++;
      if (calls < 3) {
        return mockErrorResponse(429, 'Rate limited') as unknown as Response;
      }
      return mockBraveResponse([{ title: 'T', url: 'https://u.com' }]) as unknown as Response;
    });

    const res = await searchWeb('query', { apiKey: 'k', maxRetries: 4 });

    expect(calls).toBe(3);
    expect(res.status).toBe('ok');
  });

  it('returns error after exhausting retries', async () => {
    vi.mocked(fetch).mockResolvedValue(mockErrorResponse(500, 'Server Error') as unknown as Response);

    const res = await searchWeb('query', { apiKey: 'k', maxRetries: 2 });

    expect(res.status).toBe('error');
    expect(res.results).toHaveLength(0);
  });

  it('respects the count parameter in the URL', async () => {
    vi.mocked(fetch).mockResolvedValue(mockBraveResponse([]) as unknown as Response);

    await searchWeb('test', { apiKey: 'k', count: 5 });
    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url.searchParams.get('count')).toBe('5');
  });
});

describe('computeContentHash', () => {
  it('returns a 64-char hex sha256', () => {
    const hash = computeContentHash('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes on different input', () => {
    const a = computeContentHash('a');
    const b = computeContentHash('b');
    expect(a).not.toBe(b);
  });
});
