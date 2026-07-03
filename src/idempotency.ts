/**
 * Idempotency Key Derivation
 *
 * Pure function: canonicalize a request object, then SHA-256.
 * Canonicalization rules (applied in order):
 * 1. Recurse into plain objects; ignore non-enumerable properties.
 * 2. Sort keys alphabetically.
 * 3. For string values: lowercase, trim whitespace, collapse whitespace runs.
 * 4. Omit undefined values and empty arrays.
 * 5. For numbers: emit as bare number (no quotes).
 * 6. JSON.stringify with no extra spaces.
 */

import { createHash } from 'node:crypto';

function canonicalizeValue(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
  }
  if (Array.isArray(value)) {
    const arr = value.map(canonicalizeValue).filter((v) => v !== undefined);
    return arr.length === 0 ? undefined : arr;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, canonicalizeValue(v)] as const)
      .filter(([, v]) => v !== undefined);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return Object.fromEntries(entries);
  }
  return undefined;
}

export function deriveIdempotencyKey(request: Record<string, unknown>): string {
  const canonical = canonicalizeValue(request);
  const payload = JSON.stringify(canonical);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
