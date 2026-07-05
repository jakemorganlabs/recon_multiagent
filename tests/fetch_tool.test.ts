import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWeb } from '../src/fetch_tool.js';

describe('fetchWeb', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockHeadOk(contentLength?: number) {
    return {
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => {
          if (h.toLowerCase() === 'content-length') return contentLength?.toString() ?? null;
          return null;
        },
      },
      url: 'https://example.com/page',
    };
  }

  function mockGetOk(html: string) {
    return {
      ok: true,
      status: 200,
      url: 'https://example.com/page',
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from(html)),
      text: vi.fn().mockResolvedValue(html),
      headers: { get: () => null },
    };
  }

  function mockGetError(status: number, html = '') {
    return {
      ok: false,
      status,
      url: 'https://example.com/page',
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from(html)),
      text: vi.fn().mockResolvedValue(html),
      headers: { get: () => null },
    };
  }

  it('allows https url and returns html', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockHeadOk(100) as unknown as Response)
      .mockResolvedValueOnce(mockGetOk('<html><body>Hello</body></html>') as unknown as Response);

    const res = await fetchWeb('https://example.com/page');

    expect(res.ok).toBe(true);
    expect(res.status).toBe('fetched');
    expect(res.html).toContain('Hello');
  });

  it('rejects non-http schemes', async () => {
    const res = await fetchWeb('ftp://example.com/file');

    expect(res.ok).toBe(false);
    expect(res.status).toBe('scheme_denied');
    expect(res.reason).toContain('ftp');
  });

  it('rejects file scheme', async () => {
    const res = await fetchWeb('file:///etc/passwd');

    expect(res.ok).toBe(false);
    expect(res.status).toBe('scheme_denied');
  });

  it('rejects localhost', async () => {
    const res = await fetchWeb('http://localhost:3000/secret');

    expect(res.ok).toBe(false);
    expect(res.status).toBe('domain_denied');
    expect(res.reason).toContain('Private');
  });

  it('enforces allowlist', async () => {
    const res = await fetchWeb('https://evil.com/page', {
      allowlist: ['example.com'],
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe('domain_denied');
    expect(res.reason).toContain('allowlist');
  });

  it('enforces explicit denylist', async () => {
    const res = await fetchWeb('https://foo.com/page', {
      denylist: ['foo.com'],
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe('domain_denied');
    expect(res.reason).toContain('denylist');
  });

  it('denies by Content-Length cap', async () => {
    vi.mocked(fetch).mockResolvedValue(mockHeadOk(2000000) as unknown as Response);

    const res = await fetchWeb('https://example.com/large', { maxBytes: 1048576 });

    expect(res.ok).toBe(false);
    expect(res.status).toBe('size_denied');
  });

  it('truncates response when larger than maxBytes', async () => {
    const big = 'x'.repeat(2000);
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockHeadOk(100) as unknown as Response)
      .mockResolvedValueOnce(mockGetOk(big) as unknown as Response);

    const res = await fetchWeb('https://example.com/page', { maxBytes: 500 });

    expect(res.ok).toBe(true);
    expect(res.html!.length).toBe(500);
  });

  it('handles HTTP error gracefully', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockHeadOk(100) as unknown as Response)
      .mockResolvedValueOnce(mockGetError(404, 'Not found') as unknown as Response);

    const res = await fetchWeb('https://example.com/missing');

    expect(res.ok).toBe(false);
    expect(res.status).toBe('network_error');
  });

  it('timeouts are handled', async () => {
    const headRes = mockHeadOk(100);
    vi.mocked(fetch)
      .mockResolvedValueOnce(headRes as unknown as Response)
      .mockImplementationOnce(async (_url, options) => {
        const ctrl = options?.signal as AbortSignal | undefined;
        if (ctrl) {
          return new Promise((_resolve, reject) => {
            ctrl.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }) as Promise<Response>;
        }
        return mockGetOk('') as unknown as Response;
      });

    const res = await fetchWeb('https://example.com/page', { timeoutMs: 10 });

    expect(res.ok).toBe(false);
    expect(res.status).toBe('timeout');
  });
});
