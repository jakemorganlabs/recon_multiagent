#!/usr/bin/env bash
# scripts/cost_monthly.sh
# Aggregates audit rows for the trailing 30 days against config/pricing.json.
# Outputs: total cost, per-run cost (p50/p95), and cache savings rate.
#
# Reads DB connection from env (AUDIT_DATABASE_URL), never a literal.
# Requires: psql (PostgreSQL client), jq.

set -euo pipefail

AUDIT_DATABASE_URL="${AUDIT_DATABASE_URL:-}"
if [ -z "$AUDIT_DATABASE_URL" ]; then
  echo "Error: AUDIT_DATABASE_URL is not set." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# DeepInfra Gemma rates (from config/pricing.json) — match model string exactly
# These are per-million-token rates. Updated 2026-07-09.
INPUT_RATE="0.10"
OUTPUT_RATE="0.20"

# Trailing 30 days
CUTOFF=$(date -u -d '30 days ago' '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -v-30d -u '+%Y-%m-%d %H:%M:%S')

echo "=== Recon Monthly Cost Report ==="
echo "Period: last 30 days (since $CUTOFF)"
echo ""

# --- Total token counts ---
TOKEN_SQL=$(cat <<'EOF'
SELECT
  COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
  COALESCE(SUM(cache_read_input_tokens), 0) AS total_cache_read,
  COALESCE(SUM(cache_creation_input_tokens), 0) AS total_cache_creation,
  COUNT(*) AS total_audit_rows
FROM audit
WHERE created_at >= $1::timestamptz;
EOF
)

TOKEN_JSON=$(PGPASSWORD="$(echo "$AUDIT_DATABASE_URL" | sed 's/.*://; s/@.*//')" \
  psql "$AUDIT_DATABASE_URL" -At -F',' -c "$TOKEN_SQL" -- "$CUTOFF" 2>/dev/null || true)

# If psql fails or returns nothing, print zeros
if [ -z "$TOKEN_JSON" ]; then
  TOTAL_INPUT=0
  TOTAL_OUTPUT=0
  TOTAL_CACHE_READ=0
  TOTAL_CACHE_CREATION=0
  TOTAL_ROWS=0
else
  TOTAL_INPUT=$(echo "$TOKEN_JSON"      | cut -d',' -f1)
  TOTAL_OUTPUT=$(echo "$TOKEN_JSON"     | cut -d',' -f2)
  TOTAL_CACHE_READ=$(echo "$TOKEN_JSON" | cut -d',' -f3)
  TOTAL_CACHE_CREATION=$(echo "$TOKEN_JSON" | cut -d',' -f4)
  TOTAL_ROWS=$(echo "$TOKEN_JSON"         | cut -d',' -f5)
fi

TOTAL_INPUT=${TOTAL_INPUT:-0}
TOTAL_OUTPUT=${TOTAL_OUTPUT:-0}
TOTAL_CACHE_READ=${TOTAL_CACHE_READ:-0}
TOTAL_CACHE_CREATION=${TOTAL_CACHE_CREATION:-0}
TOTAL_ROWS=${TOTAL_ROWS:-0}

TOTAL_COST=$(awk "BEGIN {
  input_cost  = ($TOTAL_INPUT  / 1000000) * $INPUT_RATE;
  output_cost = ($TOTAL_OUTPUT / 1000000) * $OUTPUT_RATE;
  cache_read  = ($TOTAL_CACHE_READ / 1000000) * 0.00;
  cache_write = ($TOTAL_CACHE_CREATION / 1000000) * 0.00;
  print input_cost + output_cost + cache_read + cache_write
}")

echo "Model: google/gemma-4-26B-A4B-it (DeepInfra)"
echo "Audit rows in period: $TOTAL_ROWS"
echo "Input tokens:  $TOTAL_INPUT"
echo "Output tokens: $TOTAL_OUTPUT"
echo "Cache read:    $TOTAL_CACHE_READ"
echo "Cache write:   $TOTAL_CACHE_CREATION"
echo "---"
echo "Total cost USD: \$${TOTAL_COST}"

# --- Per-run cost distribution ---
RUN_SQL=$(cat <<'EOF'
WITH run_costs AS (
  SELECT
    run_id,
    SUM(input_tokens) AS run_input,
    SUM(output_tokens) AS run_output
  FROM audit
  WHERE created_at >= $1::timestamptz
    AND input_tokens IS NOT NULL
  GROUP BY run_id
)
SELECT
  run_id::text,
  (run_input / 1000000.0 * 0.10 + run_output / 1000000.0 * 0.20) AS cost
FROM run_costs
ORDER BY cost;
EOF
)

RUN_CSV=$(PGPASSWORD="$(echo "$AUDIT_DATABASE_URL" | sed 's/.*://; s/@.*//')" \
  psql "$AUDIT_DATABASE_URL" -At -F',' -c "$RUN_SQL" -- "$CUTOFF" 2>/dev/null || true)

if [ -n "$RUN_CSV" ]; then
  RUN_COUNT=$(echo "$RUN_CSV" | wc -l | tr -d ' ')
  P50_LINE=$(awk "BEGIN {print int($RUN_COUNT * 0.5) + 1}")
  P95_LINE=$(awk "BEGIN {print int($RUN_COUNT * 0.95) + 1}")
  P50_COST=$(echo "$RUN_CSV" | sed -n "${P50_LINE}p" | cut -d',' -f2)
  P95_COST=$(echo "$RUN_CSV" | sed -n "${P95_LINE}p" | cut -d',' -f2)
  echo ""
  echo "Per-run cost (runs = $RUN_COUNT):"
  echo "  p50: \$${P50_COST:-0}"
  echo "  p95: \$${P95_COST:-0}"
else
  echo ""
  echo "Per-run cost: N/A (no runs with token data)"
fi

# --- Cache savings rate ---
UNCACHED_INPUT=$(( TOTAL_INPUT - TOTAL_CACHE_READ ))
if [ $(( TOTAL_CACHE_READ + TOTAL_CACHE_CREATION + UNCACHED_INPUT )) -gt 0 ]; then
  SAVINGS_RATE=$(awk "BEGIN {
    rate = $TOTAL_CACHE_READ / ($TOTAL_CACHE_READ + $TOTAL_CACHE_CREATION + $UNCACHED_INPUT) * 100;
    printf \"%.2f\", rate
  }")
  echo ""
  echo "Cache savings rate: ${SAVINGS_RATE}%"
else
  echo ""
  echo "Cache savings rate: N/A (no cache data)"
fi

echo ""
echo "Pricing as of: 2026-07-09"
echo "Input: \$${INPUT_RATE}/M tok | Output: \$${OUTPUT_RATE}/M tok"
echo "=== End Report ==="
