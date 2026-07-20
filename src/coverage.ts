/**
 * Coverage Decision
 *
 * (a) Responsibility: decides whether to continue the coverage loop or proceed
 *     to the Synthesis Agent, based on the current set of signals and the
 *     brief's required slots.
 * (b) Invariant: the only loop counter is held here. It decrements from
 *     config.budgets.max_iterations toward zero. The model never decides
 *     when to stop. This function does.
 * (c) Deliberately does NOT: call any model, write to the DB, or modify
 *     evidence. Pure function over (brief, signals, iteration).
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
