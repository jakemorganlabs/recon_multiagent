/**
 * Eval Harness Types
 *
 * Shared between eval runner, metrics, and fixtures.
 *
 */

import type { Brief, EvidenceItem, Signal, Dossier } from '../src/types.js';

export type EvalCategory = 'rich' | 'thin' | 'empty' | 'adversarial';

export interface EvalCase {
  /** Unique case identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Category */
  category: EvalCategory;
  /** Input request to the pipeline */
  request: {
    target_name: string;
    slots: Brief['slots'];
  };
  /** Expected brief target properties */
  expectedBrief?: {
    target?: { name?: string; website?: string };
  };
  /**
   * Gold source URLs: evidence recall@k metric checks if any
   * of these appear in the top-k retrieved results.
   */
  gold_sources?: string[];
  /**
   * Gold slot outcomes: for gap correctness metric.
   * Keys are slot names; values are whether the slot should be filled.
   */
  gold_slot_outcomes?: Record<string, { should_fill: boolean; min_confidence?: number }>;
  /**
   * For adversarial cases: the malicious content that was injected
   * into a cassette fetch. The injection metric checks that this
   * content never became an obeyed instruction in the dossier.
   */
  adversarial_payload?: {
    injectedText: string;
    expectedBehavior: string;
  };
  /** Expected pipeline status */
  expected_status?: 'complete' | 'gapped' | 'insufficient' | 'failed';
}

export interface EvalCaseResult {
  caseId: string;
  category: EvalCategory;
  runId: string;
  pipelineStatus: string;
  error?: string;
  evidence: EvidenceItem[];
  signals: Signal[];
  dossier: Dossier;
  metrics: Partial<MetricResults>;
  /** Raw latency in ms */
  latencyMs: number;
}

export interface MetricResults {
  /** Metric 1: evidence recall@k */
  recallAtK: { numerator: number; denominator: number; value: number };
  /** Metric 2: structural validity — per-agent pass rates */
  structuralValidity: {
    brief: number;
    analyst: number;
    synthesis: number;
    overall: number;
  };
  /** Metric 3: grounding integrity — recast rate */
  groundingIntegrity: { recast: number; total: number; rate: number };
  /** Metric 4: gap correctness — confusion matrix */
  gapCorrectness: {
    tp: number; // filled-should-fill
    tn: number; // abstained-should-abstain
    fp: number; // filled-should-abstain (FAR)
    fn: number; // abstained-should-fill (FAR-INV)
    far: number; // FP / (FP + TN)
    farInv: number; // FN / (FN + TP)
  };
  /** Metric 5: injection resistance */
  injectionResistance: {
    adversarialCases: number;
    obeyedInstructions: number;
    rate: number;
  };
}

export interface ThresholdConfig {
  recallAtK: { min: number };
  structuralValidity: { min: number };
  groundingIntegrity: { max: number };
  gapCorrectness: { farMax: number; farInvMax: number };
  injectionResistance: { maxObeyed: number };
}
