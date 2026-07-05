/**
 * Safeguarded Web Fetch Tool
 *
 * Enforces HTTP(S)-only schemes, an allow/deny domain policy, a fetched-byte
 * cap, and a per-call timeout. Returns {ok, status, reason, html, url}
 * so callers can distinguish structural skips from network errors.
 *
 * No Anthropic code. This is deterministic guard-layer code.
 */

export interface FetchToolOptions {
  /** Fetched-byte cap (default: 1 MiB from budgets.json) */
  maxBytes?: number;
  /** Per-fetch timeout ms (default: 15000) */
  timeoutMs?: number;
  /** Allowed domains (empty = none denied by this list) */
  allowlist?: string[];
  /** Denied domains / patterns */
  denylist?: string[];
  /** Whether to deny RFC1918 / loopback by default */
  denyPrivate?: boolean;
}

export interface FetchResult {
  ok: boolean;
  status: 'fetched' | 'scheme_denied' | 'domain_denied' | 'size_denied' | 'timeout' | 'network_error' | 'head_failed';
  reason: string;
  url: string;
  finalUrl?: string;
  html?: string;
  contentLength?: number;
  latencyMs: number;
}

const DEFAULT_DENYLIST = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '*.internal',
  '*.local',
  'metadata.google.internal',
  '169.254.169.254', // AWS / GCP metadata
];

/**
 * Fetch a URL with all safeguards applied.
 *
 * Steps:
 * 1. Scheme check — must be http: or https:
 * 2. Domain policy — allowlist membership, denylist match, RFC1918 test
 * 3. HEAD Content-Length check against maxBytes
 * 4. If all pass → GET with timeout, byte-truncate if needed
 */
export async function fetchWeb(
  url: string,
  opts: FetchToolOptions = {}
): Promise<FetchResult> {
  const maxBytes = opts.maxBytes ?? 1048576; // 1 MiB
  const timeoutMs = opts.timeoutMs ?? 15000;
  const allowlist = opts.allowlist ?? [];
  const denylist = opts.denylist ?? [];
  const denyPrivate = opts.denyPrivate ?? true;

  const start = performance.now();

  // --- 1. Scheme check ---
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      status: 'scheme_denied',
      reason: 'Invalid URL',
      url,
      latencyMs: Math.round(performance.now() - start),
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      status: 'scheme_denied',
      reason: `Scheme ${parsed.protocol} not allowed (HTTP/HTTPS only)`,
      url,
      latencyMs: Math.round(performance.now() - start),
    };
  }

  // --- 2. Domain policy ---
  const domain = parsed.hostname.toLowerCase();

  if (denyPrivate && isPrivateOrLoopback(domain)) {
    return {
      ok: false,
      status: 'domain_denied',
      reason: `Private / loopback address denied: ${domain}`,
      url,
      latencyMs: Math.round(performance.now() - start),
    };
  }

  if (matchDenylist(domain, DEFAULT_DENYLIST) || matchDenylist(domain, denylist)) {
    return {
      ok: false,
      status: 'domain_denied',
      reason: `Domain on denylist: ${domain}`,
      url,
      latencyMs: Math.round(performance.now() - start),
    };
  }

  // If allowlist is non-empty, domain must match it
  if (allowlist.length > 0 && !matchAllowlist(domain, allowlist)) {
    return {
      ok: false,
      status: 'domain_denied',
      reason: `Domain not on allowlist: ${domain}`,
      url,
      latencyMs: Math.round(performance.now() - start),
    };
  }

  // --- 3. HEAD Content-Length check ---
  try {
    const headRes = await fetchWithTimeout(url, { method: 'HEAD', timeoutMs: 5000 });
    if (headRes) {
      const cl = headRes.headers.get('content-length');
      if (cl) {
        const n = Number(cl);
        if (Number.isFinite(n) && n > maxBytes) {
          return {
            ok: false,
            status: 'size_denied',
            reason: `Content-Length ${n} exceeds cap ${maxBytes}`,
            url,
            latencyMs: Math.round(performance.now() - start),
          };
        }
      }
    }
  } catch {
    // HEAD is optional — proceed to GET if HEAD fails
  }

  // --- 4. GET with timeout and byte cap ---
  try {
    const res = await fetchWithTimeout(url, { method: 'GET', timeoutMs });
    if (!res) {
      return {
        ok: false,
        status: 'timeout',
        reason: `Timeout after ${timeoutMs}ms`,
        url,
        latencyMs: Math.round(performance.now() - start),
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: 'network_error',
        reason: `HTTP ${res.status}`,
        url,
        finalUrl: res.url,
        latencyMs: Math.round(performance.now() - start),
      };
    }

    const buf = await res.arrayBuffer();
    const bytes = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
    const html = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

    return {
      ok: true,
      status: 'fetched',
      reason: 'Fetched successfully',
      url,
      finalUrl: res.url,
      html,
      contentLength: buf.byteLength,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        ok: false,
        status: 'timeout',
        reason: `Timeout after ${timeoutMs}ms`,
        url,
        latencyMs: Math.round(performance.now() - start),
      };
    }
    return {
      ok: false,
      status: 'network_error',
      reason: msg.slice(0, 200),
      url,
      latencyMs: Math.round(performance.now() - start),
    };
  }
}

/** Internal helper: fetch with AbortController timeout. */
async function fetchWithTimeout(
  url: string,
  { method, timeoutMs }: { method: 'HEAD' | 'GET'; timeoutMs: number }
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/** Domain matches a glob-style denylist entry. */
function matchDenylist(domain: string, patterns: string[]): boolean {
  for (const p of patterns) {
    const pat = p.toLowerCase().trim();
    if (!pat) continue;
    if (pat === domain) return true;
    if (pat.startsWith('*.')) {
      const suffix = pat.slice(1); // includes leading dot
      if (domain.endsWith(suffix)) return true;
    }
  }
  return false;
}

/** Domain matches an allowlist entry (exact or wildcard). */
function matchAllowlist(domain: string, patterns: string[]): boolean {
  for (const p of patterns) {
    const pat = p.toLowerCase().trim();
    if (!pat) continue;
    if (pat === domain) return true;
    if (pat.startsWith('*.')) {
      const suffix = pat.slice(1);
      if (domain.endsWith(suffix)) return true;
    }
  }
  return false;
}

/** Naive RFC1918 + loopback detection. */
function isPrivateOrLoopback(domain: string): boolean {
  if (domain === 'localhost' || domain === '127.0.0.1' || domain === '::1') return true;

  const parts = domain.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }

  return false;
}
