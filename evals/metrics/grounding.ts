/**
 * Metric 3: Grounding Integrity
 *
 * Measures recast_gaps / claims_total averaged across cases.
 * Expected near 0 by construction.
 *
 * No Anthropic code. Pure deterministic math.
 */

export function computeGroundingIntegrity(
  recastGaps: number,
  claimsTotal: number
): { recast: number; total: number; rate: number } {
  if (claimsTotal === 0) {
    return { recast: 0, total: 0, rate: 0 };
  }
  return {
    recast: recastGaps,
    total: claimsTotal,
    rate: recastGaps / claimsTotal,
  };
}
