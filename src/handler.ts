/**
 * Request Handler Orchestration
 *
 * Entrypoint for the n8n webhook trigger.
 * Sequences: HMAC verify → idempotency check → run creation → brief normalizer
 * → shared-state writes → structured logging → audit rows.
 *
 * No Anthropic code. All LLM calls go through DeepInfra / Gemma 4.
 */

import { verifyRequestHmac } from './hmac.js';
import { deriveIdempotencyKey } from './idempotency.js';
import {
  findRunByHash,
  createRun,
  updateRunStatus,
  createBrief,
  writeAudit,
} from './db.js';
import { normalizeBrief, type BriefNormalizerOptions } from './brief_normalizer.js';
import { logCompleted, logError } from './log.js';

export interface HandleRequestOptions {
  /** HMAC secret */
  hmacSecret: string;
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Raw body string */
  body: string;
  /** Authorization header value */
  authorization: string;
  /** DeepInfra / Gemma API options */
  normalizerOpts: BriefNormalizerOptions;
}

export interface HandlerResult {
  statusCode: number;
  body: Record<string, unknown>;
}

export async function handleRequest(opts: HandleRequestOptions): Promise<HandlerResult> {
  const start = performance.now();

  // --- Step 1: HMAC verification ---
  const hmacResult = verifyRequestHmac({
    secret: opts.hmacSecret,
    method: opts.method,
    path: opts.path,
    body: opts.body,
    authorization: opts.authorization,
  });

  if (!hmacResult.valid) {
    return {
      statusCode: 401,
      body: { status: 'unauthorized', reason: hmacResult.reason },
    };
  }

  // Parse the request body
  let rawRequest: Record<string, unknown>;
  try {
    rawRequest = JSON.parse(opts.body) as Record<string, unknown>;
  } catch {
    return {
      statusCode: 400,
      body: { status: 'bad_request', reason: 'Body is not valid JSON' },
    };
  }

  const requestHash = deriveIdempotencyKey(rawRequest);

  // --- Step 2: Idempotency guard ---
  const existingRun = await findRunByHash(requestHash);
  if (existingRun) {
    // Audit the duplicate
    await writeAudit(existingRun.id, 'request_duplicate', {
      request_hash: requestHash,
      run_id: existingRun.id,
    });
    return {
      statusCode: 200,
      body: { status: 'existing', run_id: existingRun.id, created_at: existingRun.created_at },
    };
  }

  // --- Step 3: Create the run row ---
  const runId = await createRun(requestHash, rawRequest.target_name as string | undefined);
  await writeAudit(runId, 'run_created', {
    request_body: opts.body.slice(0, 500), // truncate for audit safety
    request_hash: requestHash,
  });

  // --- Step 4: Brief Normalizer ---
  await updateRunStatus(runId, 'running');
  let briefResult: Awaited<ReturnType<typeof normalizeBrief>>;
  try {
    const t0 = performance.now();
    briefResult = await normalizeBrief(rawRequest, opts.normalizerOpts);
    const latency = performance.now() - t0;
    logCompleted(runId, 'brief_normalize', latency, {
      attempts: briefResult.attempts,
      model_id: opts.normalizerOpts.model ?? 'google/gemma-4-26B-A4B-it',
    });
  } catch (err) {
    const latency = performance.now() - start;
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateRunStatus(runId, 'failed');
    await writeAudit(runId, 'brief_failed', { error: errorMsg });
    logError(runId, 'brief_normalize', latency, errorMsg);
    return {
      statusCode: 500,
      body: { status: 'failed', run_id: runId, reason: errorMsg },
    };
  }

  // --- Step 5: Clarification path ---
  if (briefResult.result.clarify) {
    await updateRunStatus(runId, 'clarify');
    await writeAudit(runId, 'brief_clarify', {
      reason: briefResult.result.clarify.reason,
    });
    const latency = performance.now() - start;
    logCompleted(runId, 'brief_clarify', latency, {
      reason: briefResult.result.clarify.reason,
    });
    return {
      statusCode: 200,
      body: {
        status: 'clarify',
        run_id: runId,
        reason: briefResult.result.clarify.reason,
      },
    };
  }

  // --- Step 6: Write the brief row ---
  const brief = briefResult.result.brief!;
  await createBrief(runId, brief);
  await updateRunStatus(runId, 'completed');
  await writeAudit(runId, 'brief_created', {
    target: brief.target,
    slot_names: brief.slots.map((s) => s.slot_name),
    depth: brief.depth ?? 1,
  });

  const latency = performance.now() - start;
  logCompleted(runId, 'brief_created', latency, {
      slot_count: brief.slots.length,
    target: brief.target.name,
  });

  return {
    statusCode: 200,
    body: {
      status: 'completed',
      run_id: runId,
      brief,
    },
  };
}
