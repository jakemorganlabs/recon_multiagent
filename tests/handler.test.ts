import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRequest } from '../src/handler.js';

describe('handleRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('console', { log: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const hmacSecret = 'test-hmac-secret-32-bytes-long-key!!!';

  function buildAuth(method: string, path: string, body: string, timestampSec?: number): string {
    const { createHmac } = require('node:crypto');
    const ts = timestampSec ?? Math.floor(Date.now() / 1000);
    const bodyHash = createHmac('sha256', hmacSecret).update(body).digest('hex');
    const canonicalPath = path.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
    const data = `${ts}.${method.toUpperCase()}.${canonicalPath}.${bodyHash}`;
    const sig = createHmac('sha256', hmacSecret).update(data).digest('hex');
    return `HMAC ${ts}:${sig}`;
  }

  function makeOpts(overrides?: Partial<Parameters<typeof handleRequest>[0]>) {
    const body = JSON.stringify({ target: 'Northwind Robotics' });
    return {
      hmacSecret,
      method: 'POST',
      path: '/api/request',
      body,
      authorization: buildAuth('POST', '/api/request', body),
      normalizerOpts: {
        baseUrl: 'https://api.deepinfra.com/v1/openai',
        apiKey: 'fake-key',
        model: 'google/gemma-4-26B-A4B-it',
        temperature: 0,
        maxTokens: 512,
      },
      ...overrides,
    };
  }

  it('returns 401 on bad HMAC', async () => {
    const body = JSON.stringify({ target: 'Northwind Robotics' });
    const result = await handleRequest({
      ...makeOpts(),
      authorization: 'HMAC 12345:badbadbadbad',
      body,
    });
    expect(result.statusCode).toBe(401);
    expect(result.body.status).toBe('unauthorized');
  });

  it('returns 400 on invalid JSON body', async () => {
    const body = 'not-json';
    const result = await handleRequest({
      ...makeOpts(),
      body,
      authorization: buildAuth('POST', '/api/request', body),
    });
    expect(result.statusCode).toBe(400);
    expect(result.body.status).toBe('bad_request');
  });
});
