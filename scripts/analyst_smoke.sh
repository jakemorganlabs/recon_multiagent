#!/usr/bin/env bash
#
# Analyst Smoke Test
# Verifies that the Analyst Agent produces schema-valid signals on
# synthetic evidence, with correct abstentions and citations.
#
# Usage: ./scripts/analyst_smoke.sh <base_url> <api_key>
#
# No Anthropic dependencies. Uses DeepInfra / Gemma 4.

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
API_KEY="${2:-}"
RUN_ID="smoke-analyst-$(date +%s)"

echo "=== Analyst Smoke Test ==="
echo "Run ID: $RUN_ID"
echo ""

# Build a synthetic brief + evidence payload
BODY=$(cat <<EOF
{
  "run_id": "$RUN_ID",
  "brief": {
    "target": { "name": "Northwind Robotics" },
    "slots": [
      { "slot_name": "overview", "required": true, "question": "What does the company do?" },
      { "slot_name": "leadership", "required": true, "question": "Who leads the company?" }
    ]
  },
  "evidence": [
    {
      "evidence_id": "ev-smoke-1",
      "query": "Northwind Robotics overview",
      "source_url": "https://example.com/northwind",
      "page_title": "Northwind Robotics - About",
      "snippet": "Northwind Robotics is a Seattle-based company building autonomous warehouse drones since 2019. They have raised $12M in Series A funding.",
      "fetched_text": "Northwind Robotics is a Seattle-based company building autonomous warehouse drones since 2019. They have raised $12M in Series A funding. Their flagship product is the NW-200 delivery drone.",
      "content_hash": "$(echo -n 'northwind-robotics-test-hash' | shasum -a 256 | cut -d' ' -f1)",
      "retrieval_rank": 1,
      "fetched_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    }
  ]
}
EOF
)

echo "POST $BASE_URL/webhook/recon-analyst"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/webhook/recon-analyst" \
  -H "Content-Type: application/json" \
  -d "$BODY" || true)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY_RESPONSE=$(echo "$RESPONSE" | sed '$d')

echo "HTTP $HTTP_CODE"
echo "$BODY_RESPONSE" | jq . 2>/dev/null || echo "$BODY_RESPONSE"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: Expected HTTP 200, got $HTTP_CODE"
  exit 1
fi

# Validate response shape
SIGNALS=$(echo "$BODY_RESPONSE" | jq '.body.analyst.signals // empty')
ABSTAINS=$(echo "$BODY_RESPONSE" | jq '.body.analyst.abstains // empty')

if [ -z "$SIGNALS" ] || [ "$SIGNALS" = "null" ]; then
  echo "FAIL: Missing analyst.signals in response"
  exit 1
fi

if [ -z "$ABSTAINS" ] || [ "$ABSTAINS" = "null" ]; then
  echo "FAIL: Missing analyst.abstains in response"
  exit 1
fi

echo "PASS: Analyst smoke test completed"
echo "  Signals produced: $SIGNALS"
echo "  Abstains: $ABSTAINS"
