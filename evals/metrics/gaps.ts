/**
 * Metric 4: Gap Correctness
 *
 * Confusion matrix on labeled slots:
 * - TP: system filled a slot that was labeled shouldFill=true
 * - TN: system abstained on a slot labeled shouldFill=false
 * - FP: system filled a slot labeled shouldFill=false (FAR)
 * - FN: system abstained on a slot labeled shouldFill=true (FAR-INV)
 *
 * FAR = FP / (FP + TN)
 * FAR-INV = FN / (FN + TP)
 *
 * No Anthropic code. Pure deterministic counting.
 */

import type { Signal } from '../../src/types.js';

export interface SlotLabel {
  shouldFill: boolean;
}

export function computeGapCorrectness(
  signals: Signal[],
  goldSlotOutcomes: Record<string, SlotLabel>
): { tp: number; tn: number; fp: number; fn: number; far: number; farInv: number } {
  const signalMap = new Map(signals.map((s) => [s.slot, s]));

  let tp = 0, tn = 0, fp = 0, fn = 0;

  for (const [slotName, label] of Object.entries(goldSlotOutcomes)) {
    const sig = signalMap.get(slotName);
    const wasFilled = sig?.status === 'filled';
    const shouldFill = label.shouldFill;

    if (wasFilled && shouldFill) tp++;
    else if (!wasFilled && !shouldFill) tn++;
    else if (wasFilled && !shouldFill) fp++;
    else if (!wasFilled && shouldFill) fn++;
  }

  const far = fp + tn > 0 ? fp / (fp + tn) : 0;
  const farInv = fn + tp > 0 ? fn / (fn + tp) : 0;

  return { tp, tn, fp, fn, far, farInv };
}
