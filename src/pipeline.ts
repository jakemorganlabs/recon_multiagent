/**
 * End-to-End Pipeline Orchestrator
 *
 * Composes the full Recon multi-agent pipeline:
 *   Brief → Search Agent → Analyst Agent → Synthesis Agent → Grounding Gate → Finalize
 *
 * The pipeline exposes:
 *   1. `runPipeline(caseId, request, opts)` — single-shot happy path
 *   2. `runPipelineWithCoverage(caseId, request, opts)` — with bounded coverage loop
 *
 * Bound to DeepInfra / Gemma (google/gemma-4-26B-A4B-it) throughout.
 * No Anthropic code.
 */

import { createHash } from 'node:crypto';
import { runSearchAgent, type SearchAgentOptions } from './search_agent.js';
import { runAnalystAgent, type AnalystAgentOptions } from './analyst_agent.js';
import { runSynthesisAgent, type SynthesisAgentOptions } from './synthesis_agent.js';
import { runGroundingGate } from './grounding_gate.js';
import { finalizeRun } from './run_finalizer.js';
import { decideCoverage } from './coverage.js';
import { persistSignals } from './signal_writer.js';
import {
  createRun,
  updateRunStatus,
  getEvidenceByRunId,
  getSignalsByRunId,
  writeAudit,
} from './db.js';
import { logCompleted, logError } from './log.js';
import type { Brief, EvidenceItem, Signal, Dossier } from './types.js';

export interface PipelineOptions {
  /** DeepInfra configuration */
  deepinfra: {
    baseUrl: string;
    apiKey: string;
    model?: string;
  };
  /** Search tool configuration */
  search: SearchAgentOptions['searchOpts'];
  /** Fetch tool configuration */
  fetch: SearchAgentOptions['fetchOpts'];
  /** Budget caps */
  budgets: {
    max_queries_per_run: number;
    max_fetches_per_run: number;
    max_fetch_bytes: number;
  };
  /** Coverage loop configuration */
  coverage: {
    maxIterations: number;
    confidenceFloor: number;
  };
  /** Agent-specific overrides (all optional) */
  analyst?: Omit<AnalystAgentOptions, 'baseUrl' | 'apiKey'>;
  synthesis?: Omit<SynthesisAgentOptions, 'baseUrl' | 'apiKey'>;
}

export interface PipelineResult {
  runId: string;
  status: 'complete' | 'gapped' | 'insufficient' | 'failed';
  brief: Brief;
  evidence: EvidenceItem[];
  signals: Signal[];
  dossier: Dossier;
  claimsTotal: number;
  claimsVerified: number;
  recastGaps: number;
  coverageIterations: number;
  stoppedBecause: string;
}

/**
 * Run the full pipeline with the bounded coverage loop.
 *
 * Flow:
 * 1. Create run + store brief via handler
 * 2. Search Agent gathers evidence
 * 3. Analyst Agent fills signals
 * 4. Coverage Decision: if unfilled required slots remain and budget → loop
 * 5. Synthesis Agent writes dossier
 * 6. Grounding Gate verifies every claim
 * 7. Finalizer sets status + persists dossier
 */
export async function runPipeline(
  caseId: string,
  request: { target_name: string; slots: Brief['slots'] },
  opts: PipelineOptions
): Promise<PipelineResult> {
  const start = performance.now();
  const model = opts.deepinfra.model ?? 'google/gemma-4-26B-A4B-it';

  // Step 0: Create run record
  const requestHash = hashRequest(request);
  const runId = await createRun(requestHash, request.target_name);
  await updateRunStatus(runId, 'running');

  try {
    // Step 1: Brief (manually construct since we already have the request)
    const brief: Brief = {
      target: { name: request.target_name },
      slots: request.slots,
      depth: 1,
    };

    await writeAudit(runId, 'pipeline_brief_ready', {
      target: brief.target.name,
      slot_count: brief.slots.length,
    });

    // Step 2: Search Agent (with cassette support via env)
    const searchOpts: SearchAgentOptions = {
      baseUrl: opts.deepinfra.baseUrl,
      apiKey: opts.deepinfra.apiKey,
      model,
      searchOpts: opts.search,
      fetchOpts: opts.fetch,
      budgets: opts.budgets,
      cassetteCaseId: caseId,
    };
    const searchResult = await runSearchAgent(runId, brief, searchOpts);

    const evidence = await getEvidenceByRunId(runId);

    // Step 3-4: Analyst + Coverage Loop
    let iteration = 0;
    let signals: Signal[] = [];
    let coverageDecision = decideCoverage(brief, [], 0, opts.coverage.maxIterations, opts.coverage.confidenceFloor);

    while (coverageDecision.action === 'loop' && iteration < opts.coverage.maxIterations) {
      iteration++;
      const analystOpts: AnalystAgentOptions = {
        baseUrl: opts.deepinfra.baseUrl,
        apiKey: opts.deepinfra.apiKey,
        model,
        ...opts.analyst,
      };

      const analystResult = await runAnalystAgent(runId, brief, evidence, analystOpts);
      signals = analystResult.signals;

      // Persist signals to shared state so Synthesis can read them
      await persistSignals(runId, signals);

      coverageDecision = decideCoverage(brief, signals, iteration, opts.coverage.maxIterations, opts.coverage.confidenceFloor);

      if (coverageDecision.action === 'loop') {
        await writeAudit(runId, 'coverage_loop', {
          iteration,
          unfilled_slots: coverageDecision.unfilled_required,
        });
      }
    }

    // Step 5: Synthesis Agent
    const synthesisOpts: SynthesisAgentOptions = {
      baseUrl: opts.deepinfra.baseUrl,
      apiKey: opts.deepinfra.apiKey,
      model,
      ...opts.synthesis,
    };
    const synthesisResult = await runSynthesisAgent(runId, brief, synthesisOpts);

    // Step 6: Grounding Gate
    const groundingResult = await runGroundingGate(
      runId,
      synthesisResult.dossier,
      await getSignalsByRunId(runId),
      evidence
    );

    // Step 7: Finalization
    const finalResult = await finalizeRun({
      runId,
      dossier: groundingResult.dossier,
      claimsTotal: groundingResult.claimsTotal,
      claimsVerified: groundingResult.claimsVerified,
      recastGaps: groundingResult.recastGaps,
      brief,
    });

    const latency = performance.now() - start;
    logCompleted(runId, 'pipeline_end_to_end', latency, {
      status: finalResult.status,
      coverage_iterations: iteration,
      evidence_count: evidence.length,
    });

    return {
      runId,
      status: finalResult.status,
      brief,
      evidence,
      signals,
      dossier: groundingResult.dossier,
      claimsTotal: groundingResult.claimsTotal,
      claimsVerified: groundingResult.claimsVerified,
      recastGaps: groundingResult.recastGaps,
      coverageIterations: iteration,
      stoppedBecause: searchResult.stoppedBecause,
    };
  } catch (err) {
    const latency = performance.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    logError(runId, 'pipeline', latency, msg);
    await updateRunStatus(runId, 'failed');
    await writeAudit(runId, 'pipeline_failed', { error: msg });

    return {
      runId,
      status: 'failed',
      brief: { target: { name: request.target_name }, slots: request.slots },
      evidence: [],
      signals: [],
      dossier: { sections: {}, grounding_passed: false },
      claimsTotal: 0,
      claimsVerified: 0,
      recastGaps: 0,
      coverageIterations: 0,
      stoppedBecause: 'error',
    };
  }
}

function hashRequest(request: unknown): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}
