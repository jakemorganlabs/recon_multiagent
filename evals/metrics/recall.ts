/**
 * Metric 1: Evidence Recall@k
 *
 * For cases with gold_sources, checks if any gold URL appears in the
 * top-k retrieved evidence URLs. URL matching is exact after normalization.
 *
 *
 */

import type { EvidenceItem } from '../../src/types.js';

export function computeRecallAtK(
  evidence: EvidenceItem[],
  goldSources: string[],
  k: number = 10
): { numerator: number; denominator: number; value: number } {
  if (goldSources.length === 0) {
    return { numerator: 0, denominator: 0, value: 0 };
  }
  const topK = evidence
    .filter((e) => e.retrieval_rank !== undefined)
    .sort((a, b) => (a.retrieval_rank ?? 999) - (b.retrieval_rank ?? 999))
    .slice(0, k);

  const topUrls = new Set(topK.map((e) => normalizeUrl(e.source_url)));
  const goldUrls = goldSources.map(normalizeUrl);

  let hits = 0;
  for (const g of goldUrls) {
    if (topUrls.has(g)) hits++;
  }

  return {
    numerator: hits,
    denominator: goldUrls.length,
    value: hits / goldUrls.length,
  };
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString().toLowerCase().replace(/\/$/, '');
  } catch {
    return url.toLowerCase().trim();
  }
}
