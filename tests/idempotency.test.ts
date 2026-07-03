import { describe, it, expect } from 'vitest';
import { deriveIdempotencyKey } from '../src/idempotency.js';

describe('deriveIdempotencyKey', () => {
  it('produces the same hash for identical requests', () => {
    const req = { target: 'Northwind Robotics', slots: ['overview'] };
    expect(deriveIdempotencyKey(req)).toBe(deriveIdempotencyKey(req));
  });

  it('produces the same hash after case normalization', () => {
    const a = { target: 'Northwind Robotics' };
    const b = { target: 'northwind robotics' };
    expect(deriveIdempotencyKey(a)).toBe(deriveIdempotencyKey(b));
  });

  it('produces the same hash after whitespace normalization', () => {
    const a = { target: '  Northwind   Robotics  ' };
    const b = { target: 'northwind robotics' };
    expect(deriveIdempotencyKey(a)).toBe(deriveIdempotencyKey(b));
  });

  it('produces the same hash after key reordering', () => {
    const a = { z: 1, a: 2 };
    const b = { a: 2, z: 1 };
    expect(deriveIdempotencyKey(a)).toBe(deriveIdempotencyKey(b));
  });

  it('produces different hashes for different content', () => {
    const a = { target: 'Northwind Robotics' };
    const b = { target: 'Northwind Robotics Inc' };
    expect(deriveIdempotencyKey(a)).not.toBe(deriveIdempotencyKey(b));
  });

  it('ignores undefined values and empty arrays', () => {
    const a = { target: 'x', extra: undefined, empty: [] };
    const b = { target: 'x' };
    expect(deriveIdempotencyKey(a)).toBe(deriveIdempotencyKey(b));
  });

  it('preserves nested object canonicalization', () => {
    const a = { target: { name: '  Acme  ', site: 'https://ac.me' } };
    const b = { target: { site: 'https://ac.me', name: 'acme' } };
    expect(deriveIdempotencyKey(a)).toBe(deriveIdempotencyKey(b));
  });

  it('produces a 64-character hex string', () => {
    const hash = deriveIdempotencyKey({ a: 1 });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
