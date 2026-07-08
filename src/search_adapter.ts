/**
 * Web Search Adapter
 *
 * Thin wrapper around a search provider (Brave Search recommended for
 * portfolio cost). Attaches provenance, handles 429 with exponential
 * backoff, and treats thin/empty results as valid (empty array, not error).
 *
 *
 * extraction, but the search itself is a raw HTTP call to the provider.
 */

import { createHash } from 'node:crypto';

export interface SearchResult {
  title: string;
  url: string;
  description?: string;
}

export interface SearchAdapterOptions {
  /** Search provider API key (e.g., Brave Search API key) */
  apiKey: string;
  /** Provider base URL. Default: https://api.search.brave.com/res/v1/web/search */
  baseUrl?: string;
  /** Max results to request per query. Default: 10 (overridden by budgets.json) */
  count?: number;
  /** Per-call timeout in ms. Default: 10000 */
  timeoutMs?: number;
  /** Max retries on 429 / network error. Default: 3 */
  maxRetries?: number;
}

/**
 * Call the search provider and return results.
 * Empty or thin results return [] — never throw.
 */
export async function searchWeb(
  query: string,
  opts: SearchAdapterOptions
): Promise<{ results: SearchResult[]; latencyMs: number; status: 'ok' | 'empty' | 'error' }> {
  const baseUrl = (opts.baseUrl ?? 'https://api.search.brave.com/res/v1/web/search').replace(/\/$/, '');
  const count = opts.count ?? 10;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const maxRetries = opts.maxRetries ?? 3;

  const url = new URL(`${baseUrl}?q=${encodeURIComponent(query)}&count=${count}&offset=0`);

  const start = performance.now();
  let lastError: string | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': opts.apiKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.status === 429) {
        const backoffMs = 2 ** attempt * 1000 + Math.random() * 500;
        await sleep(backoffMs);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
        continue;
      }

      // Brave Search response shape: { web: { results: [{ title, url, description }] } }
      const data: unknown = await res.json();
      const results = extractResults(data);
      const latencyMs = Math.round(performance.now() - start);

      if (results.length === 0) {
        return { results: [], latencyMs, status: 'empty' };
      }

      return { results, latencyMs, status: 'ok' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof DOMException && err.name === 'AbortError') {
        lastError = `Timeout after ${timeoutMs}ms`;
      } else {
        lastError = msg;
      }
    }
  }

  const latencyMs = Math.round(performance.now() - start);
  void lastError;
  return { results: [], latencyMs, status: 'error' };
}

/** Normalize provider-specific response shapes into our SearchResult[]. */
function extractResults(data: unknown): SearchResult[] {
  if (data === null || typeof data !== 'object') return [];

  // Brave Search
  const web = (data as Record<string, unknown>).web;
  if (web && typeof web === 'object') {
    const raw = (web as Record<string, unknown>).results;
    if (Array.isArray(raw)) {
      return raw
        .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
        .map((r) => ({
          title: String(r.title ?? ''),
          url: String(r.url ?? ''),
          description: String(r.description ?? ''),
        }))
        .filter((r) => r.url.length > 0);
    }
  }

  // SerpAPI / generic fallback: look for "organic_results"
  const organic = (data as Record<string, unknown>).organic_results;
  if (Array.isArray(organic)) {
    return organic
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
      .map((r) => ({
        title: String(r.title ?? ''),
        url: String(r.link ?? r.url ?? ''),
        description: String(r.snippet ?? r.description ?? ''),
      }))
      .filter((r) => r.url.length > 0);
  }

  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Convenience: compute SHA-256 content hash for evidence provenance. */
export function computeContentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
