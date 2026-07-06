/**
 * Cassette Infrastructure Tests
 *
 * Covers recorder/player types, serialization, and lookup.
 *
 * No Anthropic code.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  getCassetteMode,
  cassetteDir,
  ensureDir,
  urlHash,
  queryHash,
  saveSearchCassette,
  loadSearchCassette,
  saveFetchCassette,
  loadFetchCassette,
  findSearchEntry,
  findFetchEntry,
  toSearchEntry,
  toFetchEntry,
  summarizeCassette,
} from '../src/cassette.js';

const TEST_CASE_ID = 'test-case-01';
const TEST_ROOT = join(process.cwd(), 'fixtures/cassettes');

describe('cassette.ts', () => {
  beforeEach(() => {
    const dir = cassetteDir(TEST_CASE_ID);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    const dir = cassetteDir(TEST_CASE_ID);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('getCassetteMode defaults to off', () => {
    delete (process.env as Record<string, string>).CASSETTE_MODE;
    expect(getCassetteMode()).toBe('off');
  });

  it('getCassetteMode reads env', () => {
    process.env.CASSETTE_MODE = 'record';
    expect(getCassetteMode()).toBe('record');
    process.env.CASSETTE_MODE = 'play';
    expect(getCassetteMode()).toBe('play');
    delete (process.env as Record<string, string>).CASSETTE_MODE;
  });

  it('urlHash is deterministic and short', () => {
    const h1 = urlHash('https://example.com/page');
    const h2 = urlHash('https://example.com/page');
    expect(h1).toBe(h2);
    expect(h1.length).toBe(16);
  });

  it('queryHash is deterministic and short', () => {
    const h1 = queryHash('test query');
    const h2 = queryHash('test query');
    expect(h1).toBe(h2);
    expect(h1.length).toBe(16);
  });

  it('search cassette round-trip', () => {
    const entries = [
      toSearchEntry('q1', { results: [{ title: 't', url: 'https://ex.com' }], latencyMs: 0, status: 'ok' }),
    ];
    saveSearchCassette(TEST_CASE_ID, entries);
    const loaded = loadSearchCassette(TEST_CASE_ID);
    expect(loaded).toHaveLength(1);
    expect(loaded![0].query).toBe('q1');
  });

  it('fetch cassette round-trip', () => {
    const entries = [
      toFetchEntry('https://ex.com', { ok: true, latencyMs: 0, title: 'Title' }, 'extracted text'),
    ];
    saveFetchCassette(TEST_CASE_ID, entries);
    const loaded = loadFetchCassette(TEST_CASE_ID);
    expect(loaded).toHaveLength(1);
    expect(loaded![0].url).toBe('https://ex.com');
  });

  it('findSearchEntry returns entry on hit', () => {
    const entries = [
      toSearchEntry('q1', { results: [{ title: 't', url: 'https://ex.com' }], latencyMs: 0, status: 'ok' }),
    ];
    saveSearchCassette(TEST_CASE_ID, entries);
    const entry = findSearchEntry(TEST_CASE_ID, 'q1');
    expect(entry).toBeDefined();
    expect(entry!.query).toBe('q1');
  });

  it('findSearchEntry returns undefined on miss', () => {
    saveSearchCassette(TEST_CASE_ID, []);
    const entry = findSearchEntry(TEST_CASE_ID, 'no-such-query');
    expect(entry).toBeUndefined();
  });

  it('findFetchEntry returns entry on hit', () => {
    const entries = [
      toFetchEntry('https://example.com', { ok: true, latencyMs: 0 }, 'text'),
    ];
    saveFetchCassette(TEST_CASE_ID, entries);
    const entry = findFetchEntry(TEST_CASE_ID, 'https://example.com');
    expect(entry).toBeDefined();
  });

  it('summarizeCassette returns counts', () => {
    saveSearchCassette(TEST_CASE_ID, [
      toSearchEntry('q', { results: [], latencyMs: 0, status: 'empty' }),
    ]);
    saveFetchCassette(TEST_CASE_ID, [
      toFetchEntry('https://example.com', { ok: true, latencyMs: 0 }, 'text'),
    ]);
    const summary = summarizeCassette(TEST_CASE_ID);
    expect(summary).toBeDefined();
    expect(summary!.searches).toBe(1);
    expect(summary!.fetches).toBe(1);
  });
});
