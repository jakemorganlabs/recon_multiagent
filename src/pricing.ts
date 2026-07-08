/**
 * Pricing Loader
 *
 * Loads config/pricing.json and checks freshness.
 * Logs a pricing_stale warning if as_of is > 90 days old.
 * Never contains keys, URLs, or tokens — only rates.
 *
 * Invariant: if a price is requested for a model not in the config,
 * the caller receives a clear error so the config must be maintained.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRICING_PATH = join(__dirname, '../config/pricing.json');

export interface PricingConfig {
  meta: {
    as_of: string;
    provider: string;
    note?: string;
  };
  models: Record<string, {
    input_per_mtok: number;
    output_per_mtok: number;
    cache_read_per_mtok: number;
    cache_creation_per_mtok: number;
    note?: string;
  }>;
  search: {
    provider: string;
    cost_per_query_usd: number;
    source: string;
  };
  staleness_warning_days: number;
}

let _cached: { config: PricingConfig; loadedAt: Date } | null = null;

/**
 * Load pricing config once, warn if stale.
 * Returns the config + a boolean for whether the warning fired.
 */
export function loadPricing(): { config: PricingConfig; stale: boolean } {
  if (_cached) {
    const config = _cached.config;
    const stale = isStale(config);
    return { config, stale };
  }

  const raw = readFileSync(PRICING_PATH, 'utf8');
  const config = JSON.parse(raw) as PricingConfig;
  _cached = { config, loadedAt: new Date() };
  const stale = isStale(config);
  return { config, stale };
}

function isStale(config: PricingConfig): boolean {
  const asOf = new Date(config.meta.as_of);
  const now = new Date();
  const diffMs = now.getTime() - asOf.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > config.staleness_warning_days;
}

/**
 * Calculate cost for a single model call in USD.
 * Gemma does not support prompt caching — cache columns are zero.
 */
export function computeCallCost(
  config: PricingConfig,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number
): number {
  const rates = config.models[modelId];
  if (!rates) {
    throw new Error(`Model "${modelId}" not found in pricing config. Add it to config/pricing.json.`);
  }

  const inputCost     = (inputTokens     / 1_000_000) * rates.input_per_mtok;
  const outputCost    = (outputTokens    / 1_000_000) * rates.output_per_mtok;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * rates.cache_read_per_mtok;
  const cacheCreateCost = (cacheCreationTokens / 1_000_000) * rates.cache_creation_per_mtok;

  return inputCost + outputCost + cacheReadCost + cacheCreateCost;
}

/**
 * Calculate cache savings rate.
 * Formula: cache_read / (cache_read + cache_creation + uncached_input)
 */
export function computeCacheSavingsRate(
  cacheReadTokens: number,
  cacheCreationTokens: number,
  uncachedInputTokens: number
): number {
  const denominator = cacheReadTokens + cacheCreationTokens + uncachedInputTokens;
  if (denominator === 0) return 0;
  return cacheReadTokens / denominator;
}
