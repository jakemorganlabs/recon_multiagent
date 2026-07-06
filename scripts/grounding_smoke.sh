#!/usr/bin/env bash
#
# Grounding Gate Smoke Test
#
# Forced grounding failure: intercept a claim with a non-existent evidence_id
# and verify the claim is recast as a gap.
#
# Requires: POSTGRES_URL, DEEPINFRA_BASE_URL, DEEPINFRA_API_KEY, HMAC_SECRET
#
# This script does NOT push to GitHub.

set -euo pipefail

cd "$(dirname "$0")/.."

export HMAC_SECRET="${HMAC_SECRET:-${DEEPINFRA_API_KEY:-test-secret}}"
export PORT="${PORT:-5678}"
export DATABASE_URL="${POSTGRES_URL:-postgresql://localhost:5432/recon_test}"
export DEEPINFRA_BASE_URL="${DEEPINFRA_BASE_URL:-https://api.deepinfra.com/v1/openai}"
export DEEPINFRA_API_KEY="${DEEPINFRA_API_KEY:?Required: set DEEPINFRA_API_KEY env var}"

echo "=== Grounding Gate Smoke Test ==="
echo "This test manually invokes runGroundingGate on a poisoned dossier."
echo ""

# We inline a small Node.js script to call runGroundingGate directly
# since the HTTP endpoint does not yet expose Grounding as a standalone route.
node --input-type=module <<'NODERUN'
import { runGroundingGate } from './src/grounding_gate.js';

const dossier = {
  executive_summary: 'Northwind Robotics smoke test.',
  sections: {
    overview: {
      claims: [
        // This claim is VALID — signal and evidence are real
        { text: 'Northwind Robotics builds warehouse drones.', signal_ids: ['sig-1'] },
        // This claim is POISONED — evidence_id is non-existent → recast as gap
        { text: 'Fake claim with missing evidence.', signal_ids: ['sig-bad'] },
      ],
    },
  },
  grounding_passed: false,
};

const signals = [
  {
    signal_id: 'sig-1',
    slot: 'overview',
    status: 'filled',
    value: 'Northwind Robotics builds warehouse drones.',
    confidence: 0.88,
    rationale: 'Evidence ev-1 describes products.',
    evidence_ids: ['ev-1'],
  },
  {
    signal_id: 'sig-bad',
    slot: 'overview',
    status: 'filled',
    value: 'Fake claim.',
    confidence: 0.1,
    rationale: 'No real evidence.',
    evidence_ids: ['ev-does-not-exist'],
  },
];

const evidence = [
  {
    evidence_id: 'ev-1',
    query: 'warehouse drones',
    source_url: 'https://example.com/northwind',
    page_title: 'Northwind Overview',
    snippet: 'Northwind Robotics builds warehouse drones.',
    fetched_text: 'Northwind Robotics builds warehouse drones.',
    content_hash: 'a'.repeat(64),
    retrieval_rank: 1,
    fetched_at: new Date().toISOString(),
  },
];

const result = await runGroundingGate('run-smoke-g-01', dossier, signals, evidence);

console.log('\n--- Grounding Gate Results ---');
console.log('Claims total:',    result.claimsTotal);
console.log('Claims verified:', result.claimsVerified);
console.log('Recast gaps:',     result.recastGaps);
console.log('Grounding passed:', result.dossier.grounding_passed);

// Verify assertions
if (result.claimsTotal !== 2) {
  console.error('FAIL: expected 2 claims total');
  process.exit(1);
}
if (result.claimsVerified !== 1) {
  console.error('FAIL: expected 1 verified claim (the valid one)');
  process.exit(1);
}
if (result.recastGaps !== 1) {
  console.error('FAIL: expected 1 recast gap (the poisoned claim)');
  process.exit(1);
}

const recastClaim = result.dossier.sections.overview.claims[1];
if (!recastClaim.gap) {
  console.error('FAIL: claim should have gap=true after recast');
  process.exit(1);
}

// Verify the recast claim is preserved in gaps array
if (!result.dossier.gaps?.some(g => g.slot === 'overview')) {
  console.error('FAIL: should have added a gap entry for overview');
  process.exit(1);
}

console.log('\nAll assertions passed. Grounding gate smoke OK.');
NODERUN

echo ""
echo "=== Grounding Smoke Complete ==="
