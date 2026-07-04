/**
 * HMAC Request Verification
 *
 * Verifies that incoming requests are signed with a valid HMAC-SHA256 signature
 * and that the timestamp is within a configurable replay window (default 5 min).
 *
 * Steps:
 * 1. Parse the Authorization header: `HMAC <timestamp>:<signature>`
 * 2. Reject if timestamp is missing, malformed, or outside the replay window.
 * 3. Recompute HMAC-SHA256 over `<timestamp>.<canonical_method>.<canonical_path>.<body_hash>`.
 * 4. Compare signatures in constant time.
 * 5. Return { valid: true } or { valid: false, reason }.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface HmacVerifyResult {
  valid: boolean;
  reason?: string;
}

export interface HmacVerifyOptions {
  secret: string;
  method: string;
  path: string;
  body: string | Buffer;
  authorization: string;
  replayWindowSec?: number;
  nowSec?: number;
}

function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyRequestHmac(opts: HmacVerifyOptions): HmacVerifyResult {
  const { secret, method, path, body, authorization, replayWindowSec = 300, nowSec = Math.floor(Date.now() / 1000) } = opts;

  if (!authorization || !authorization.startsWith('HMAC ')) {
    return { valid: false, reason: 'Missing or malformed Authorization header' };
  }

  const payload = authorization.slice(5); // strip "HMAC "
  const colonIndex = payload.indexOf(':');
  if (colonIndex === -1) {
    return { valid: false, reason: 'Authorization payload missing timestamp:signature delimiter' };
  }

  const timestampStr = payload.slice(0, colonIndex);
  const providedSig = payload.slice(colonIndex + 1);

  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { valid: false, reason: 'Invalid timestamp in Authorization header' };
  }

  if (Math.abs(nowSec - timestamp) > replayWindowSec) {
    return { valid: false, reason: 'Request timestamp outside replay window' };
  }

  if (!providedSig || providedSig.length !== 64) {
    return { valid: false, reason: 'Invalid signature length' };
  }

  const bodyHash = createHmac('sha256', secret).update(body).digest('hex');
  const canonicalMethod = method.toUpperCase();
  const canonicalPath = path.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  const data = `${timestamp}.${canonicalMethod}.${canonicalPath}.${bodyHash}`;
  const expectedSig = createHmac('sha256', secret).update(data).digest('hex');

  if (!constantTimeCompare(providedSig, expectedSig)) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true };
}

export function buildAuthorizationHeader(opts: {
  secret: string;
  method: string;
  path: string;
  body: string | Buffer;
  timestampSec?: number;
}): string {
  const { secret, method, path, body, timestampSec = Math.floor(Date.now() / 1000) } = opts;
  const bodyHash = createHmac('sha256', secret).update(body).digest('hex');
  const canonicalMethod = method.toUpperCase();
  const canonicalPath = path.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  const data = `${timestampSec}.${canonicalMethod}.${canonicalPath}.${bodyHash}`;
  const signature = createHmac('sha256', secret).update(data).digest('hex');
  return `HMAC ${timestampSec}:${signature}`;
}
