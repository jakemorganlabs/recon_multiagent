/**
 * Grounding Gate
 *
 * Deterministic gatekeeper after Synthesis.
 * For each claim in the dossier, calls verifyDossier from citation_verifier.ts
 * to check the three-hop chain:
 *   1. Cited signal_id exists and is non-abstaining.
 *   2. Cited evidence_id exists in the evidence set.
 *   3. Normalized snippet present in evidence text.
 *
 * On any failure, the claim is recast as a gap note (not dropped), keeping the
 * dossier's structural shape intact. The run status is determined externally
 * based on the ratio of verified claims to total claims.
 *
 *
 */

import { verifyDossier } from './citation_verifier.js';
import type { Dossier, Signal, EvidenceItem, DossierClaim } from './types.js';
import { writeAudit } from './db.js';
import { logCompleted, logError } from './log.js';

export interface GroundingGateResult {
  dossier: Dossier;
  /**
   * Per-claim verification results for audit/debug.
   */
  verifications: {
    claim_text: string;
    verified: boolean;
    reason?: string;
  }[];
  /** Total number of claims before processing */
  claimsTotal: number;
  /** Number of claims that passed verification */
  claimsVerified: number;
  /** Number of claims recast as gaps */
  recastGaps: number;
}

/**
 * Run the deterministic grounding gate over a dossier.
 *
 * Flow:
 * 1. Verify every claim in the dossier via verifyDossier.
 * 2. For failed claims, transform claim → gap note, keeping section shape.
 * 3. Return updated dossier with grounding_passed set.
 * 4. Return counts for status determination.
 */
export async function runGroundingGate(
  runId: string,
  dossier: Dossier,
  signals: Signal[],
  evidence: EvidenceItem[]
): Promise<GroundingGateResult> {
  const start = performance.now();

  await writeAudit(runId, 'grounding_gate_start', {
    section_count: Object.keys(dossier.sections).length,
  });

  try {
    // 1. Run the deterministic verifier
    const verifications = verifyDossier(dossier, signals, evidence);

    // 2. Build verification map keyed by claim text for quick lookup
    const verifMap = new Map(
      verifications.map((v) => [v.claim_text, v])
    );

    // 3. Process each section: recast failed claims as gap notes
    const updatedSections: Dossier['sections'] = {};
    let recastCount = 0;
    let verifiedCount = 0;

    for (const [slotName, section] of Object.entries(dossier.sections)) {
      const updatedClaims: DossierClaim[] = [];

      for (const claim of section.claims) {
        const v = verifMap.get(claim.text);
        if (v && v.verified) {
          verifiedCount++;
          updatedClaims.push(claim);
        } else {
          recastCount++;
          // Transform claim into a gap note
          updatedClaims.push({
            text: `Could not verify ${slotName}: ${v?.reason ?? 'Grounding check failed.'}`,
            signal_ids: [],
            gap: true,
          });
        }
      }

      updatedSections[slotName] = {
        ...section,
        claims: updatedClaims,
      };
    }

    // 4. Build updated dossier with all existing gaps preserved + any new ones added
    const updatedGaps = [...(dossier.gaps ?? [])];
    for (const [slotName, section] of Object.entries(updatedSections)) {
      for (const claim of section.claims) {
        if (claim.gap) {
          // Avoid duplicating exact gap entries
          const alreadyExists = updatedGaps.some(
            (g) => g.slot === slotName && g.reason === claim.text
          );
          if (!alreadyExists) {
            updatedGaps.push({ slot: slotName, reason: claim.text });
          }
        }
      }
    }

    const allClaimsCount = verifiedCount + recastCount; // same as total verifications
    const groundingPassed = recastCount === 0;

    const updatedDossier: Dossier = {
      ...dossier,
      sections: updatedSections,
      gaps: updatedGaps,
      grounding_passed: groundingPassed,
    };

    const latency = performance.now() - start;
    logCompleted(runId, 'grounding_gate', latency, {
      claims_total: allClaimsCount,
      claims_verified: verifiedCount,
      recast_gaps: recastCount,
      grounding_passed: groundingPassed,
    });

    await writeAudit(runId, 'grounding_gate_complete', {
      claims_total: allClaimsCount,
      claims_verified: verifiedCount,
      recast_gaps: recastCount,
      grounding_passed: groundingPassed,
    });

    return {
      dossier: updatedDossier,
      verifications: verifications.map((v) => ({
        claim_text: v.claim_text,
        verified: v.verified,
        reason: v.reason,
      })),
      claimsTotal: allClaimsCount,
      claimsVerified: verifiedCount,
      recastGaps: recastCount,
    };
  } catch (err) {
    const latency = performance.now() - start;
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(runId, 'grounding_gate', latency, errorMsg);
    await writeAudit(runId, 'grounding_gate_failed', { error: errorMsg });

    // Return original dossier but mark grounding as failed
    return {
      dossier: { ...dossier, grounding_passed: false },
      verifications: [],
      claimsTotal: 0,
      claimsVerified: 0,
      recastGaps: 0,
    };
  }
}
