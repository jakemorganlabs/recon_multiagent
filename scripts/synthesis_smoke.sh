#!/usr/bin/env bash
#
# Synthesis Smoke Test
#
# End-to-end happy path for the Synthesis Agent.
# Requires a local server running (npm run dev, or built dist/server.js)
# and a DeepInfra API key.
#
# Usage:
#   ./scripts/synthesis_smoke.sh
#
# Expects:
#   - POSTGRES_URL
#   - DEEPINFRA_BASE_URL
#   - DEEPINFRA_API_KEY
#   - HMAC_SECRET
#
# This script does NOT push to GitHub.

set -euo pipefail

cd "$(dirname "$0")/.."

export HMAC_SECRET="${HMAC_SECRET:-${DEEPINFRA_API_KEY:-test-secret}}"
export PORT="${PORT:-5678}"
export DATABASE_URL="${POSTGRES_URL:-postgresql://localhost:5432/recon_test}"
export DEEPINFRA_BASE_URL="${DEEPINFRA_BASE_URL:-https://api.deepinfra.com/v1/openai}"
export DEEPINFRA_API_KEY="${DEEPINFRA_API_KEY:?Required: set DEEPINFRA_API_KEY env var}"

echo "=== Synthesis Smoke Test ==="
echo "Target: Northwind Robotics synthetic"
echo "Model: google/gemma-4-26B-A4B-it via DeepInfra"
echo ""

# Build a Brief with slots that the Analyst already processed
TARGET='{"name":"Northwind Robotics","website":"https://northwind.example.com"}'
SLOTS='[{"slot_name":"overview","required":true,"question":"What is this company?"},{"slot_name":"leadership","required":false,"question":"Who leads it?"}]'

REQUEST_BODY=$(cat <<EOF
{
  "target": $TARGET,
  "slots": $SLOTS
}
EOF
)

# Derive an HMAC for this request (the server verifies HMAC)
# For simplicity, we use a dummy auth header here; in a real test you'd compute the HMAC.
# The handler.ts expects an Authorization header matching computeHmac(body).
compute_hmac() {
  echo -n "$1" | openssl dgst -sha256 -hmac "$HMAC_SECRET" | sed 's/^.* //'
}

AUTH=$(compute_hmac "$REQUEST_BODY")

RESPONSE=$(curl -sS -X POST "http://localhost:${PORT}/api/request" \
  -H "Content-Type: application/json" \
  -H "Authorization: bearer ${AUTH}" \
  -d "$REQUEST_BODY" || true)

echo "Brief response:"
echo "$RESPONSE" | jq . || echo "$RESPONSE"

echo ""
echo "Synthesis smoke complete — inspect the response JSON for brief completeness."
echo "This is a structural smoke; full end-to-end requires signals in shared state."
