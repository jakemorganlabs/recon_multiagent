import { describe, it, expect } from 'vitest';
import { normalizeSnippet } from '../src/normalize.js';

describe('normalizeSnippet', () => {
  it('collapses multiple spaces to a single space', () => {
    expect(normalizeSnippet('hello    world')).toBe('hello world');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeSnippet('  hello world  ')).toBe('hello world');
  });

  it('normalizes tabs to spaces and collapses runs', () => {
    expect(normalizeSnippet('hello\tworld\t\tfoo')).toBe('hello world foo');
  });

  it('strips zero-width characters', () => {
    const input = 'hello\u200Bworld\u200C\u200D\uFEFF';
    expect(normalizeSnippet(input)).toBe('hello world');
  });

  it('folds smart single quotes to ASCII', () => {
    expect(normalizeSnippet('\u2018hello\u2019')).toBe("'hello'");
  });

  it('folds smart double quotes to ASCII', () => {
    expect(normalizeSnippet('\u201Chello\u201D')).toBe('"hello"');
  });

  it('folds en-dash and em-dash', () => {
    expect(normalizeSnippet('cost\u2013effective')).toBe('cost-effective');
    expect(normalizeSnippet('cost\u2014effective')).toBe('cost--effective');
  });

  it('folds ellipsis to three dots', () => {
    expect(normalizeSnippet('wait\u2026')).toBe('wait...');
  });

  it('folds NBSP to space', () => {
    expect(normalizeSnippet('hello\u00A0world')).toBe('hello world');
  });

  it('applies NFC normalization to composed characters', () => {
    const decomposed = 'cafe\u0301'; // e + combining acute
    const composed = 'caf\u00e9';    // precomposed e-acute
    expect(normalizeSnippet(decomposed)).toBe(composed);
  });

  it('handles real-world PDF-extraction dirt', () => {
    const dirty =
      '  \u201CAutonomous\u00A0warehouse\u200Bpicking\u201D\u2026 cost-effective  ';
    const clean = '"Autonomous warehouse picking"... cost-effective';
    expect(normalizeSnippet(dirty)).toBe(clean);
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeSnippet('   \t\n  ')).toBe('');
  });

  it('handles ligatures gracefully (passes through, does NOT fold)', () => {
    // Ligature folding is intentionally NOT in scope for S01.
    // We only document the behavior: ligatures remain as-is.
    expect(normalizeSnippet('fi\ufb01')).toBe('fi\ufb01');
  });
});
