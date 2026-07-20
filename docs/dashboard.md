# Dashboard build sheet (Metabase over Postgres)

For each widget below, paste the SQL into a Metabase Native Query question, set the visualization type, and place it on the dashboard.

## Database

Connect Metabase to the same Postgres the audit / shared-state DB lives on. If n8n Cloud's internal Postgres is not directly queryable, the operator provisions an external Postgres as the audit DB.

## Indexes (required before dashboard queries)

```sql
-- Migration 010 adds these indexes automatically via migrations/010_audit_cost_columns.sql
-- Reproduced here for operator reference:

CREATE INDEX IF NOT EXISTS idx_audit_created_at_status
  ON audit (created_at DESC, (payload->>'status'));

CREATE INDEX IF NOT EXISTS idx_audit_slot_name
  ON audit ((payload->>'slot_name'));
```

## Widget 1: Runs over time + status mix

```sql
SELECT
  DATE_TRUNC('day', r.created_at) AS day,
  r.status,
  COUNT(*) AS run_count
FROM run r
WHERE r.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

Visualization: line or bar, grouped by status.

Alert threshold: `failed` runs > 5% of total daily volume. Notify operator.

## Widget 2: Gap rate per slot

```sql
WITH slot_fills AS (
  SELECT
    s.slot,
    COUNT(*) FILTER (WHERE s.status = 'filled') AS filled_count,
    COUNT(*) AS total_count
  FROM signal s
  JOIN run r ON s.run_id = r.id
  WHERE r.created_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY s.slot
)
SELECT
  slot,
  total_count - filled_count AS gap_count,
  ROUND(100.0 * (total_count - filled_count) / NULLIF(total_count, 0), 2) AS gap_rate_pct
FROM slot_fills
ORDER BY gap_rate_pct DESC;
```

Visualization: bar chart.

Alert threshold: any slot gap rate > 40%. Investigate slot question clarity.

## Widget 3: Coverage iteration rate

```sql
SELECT
  r.coverage_iterations,
  COUNT(*) AS run_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct_of_runs
FROM run r
WHERE r.created_at >= CURRENT_DATE - INTERVAL '30 days'
  AND r.coverage_iterations IS NOT NULL
GROUP BY r.coverage_iterations
ORDER BY r.coverage_iterations;
```

Visualization: pie or bar.

Alert threshold: more than 30% of runs hit max_iterations (3). Tune the coverage confidence_floor.

## Widget 4: Evidence and fetch volume per run

```sql
SELECT
  r.id AS run_id,
  r.target_name,
  COUNT(e.evidence_id) FILTER (WHERE e.fetched_text IS NOT NULL) AS fetches,
  COUNT(e.evidence_id) AS evidence_total,
  ROUND(AVG(e.retrieval_rank), 2) AS avg_retrieval_rank
FROM run r
LEFT JOIN evidence e ON e.run_id = r.id
WHERE r.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY r.id, r.target_name
ORDER BY evidence_total DESC
LIMIT 50;
```

Visualization: table.

Alert threshold: any run with 0 fetches but `status = 'complete'`. Flag as a potential grounding failure.

## Widget 5: Grounding recast rate

```sql
SELECT
  DATE_TRUNC('day', r.created_at) AS day,
  COUNT(*) FILTER (WHERE d.grounding_passed = false) AS recast_count,
  COUNT(*) AS total_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE d.grounding_passed = false) / NULLIF(COUNT(*), 0), 2) AS recast_rate_pct
FROM run r
JOIN dossier d ON d.run_id = r.id
WHERE r.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;
```

Visualization: line.

Alert threshold: grounding recast rate > 10%. Investigate evidence quality or analyst prompt.

## Widget 6: Cost p50 / p95 per run

```sql
WITH run_costs AS (
  SELECT
    a.run_id,
    SUM((COALESCE(a.input_tokens, 0) / 1000000.0) * 0.10
      + (COALESCE(a.output_tokens, 0) / 1000000.0) * 0.20) AS cost_usd
  FROM audit a
  JOIN run r ON a.run_id = r.id
  WHERE r.created_at >= CURRENT_DATE - INTERVAL '30 days'
    AND a.input_tokens IS NOT NULL
  GROUP BY a.run_id
)
SELECT
  percentile_cont(0.50) WITHIN GROUP (ORDER BY cost_usd) AS p50_cost_usd,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY cost_usd) AS p95_cost_usd,
  COUNT(*) AS runs_with_cost_data
FROM run_costs;
```

Visualization: scalar (two numbers).

Alert threshold: p95 cost > $0.50 per run. Investigate token bloat or coverage loop overshoot.

## Widget 7: Cache savings rate (future-ready)

```sql
SELECT
  SUM(COALESCE(cache_read_input_tokens, 0)) AS total_cache_read,
  SUM(COALESCE(cache_creation_input_tokens, 0)) AS total_cache_write,
  SUM(COALESCE(input_tokens, 0)) AS total_input,
  ROUND(
    100.0 * SUM(COALESCE(cache_read_input_tokens, 0))
    / NULLIF(SUM(COALESCE(cache_read_input_tokens, 0)) + SUM(COALESCE(cache_creation_input_tokens, 0)) + (SUM(COALESCE(input_tokens, 0)) - SUM(COALESCE(cache_read_input_tokens, 0))), 0),
    2
  ) AS cache_savings_rate_pct
FROM audit
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days';
```

Visualization: scalar percentage.

Gemma 4 on DeepInfra has no prompt caching, so cache read and write columns stay zero. This widget shows the metric structure for a future model swap.

Alert threshold (if a future model supports caching): savings rate < 20%. Review cache key patterns.

## Dashboard refresh

- Metabase auto-refresh: every 1 hour.
- Operator sets a daily email summary if SMTP is configured in Metabase.
- The audit table may contain target names. Restrict Metabase access to operator accounts only.