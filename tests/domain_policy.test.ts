import { describe, it, expect } from 'vitest';
import { loadDomainPolicy, DEFAULT_POLICY } from '../src/domain_policy.js';

describe('loadDomainPolicy', () => {
  it('throws for missing file as expected', () => {
    expect(() => loadDomainPolicy('does-not-exist.json')).toThrow();
  });
});

describe('DEFAULT_POLICY', () => {
  it('has denyPrivate enabled', () => {
    expect(DEFAULT_POLICY.denyPrivate).toBe(true);
  });

  it('has known malicious domains', () => {
    expect(DEFAULT_POLICY.knownMalicious).toContain('evil.com');
  });

  it('allows everything else by default', () => {
    expect(DEFAULT_POLICY.defaultAction).toBe('allow');
  });
});
