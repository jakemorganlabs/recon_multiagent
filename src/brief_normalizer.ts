/**
 * Brief Normalizer
 *
 * Sends a raw request to DeepInfra (Gemma 4, via OpenAI-compatible endpoint)
 * and returns a schema-valid Brief object.
 *
 * Uses JSON mode (response_format: { type: 'json_object' }) plus a
 * one-shot repair loop on schema validation failure.
 *
 * If the model signals the target is unresolvable (status: 'unresolvable'),
 * returns a clarify response instead of a Brief.
 *
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { Brief } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '../schemas/brief.schema.json');
const briefSchema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateBrief = ajv.compile(briefSchema);

export interface NormalizeResult {
  brief: Brief | null;
  clarify: { status: 'clarify'; reason: string } | null;
  raw: unknown;
}

export interface BriefNormalizerOptions {
  /** DeepInfra base URL (e.g. https://api.deepinfra.com/v1/openai) */
  baseUrl: string;
  /** DeepInfra API key */
  apiKey: string;
  /** Model name (default: google/gemma-4-26B-A4B-it) */
  model?: string;
  /** Max tokens for the extraction call */
  maxTokens?: number;
  /** Temperature — always 0 for deterministic extraction */
  temperature?: number;
}

/** System prompt that instructs Gemma to emit a JSON object conforming to brief.schema.json */
function buildSystemPrompt(): string {
  return `You are a Brief Normalizer. Your job is to take a raw research request and turn it into a structured JSON object that matches the following schema exactly.

Schema:
${JSON.stringify(briefSchema, null, 2)}

Rules:
1. The output MUST be a single JSON object with no extra text, markdown, or explanation.
2. The ".target.name" field must be a clear company or organization name.
3. The ".slots" array must contain at least one slot. Valid slot_name values are: overview, products, funding, headcount, tech_stack, hiring, leadership, recent_news, risks.
4. If the target company name is ambiguous, unknown, or the request cannot be resolved to a specific entity, emit: {"status": "unresolvable", "reason": "<one-sentence explanation>"}.
5. Otherwise emit a full Brief object with all required fields populated.
6. Do not invent URLs for seed_urls unless you are confident they exist; omit the field if unsure.
7. Keep questions concise (under 120 characters).`;
}

/** Send the raw request to DeepInfra / Gemma and parse the JSON response. */
async function callExtraction(
  rawRequest: Record<string, unknown>,
  opts: BriefNormalizerOptions,
  priorError?: string
): Promise<unknown> {
  const model = opts.model ?? 'google/gemma-4-26B-A4B-it';
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: buildSystemPrompt() },
  ];

  if (priorError) {
    messages.push({
      role: 'system',
      content: `Previous attempt failed schema validation with: ${priorError}\nPlease fix the output and return a valid JSON object matching the schema.`,
    });
  }

  messages.push({
    role: 'user',
    content: `Raw request:\n${JSON.stringify(rawRequest, null, 2)}`,
  });

  const body = {
    model,
    messages,
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens ?? 2048,
    response_format: { type: 'json_object' },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`DeepInfra API error ${res.status}: ${text}`);
  }

  const data: unknown = await res.json();
  function safeGet(obj: unknown, ...path: string[]): unknown {
    let current = obj;
    for (const key of path) {
      if (current === null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }
  const content = safeGet(data, 'choices', '0', 'message', 'content');
  if (!content || typeof content !== 'string') {
    throw new Error('Missing content in DeepInfra response');
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`DeepInfra returned invalid JSON: ${content.slice(0, 200)}`);
  }
}

/** Public entrypoint. Attempts extraction + one-shot repair. */
export async function normalizeBrief(
  rawRequest: Record<string, unknown>,
  opts: BriefNormalizerOptions
): Promise<{ result: NormalizeResult; attempts: number }> {
  let attempt = 1;
  let raw = await callExtraction(rawRequest, opts);

  // Check for unresolvable signal first
  if (
    raw !== null &&
    typeof raw === 'object' &&
    'status' in raw &&
    (raw as Record<string, unknown>).status === 'unresolvable' &&
    'reason' in raw &&
    typeof (raw as Record<string, unknown>).reason === 'string'
  ) {
    return {
      result: {
        brief: null,
        clarify: { status: 'clarify', reason: (raw as Record<string, unknown>).reason as string },
        raw,
      },
      attempts: attempt,
    };
  }

  // Validate against schema
  const valid = validateBrief(raw);
  if (valid) {
    return {
      result: {
        brief: raw as Brief,
        clarify: null,
        raw,
      },
      attempts: attempt,
    };
  }

  // One-shot repair
  const errors = validateBrief.errors ?? [{ message: 'Unknown validation error' }];
  const errorText = errors.map((e) => `${('instancePath' in e ? e.instancePath : '???')} ${e.message}`).join('; ');
  attempt = 2;
  raw = await callExtraction(rawRequest, opts, errorText);

  const valid2 = validateBrief(raw);
  if (valid2) {
    return {
      result: {
        brief: raw as Brief,
        clarify: null,
        raw,
      },
      attempts: attempt,
    };
  }

  // Second failure — treat as failed
  const errors2 = validateBrief.errors ?? [{ message: 'Unknown validation error' }];
  const errorText2 = errors2.map((e) => `${('instancePath' in e ? e.instancePath : '???')} ${e.message}`).join('; ');
  throw new Error(`Brief extraction failed schema validation after repair: ${errorText2}`);
}
