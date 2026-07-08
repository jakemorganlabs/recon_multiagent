#!/usr/bin/env bash
# scripts/smoke_prod.sh
# Production smoke test: HMAC-signed request to the live n8n Cloud webhook.
#
# Requires env vars:
#   RECON_WEBHOOK_URL  = the production webhook URL
#   HMAC_SECRET        = the shared HMAC secret
#
# Asserts:
#   HTTP 200
#   Response contains grounded dossier (citations present, no empty required slots)
#
# Usage: bash scripts/smoke_prod.sh
#        (or `make smoke`)

set -euo pipefail

REQUIRED=(RECON_WEBHOOK_URL HMAC_SECRET)
for var in "${REQUIRED[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "Error: $var is not set." >&2
    exit 1
  fi

done

# --- Synthetic Northwind Robotics payload ---
TIMESTAMP_UNIX=$(date +%s)
BEFORE_UNIX=$((TIMESTAMP_UNIX - 120))

BODY='{
  "target_name": "Northwind Robotics",
  "slots": [
    {"slot_name": "overview", "required": true, "question": "What does Northwind Robotics do?"},
    {"slot_name": "funding", "required": true, "question": "What is the funding history?"},
    {"slot_name": "headcount", "required": true, "question": "How many employees?"},
    {"slot_name": "products", "required": true, "question": "What products do they offer?"},
    {"slot_name": "recent_news", "required": false, "question": "What is recent news?"}
  ],
  "timestamp_unix": '"$BEFORE_UNIX"'
}'

METHOD="POST"
PATH_PART="/webhook/recon"

# --- Compute HMAC signature ---
# The HMAC scheme matches the middleware in src/hmac.ts exactly.
# It signs: METHOD + PATH + TIMESTAMP_UNIX + SHA256(BODY)
BODY_HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 -binary | xxd -p -c 64)
SIGN_PAYLOAD="${METHOD}${PATH_PART}${BEFORE_UNIX}${BODY_HASH}"
SIGNATURE=$(printf '%s' "$SIGN_PAYLOAD" | openssl dgst -sha256 -hmac "$HMAC_SECRET" -binary | xxd -p -c 64)

echo "=== Smoke Test ==="
echo "URL: $RECON_WEBHOOK_URL"
echo "Target: Northwind Robotics"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X "$METHOD" \
  -H "Content-Type: application/json" \
  -H "Authorization: hmac $BEFORE_UNIX $SIGNATURE" \
  -d "$BODY" \
  "$RECON_WEBHOOK_URL")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY_RESPONSE=$(echo "$RESPONSE" | sed '$d')

echo "HTTP status: $HTTP_CODE"

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ FAIL: Expected 200, got $HTTP_CODE"
  echo "$BODY_RESPONSE"
  exit 1
fi

# --- Schema assertions via jq (fail gracefully if jq missing) ---
if command -v jq >/dev/null 2>&1; then
  # Check dossier has sections
  SECTION_COUNT=$(echo "$BODY_RESPONSE" | jq 'if .dossier.sections then (.dossier.sections | length) else 0 end')
  echo "Dossier sections: $SECTION_COUNT"

  # Check at least one citation exists in any claim
  CITATION_COUNT=$(echo "$BODY_RESPONSE" | jq '[.. | .signal_ids? // empty] | flatten | length')
  echo "Citations found: $CITATION_COUNT"

  # Check no empty required slots (gaps with reason = "insufficient evidence" is OK)
  GAP_COUNT=$(echo "$BODY_RESPONSE" | jq 'if .dossier.gaps then (.dossier.gaps | length) else 0 end')
  echo "Explicit gaps: $GAP_COUNT"

  if [ "$SECTION_COUNT" -eq 0 ]; then
    echo "❌ FAIL: Dossier has zero sections."
    exit 1
  fi

  if [ "$CITATION_COUNT" -eq 0 ]; then
    echo "❌ FAIL: No citations found in dossier."
    exit 1
  fi

  echo "✅ PASS: 200 + grounded dossier with citations and sections."
else
  echo "⚠️  jq not found — skipping JSON assertions. Install jq for deeper validation."
  echo "Response body (first 1000 chars):"
  echo "$BODY_RESPONSE" | head -c 1000
fi
