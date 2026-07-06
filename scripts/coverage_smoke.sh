#!/usr/bin/env bash
#
# Coverage Loop Smoke Test
# Verifies the deterministic coverage controller with a thin-slot scenario:
# 1. First pass: Analyst abstains on leadership → coverage loops
# 2. Second pass: Analyst fills leadership → coverage proceeds
# 3. Hard cap prevents third loop
#
# No Anthropic dependencies. Pure deterministic orchestration.

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
API_KEY="${2:-}"

echo "=== Coverage Loop Smoke Test ==="
echo ""

# --- Pass 1: Simulate scenario where leadership is thin ---
RUN_ID="smoke-cov-$(date +%s)"
BODY_PASS1=$(cat <<EOF
{
  "run_id": "$RUN_ID",
  "brief": {
    "target": { "name": "Northwind Robotics" },
    "slots": [
      { "slot_name": "overview", "required": true, "question": "What does the company do?" },
      { "slot_name": "leadership", "required": true, "question": "Who leads the company?" }
    ]
  },
  "iteration": 0,
  "signals": [
    { "signal_id": "sig-1", "slot": "overview", "status": "filled", "value": "Drone company.", "confidence": 0.9, "evidence_ids": ["ev-1"] },
    { "signal_id": "sig-2", "slot": "leadership", "status": "insufficient_evidence", "evidence_ids": [] }
  ]
}
EOF
)

echo "--- Pass 1: Thin slot scenario (iteration=0) ---"
RESPONSE1=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/webhook/recon-analyst" \
  -H "Content-Type: application/json" \
  -d "$BODY_PASS1" || true)

HTTP_CODE1=$(echo "$RESPONSE1" | tail -n1)
BODY1=$(echo "$RESPONSE1" | sed '$d')

echo "HTTP $HTTP_CODE1"
ACTION1=$(echo "$BODY1" | jq -r '.body.coverage.action // empty')
echo "Coverage action: $ACTION1"

if [ "$ACTION1" != "loop" ]; then
  echo "FAIL: Expected action='loop' on pass 1, got '$ACTION1'"
  exit 1
fi

# --- Pass 2: Now leadership is filled ---
BODY_PASS2=$(cat <<EOF
{
  "run_id": "$RUN_ID",
  "brief": {
    "target": { "name": "Northwind Robotics" },
    "slots": [
      { "slot_name": "overview", "required": true, "question": "What does the company do?" },
      { "slot_name": "leadership", "required": true, "question": "Who leads the company?" }
    ]
  },
  "iteration": 1,
  "signals": [
    { "signal_id": "sig-1", "slot": "overview", "status": "filled", "value": "Drone company.", "confidence": 0.9, "evidence_ids": ["ev-1"] },
    { "signal_id": "sig-3", "slot": "leadership", "status": "filled", "value": "CEO is Jane Doe.", "confidence": 0.75, "evidence_ids": ["ev-2"] }
  ]
}
EOF
)

echo ""
echo "--- Pass 2: Slots filled (iteration=1) ---"
RESPONSE2=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/webhook/recon-analyst" \
  -H "Content-Type: application/json" \
  -d "$BODY_PASS2" || true)

HTTP_CODE2=$(echo "$RESPONSE2" | tail -n1)
BODY2=$(echo "$RESPONSE2" | sed '$d')

ACTION2=$(echo "$BODY2" | jq -r '.body.coverage.action // empty')
echo "Coverage action: $ACTION2"

if [ "$ACTION2" != "proceed" ]; then
  echo "FAIL: Expected action='proceed' on pass 2, got '$ACTION2'"
  exit 1
fi

# --- Pass 3: Hard cap test (unfillable slot, iteration at cap) ---
RUN_ID_2="smoke-cap-$(date +%s)"
BODY_PASS3=$(cat <<EOF
{
  "run_id": "$RUN_ID_2",
  "brief": {
    "target": { "name": "Northwind Robotics" },
    "slots": [
      { "slot_name": "overview", "required": true, "question": "What does the company do?" }
    ]
  },
  "iteration": 2,
  "signals": [
    { "signal_id": "sig-1", "slot": "overview", "status": "insufficient_evidence", "evidence_ids": [] }
  ]
}
EOF
)

echo ""
echo "--- Pass 3: Hard cap (iteration=2, cap=2, unfilled slot) ---"
RESPONSE3=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/webhook/recon-analyst" \
  -H "Content-Type: application/json" \
  -d "$BODY_PASS3" || true)

HTTP_CODE3=$(echo "$RESPONSE3" | tail -n1)
BODY3=$(echo "$RESPONSE3" | sed '$d')

ACTION3=$(echo "$BODY3" | jq -r '.body.coverage.action // empty')
echo "Coverage action: $ACTION3"

if [ "$ACTION3" != "proceed" ]; then
  echo "FAIL: Expected action='proceed' at hard cap, got '$ACTION3'"
  exit 1
fi

echo ""
echo "PASS: All coverage loop smoke tests passed"
echo "  Pass 1: loop (thin slot, iteration < cap)"
echo "  Pass 2: proceed (filled, iteration < cap)"
echo "  Pass 3: proceed (hard cap reached)"
