import { describe, it, expect } from 'vitest';
import { verifyRequestHmac, buildAuthorizationHeader } from '../src/hmac.js';

describe('verifyRequestHmac', () => {
  const secret = 'hmac-secret-32-bytes-long-key!!';

  it('accepts a valid signed request', () => {
    const body = '{"target":"Northwind Robotics"}';
    const auth = buildAuthorizationHeader({
      secret,
      method: 'POST',
      path: '/api/request',
      body,
    });
    const result = verifyRequestHmac({
      secret,
      method: 'POST',
      path: '/api/request',
      body,
      authorization: auth,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects bad signature', () => {
    const body = '{"target":"Northwind Robotics"}';
    const result = verifyRequestHmac({
      secret,
      method: 'POST',
      path: '/api/request',
      body,
      authorization: 'HMAC 1700000000:badhex0000000000000000000000000000000000000000000000000000000000',
      nowSec: 1700000010, // 10s after timestamp, inside replay window
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Signature mismatch');
  });

  it('rejects stale request', () => {
    const body = '{"target":"Northwind Robotics"}';
    const nowSec = 1000000000;
    const staleTimestamp = nowSec - 400; // >300s window
    const auth = buildAuthorizationHeader({
      secret,
      method: 'POST',
      path: '/api/request',
      body,
      timestampSec: staleTimestamp,
    });
    const result = verifyRequestHmac({
      secret,
      method: 'POST',
      path: '/api/request',
      body,
      authorization: auth,
      nowSec,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Request timestamp outside replay window');
  });

  it('rejects missing authorization header', () => {
    const result = verifyRequestHmac({
      secret,
      method: 'POST',
      path: '/api/request',
      body: '{}',
      authorization: '',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Missing or malformed/);
  });

  it('rejects wrong method or path (body hash mismatch)', () => {
    const body = '{"target":"Northwind Robotics"}';
    const auth = buildAuthorizationHeader({
      secret,
      method: 'POST',
      path: '/api/request',
      body,
    });
    const result = verifyRequestHmac({
      secret,
      method: 'GET',
      path: '/api/request',
      body,
      authorization: auth,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Signature mismatch');
  });
});
