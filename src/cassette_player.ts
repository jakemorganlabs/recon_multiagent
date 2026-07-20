/**
 * Cassette player: interceptor for web tool calls.
 *
 * Wraps searchWeb() and fetchWeb() so that:
 *   CASSETTE_MODE=record  passes through to live web, then writes to cassette
 *   CASSETTE_MODE=play    returns cached response from cassette; on miss returns empty/error
 *   CASSETTE_MODE=off     passes through to live web
 */

import { searchWeb, type SearchAdapterOptions } from './search_adapter.js';
import { fetchWeb, type FetchToolOptions } from './fetch_tool.js';
import { extractMainContent } from './extraction_sidecar.js';
import {
  getCassetteMode,
  findSearchEntry,
  findFetchEntry,
  toSearchEntry,
  toFetchEntry,
  saveSearchCassette,
  saveFetchCassette,
  loadSearchCassette,
  loadFetchCassette,
} from './cassette.js';

// Re-export so callers (e.g. scripts/record_cassettes.ts) can import the
// cassette mode from the player surface alongside the player functions.
export { getCassetteMode } from './cassette.js';

export interface CassettePlayerOptions {
  caseId: string;
  searchOpts: SearchAdapterOptions;
  fetchOpts: FetchToolOptions;
}

const _searchAccum: Map<string, ReturnType<typeof toSearchEntry>[]> = new Map();
const _fetchAccum: Map<string, ReturnType<typeof toFetchEntry>[]> = new Map();

function getSearchAccum(caseId: string) {
  if (!_searchAccum.has(caseId)) _searchAccum.set(caseId, []);
  return _searchAccum.get(caseId)!;
}

function getFetchAccum(caseId: string) {
  if (!_fetchAccum.has(caseId)) _fetchAccum.set(caseId, []);
  return _fetchAccum.get(caseId)!;
}

/** Flush any recorded entries to disk. Call before process exit in record mode. */
export function flushCassette(caseId: string): void {
  const s = getSearchAccum(caseId);
  if (s.length > 0) {
    const existing = loadSearchCassette(caseId) ?? [];
    const merged = mergeSearchEntries(existing, s);
    saveSearchCassette(caseId, merged);
    s.length = 0;
  }
  const f = getFetchAccum(caseId);
  if (f.length > 0) {
    const existing = loadFetchCassette(caseId) ?? [];
    const merged = mergeFetchEntries(existing, f);
    saveFetchCassette(caseId, merged);
    f.length = 0;
  }
}

function mergeSearchEntries(
  existing: ReturnType<typeof toSearchEntry>[],
  incoming: ReturnType<typeof toSearchEntry>[]
) {
  const byQuery = new Map(existing.map((e) => [e.query, e]));
  for (const inc of incoming) byQuery.set(inc.query, inc);
  return Array.from(byQuery.values());
}

function mergeFetchEntries(
  existing: ReturnType<typeof toFetchEntry>[],
  incoming: ReturnType<typeof toFetchEntry>[]
) {
  const byUrl = new Map(existing.map((e) => [e.url, e]));
  for (const inc of incoming) byUrl.set(inc.url, inc);
  return Array.from(byUrl.values());
}

/**
 * Intercepted searchWeb that respects CASSETTE_MODE.
 */
export async function searchWebWithCassette(
  query: string,
  opts: SearchAdapterOptions,
  caseId: string
): Promise<{
  results: Array<{ title: string; url: string; description?: string }>;
  latencyMs: number;
  status: 'ok' | 'empty' | 'error';
}> {
  const mode = getCassetteMode();

  if (mode === 'play') {
    const entry = findSearchEntry(caseId, query);
    if (!entry) {
      console.warn(`[cassette] cache miss for search query: "${query}"`);
      return { results: [], latencyMs: 0, status: 'error' };
    }
    return {
      results: entry.results,
      latencyMs: 0,
      status: entry.status,
    };
  }

  // record or off: pass through to live
  const result = await searchWeb(query, opts);

  if (mode === 'record') {
    const entry = toSearchEntry(query, result);
    getSearchAccum(caseId).push(entry);
  }

  return result;
}

/**
 * Intercepted fetchWeb that respects CASSETTE_MODE.
 */
export async function fetchWebWithCassette(
  url: string,
  opts: FetchToolOptions,
  caseId: string
): Promise<{
  ok: boolean;
  status: 'fetched' | 'scheme_denied' | 'domain_denied' | 'size_denied' | 'timeout' | 'network_error' | 'head_failed';
  reason: string;
  url: string;
  finalUrl?: string;
  html?: string;
  title?: string;
  contentLength?: number;
  latencyMs: number;
}> {
  const mode = getCassetteMode();

  if (mode === 'play') {
    const entry = findFetchEntry(caseId, url);
    if (!entry) {
      console.warn(`[cassette] cache miss for fetch url: ${url}`);
      return {
        ok: false,
        status: 'network_error',
        reason: 'cassette cache miss',
        url,
        latencyMs: 0,
      };
    }
    return {
      ok: entry.status === 'ok',
      status: entry.status === 'ok' ? 'fetched' : entry.status === 'timeout' ? 'timeout' : 'network_error',
      reason: entry.status === 'ok' ? 'OK' : 'Cassette error',
      url: entry.url,
      finalUrl: entry.url,
      html: entry.extractedText,
      title: entry.title,
      latencyMs: 0,
    };
  }

  // record or off: pass through to live
  const result = await fetchWeb(url, opts);

  if (mode === 'record') {
    // Need extracted text for the cassette; compute it
    let extracted = '';
    if (result.ok && result.html) {
      extracted = extractMainContent(result.html, result.finalUrl ?? url).mainText;
    }
    const entry = toFetchEntry(url, { ...result, status: result.status === 'timeout' ? 408 : result.ok ? 200 : 500 }, extracted);
    getFetchAccum(caseId).push(entry);
  }

  return result;
}
