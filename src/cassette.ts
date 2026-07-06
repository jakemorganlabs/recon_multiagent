/**
 * Cassette Infrastructure — Recorder & Player
 *
 * Intercepts web tool calls (search + fetch) and records them to disk
 * as versioned JSON (record mode) or replays from disk (play mode).
 *
 * CASSETTE_MODE=record  → writes every response to fixtures/cassettes/{case_id}/
 * CASSETTE_MODE=play    → serves from cassettes; returns empty on cache miss
 * CASSETTE_MODE=off     → passthrough to live web (default)
 *
 * No Anthropic code. Pure deterministic IO.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type CassetteMode = 'record' | 'play' | 'off';

const CASSETTES_ROOT = join(__dirname, '../fixtures/cassettes');

export interface SearchCassetteEntry {
  query: string;
  results: Array<{ title: string; url: string; description?: string }>;
  latencyMs: number;
  status: 'ok' | 'empty' | 'error';
  recordedAt: string;
  version: string;
}

export interface FetchCassetteEntry {
  url: string;
  htmlDigest: string;
  extractedText: string;
  title?: string;
  latencyMs: number;
  status: 'ok' | 'error' | 'timeout';
  recordedAt: string;
  version: string;
}

/** Get the current cassette mode from env. */
export function getCassetteMode(): CassetteMode {
  const m = process.env.CASSETTE_MODE;
  if (m === 'record' || m === 'play') return m;
  return 'off';
}

/** Resolve cassette directory for a case. */
export function cassetteDir(caseId: string): string {
  return join(CASSETTES_ROOT, caseId);
}

/** Ensure cassette directory exists. */
export function ensureDir(caseId: string): string {
  const dir = cassetteDir(caseId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Compute a short hash for a URL to use as filename. */
export function urlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/** Compute a short hash for a query to use as filename. */
export function queryHash(query: string): string {
  return createHash('sha256').update(query).digest('hex').slice(0, 16);
}

/* ─── Search Cassette ─── */

const SEARCH_CASSETTE_FILE = 'searches.json';

export function saveSearchCassette(
  caseId: string,
  entries: SearchCassetteEntry[]
): void {
  const dir = ensureDir(caseId);
  const path = join(dir, SEARCH_CASSETTE_FILE);
  writeFileSync(path, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

export function loadSearchCassette(caseId: string): SearchCassetteEntry[] | null {
  const dir = cassetteDir(caseId);
  const path = join(dir, SEARCH_CASSETTE_FILE);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return null;
    return raw as SearchCassetteEntry[];
  } catch {
    return null;
  }
}

/* ─── Fetch Cassette ─── */

const FETCH_CASSETTE_FILE = 'fetches.json';

export function saveFetchCassette(
  caseId: string,
  entries: FetchCassetteEntry[]
): void {
  const dir = ensureDir(caseId);
  const path = join(dir, FETCH_CASSETTE_FILE);
  writeFileSync(path, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

export function loadFetchCassette(caseId: string): FetchCassetteEntry[] | null {
  const dir = cassetteDir(caseId);
  const path = join(dir, FETCH_CASSETTE_FILE);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return null;
    return raw as FetchCassetteEntry[];
  } catch {
    return null;
  }
}

/* ─── Lookup helpers ─── */

export function findSearchEntry(
  caseId: string,
  query: string
): SearchCassetteEntry | undefined {
  const all = loadSearchCassette(caseId);
  if (!all) return undefined;
  const hash = queryHash(query);
  return all.find((e) => queryHash(e.query) === hash);
}

export function findFetchEntry(
  caseId: string,
  url: string
): FetchCassetteEntry | undefined {
  const all = loadFetchCassette(caseId);
  if (!all) return undefined;
  const hash = urlHash(url);
  return all.find((e) => urlHash(e.url) === hash);
}

/* ─── Recording helpers ─── */

const CASSETTE_VERSION = 'v1';

export function toSearchEntry(
  query: string,
  result: {
    results: Array<{ title: string; url: string; description?: string }>;
    latencyMs: number;
    status: 'ok' | 'empty' | 'error';
  }
): SearchCassetteEntry {
  return {
    query,
    results: result.results,
    latencyMs: result.latencyMs,
    status: result.status,
    recordedAt: new Date().toISOString(),
    version: CASSETTE_VERSION,
  };
}

export function toFetchEntry(
  url: string,
  result: {
    ok: boolean;
    html?: string;
    finalUrl?: string;
    title?: string;
    latencyMs: number;
    status?: number;
  },
  extractedText: string
): FetchCassetteEntry {
  const htmlDigest = result.html ? createHash('sha256').update(result.html).digest('hex').slice(0, 16) : '';
  const status: FetchCassetteEntry['status'] = !result.ok
    ? result.status === 408 ? 'timeout' : 'error'
    : 'ok';
  return {
    url: result.finalUrl ?? url,
    htmlDigest,
    extractedText: extractedText ?? '',
    title: result.title ?? undefined,
    latencyMs: result.latencyMs,
    status,
    recordedAt: new Date().toISOString(),
    version: CASSETTE_VERSION,
  };
}

/* ─── Summary / metadata ─── */

export interface CassetteSummary {
  caseId: string;
  searches: number;
  fetches: number;
  version: string;
  recordedAt: string;
}

export function summarizeCassette(caseId: string): CassetteSummary | null {
  const searches = loadSearchCassette(caseId) ?? [];
  const fetches = loadFetchCassette(caseId) ?? [];
  if (searches.length === 0 && fetches.length === 0) return null;
  return {
    caseId,
    searches: searches.length,
    fetches: fetches.length,
    version: searches[0]?.version ?? fetches[0]?.version ?? CASSETTE_VERSION,
    recordedAt: searches[0]?.recordedAt ?? fetches[0]?.recordedAt ?? new Date().toISOString(),
  };
}
