/**
 * Coverage Decision
 *
 * Pure function over the brief + current signal set.
 * Returns { action: 'loop' | 'proceed', unfilled_required: string[], iteration: number }.
 *
 * Logic:
 * - Count signals whose status is 'insufficient_evidence' OR confidence < floor
 *   for slots marked required:true.
 * - If any unfilled required slot exists AND iteration < cap → action:'loop'
 *   with the unfilled slot names.
 * - Otherwise → action:'proceed'.
 */

import type { Brief, Signal } from './types.js';

export interface CoverageDecision {
  action: 'loop' | 'proceed';
  unfilled_required: string[];
  iteration: number;
}

export function decideCoverage(
  brief: Brief,
  signals: Signal[],
  iteration: number,
  cap: number,
  confidenceFloor: number
): CoverageDecision {
  const requiredSlots = brief.slots
    .filter((s) => s.required)
    .map((s) => s.slot_name);

  const signalMap = new Map(signals.map((s) => [s.slot, s]));

  const unfilled: string[] = [];

  for (const slotName of requiredSlots) {
    const signal = signalMap.get(slotName);
    if (!signal) {
      unfilled.push(slotName);
      continue;
    }
    if (signal.status === 'insufficient_evidence') {
      unfilled.push(slotName);
      continue;
    }
    if (signal.status === 'abstain') {
      unfilled.push(slotName);
      continue;
    }
    if (
      signal.status === 'filled' &&
      (signal.confidence === undefined || signal.confidence < confidenceFloor)
    ) {
      unfilled.push(slotName);
    }
  }

  if (unfilled.length > 0 && iteration < cap) {
    return { action: 'loop', unfilled_required: unfilled, iteration };
  }

  return { action: 'proceed', unfilled_required: unfilled, iteration };
}
