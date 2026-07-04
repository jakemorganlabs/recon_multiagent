#!/usr/bin/env bash
#
# Smoke test for Session S02 — Brief & Shared State
# Three cases: happy path, idempotency, clarification.
#
# Requires: curl, DATABASE_URL, HMAC_SECRET, DEEPINFRA_API_KEY set in environment.
#
set -euo pipefail

API_URL="${API_URL:-http://localhost:5678/webhook/recon-request}"
HMAC_SECRET="${HMAC_SECRET:-default-secret-32-bytes-long!!!}"
SECRET="$HMAC_SECRET"

if ! command -v curl >/dev/null 2>&1; then
  echo "FAIL: curl is required"
  exit 1
fi

# ---- helpers ----

function build_auth() {
  local method="$1"
  local path="$2"
  local body="$3"
  local ts
  ts="$(date +%s)"
  local body_hash
  body_hash="$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$SECRET" -binary | xxd -p -c 64)"
  local canonical_path
  canonical_path="$(echo "$path" | sed 's|//*|/|g; s|/+$||')"
  canonical_path="${canonical_path:-/}"
  local data="${ts}.${method^^}.${canonical_path}.${body_hash}"
  local sig
  sig="$(printf '%s' "$data" | openssl dgst -sha256 -hmac "$SECRET" -binary | xxd -p -c 64)"
  echo "HMAC ${ts}:${sig}"
}

function post() {
  local body="$1"
  local auth
  auth="$(build_auth POST /api/request "$body")"
  curl -s -X POST "$API_URL" \
    -H "Authorization: $auth" \
    -H "Content-Type: application/json" \
    -d "$body"
}

# ---- case 1: happy path ----

echo "CASE 1: Happy path (Northwind Robotics)"
BODY='{"target":"Northwind Robotics","focus":["overview","funding"]}'
RESPONSE1="$(post "$BODY")"
STATUS1="$(echo "$RESPONSE1" | jq -r '.status // .body.status // "unknown"' || echo "unknown")"
RUN_ID1="$(echo "$RESPONSE1" | jq -r '.run_id // .body.run_id // "null"' || echo "null")"

if [ "$STATUS1" != "completed" ] && [ "$STATUS1" != "running" ]; then
  echo "FAIL: Expected status 'completed' or 'running', got '$STATUS1'"
  echo "Full response: $RESPONSE1"
  exit 1
fi
echo "PASS: happy path returned status='$STATUS1' run_id='$RUN_ID1'"

# ---- case 2: idempotency ----

echo "CASE 2: Idempotency (same request twice)"
RESPONSE2="$(post "$BODY")"
STATUS2="$(echo "$RESPONSE2" | jq -r '.status // .body.status // "unknown"' || echo "unknown")"
RUN_ID2="$(echo "$RESPONSE2" | jq -r '.run_id // .body.run_id // "null"' || echo "null")"

if [ "$STATUS2" != "existing" ]; then
  echo "FAIL: Expected status 'existing' on duplicate, got '$STATUS2'"
  echo "Full response: $RESPONSE2"
  exit 1
fi

if [ "$RUN_ID1" != "$RUN_ID2" ]; then
  echo "FAIL: Idempotency violation — run_id mismatch ($RUN_ID1 vs $RUN_ID2)"
  exit 1
fi
echo "PASS: duplicate request returned same run_id='$RUN_ID2'"

# ---- case 3: clarification ----

echo "CASE 3: Clarification (ambiguous target)"
BODY3='{"target":"Apple"}'
RESPONSE3="$(post "$BODY3")"
STATUS3="$(echo "$RESPONSE3" | jq -r '.status // .body.status // "unknown"' || echo "unknown")"

if [ "$STATUS3" != "clarify" ]; then
  echo "FAIL: Expected status 'clarify', got '$STATUS3'"
  echo "Full response: $RESPONSE3"
  exit 1
fi
echo "PASS: ambiguous target returned status='$STATUS3'"

echo ""
echo "SMOKE SUMMARY: all cases passed."
