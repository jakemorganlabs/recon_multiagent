/**
 * Citation Chain Verifier
 *
 * Pure function: given a dossier, signals, and evidence,
 * deterministically returns per-claim { verified, recast_as_gap, reason }.
 *
 * Three hops checked in order:
 * 1. Every cited signal_id exists and is non-abstaining (status !== 'abstain').
 * 2. Every cited signal's evidence_ids exist in the evidence set.
 * 3. The claim's normalized snippet is present (whitespace-normalized) in that
 *    evidence item's normalized text.
 *
 * On any failure, returns { verified: false, recast_as_gap: true, reason }.
 */

import { normalizeSnippet } from './normalize.js';
import type { Dossier, Signal, EvidenceItem, DossierClaim } from './types.js';

export interface ClaimVerification {
  claim_text: string;
  verified: boolean;
  recast_as_gap: boolean;
  reason?: string;
}

/**
 * Verify every claim in every section of the dossier.
 */
export function verifyDossier(
  dossier: Dossier,
  signals: Signal[],
  evidence: EvidenceItem[]
): ClaimVerification[] {
  const signalMap = new Map(signals.map((s) => [s.signal_id, s]));
  const evidenceMap = new Map(evidence.map((e) => [e.evidence_id, e]));

  const results: ClaimVerification[] = [];

  for (const [slotName, section] of Object.entries(dossier.sections)) {
    for (const claim of section.claims) {
      const result = verifyClaim(claim, slotName, signalMap, evidenceMap);
      results.push(result);
    }
  }

  return results;
}

function verifyClaim(
  claim: DossierClaim,
  slotName: string,
  signalMap: Map<string, Signal>,
  evidenceMap: Map<string, EvidenceItem>
): ClaimVerification {
  // Hop 1: cited signal_ids exist and are non-abstaining
  for (const signalId of claim.signal_ids) {
    const signal = signalMap.get(signalId);
    if (!signal) {
      return {
        claim_text: claim.text,
        verified: false,
        recast_as_gap: true,
        reason: `Signal "${signalId}" cited in slot "${slotName}" does not exist.`,
      };
    }
    if (signal.status === 'abstain') {
      return {
        claim_text: claim.text,
        verified: false,
        recast_as_gap: true,
        reason: `Signal "${signalId}" in slot "${slotName}" is abstaining and cannot be cited.`,
      };
    }

    // Hop 2: every evidence_id in the signal exists in the evidence set
    for (const evidenceId of signal.evidence_ids) {
      const ev = evidenceMap.get(evidenceId);
      if (!ev) {
        return {
          claim_text: claim.text,
          verified: false,
          recast_as_gap: true,
          reason: `Evidence "${evidenceId}" cited by signal "${signalId}" in slot "${slotName}" does not exist.`,
        };
      }

      // Hop 3: normalize(snippet) ∈ normalize(evidence_text or snippet)
      const evidenceText = ev.fetched_text ?? ev.snippet;
      const normalizedEvidence = normalizeSnippet(evidenceText);
      const normalizedSnippet = normalizeSnippet(ev.snippet);
      if (!normalizedEvidence.includes(normalizedSnippet)) {
        return {
          claim_text: claim.text,
          verified: false,
          recast_as_gap: true,
          reason: `Snippet for evidence "${evidenceId}" not found in its recorded text (signal "${signalId}", slot "${slotName}").`,
        };
      }
    }
  }

  return {
    claim_text: claim.text,
    verified: true,
    recast_as_gap: false,
  };
}
