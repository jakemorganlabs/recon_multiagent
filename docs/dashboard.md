# Dashboard Build Sheet — Metabase over Postgres

> Operator guide: for each widget below, paste the SQL into a Metabase Native Query question, set the visualization type, and place on the dashboard. Each widget links to a S17.3 metric.

## Database

Connect Metabase to the same Postgres the audit / shared-state DB lives on (S02). If n8n Cloud's internal Postgres is not directly queryable, the operator should have provisioned an external Postgres as the audit DB.

## Indexes (required — run before dashboard queries)

```sql
-- Migration 010 adds these indexes automatically via migrations/010_audit_cost_columns.sql
-- These are also reproduced here for operator reference:

CREATE INDEX IF NOT EXISTS idx_audit_created_at_status
  ON audit (created_at DESC, (payload->>'status'));

CREATE INDEX IF NOT EXISTS idx_audit_slot_name
  ON audit ((payload->>'slot_name'));
```

---

## Widget 1 — Runs over time + status mix

**SQL:**

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

**Visualization:** Line or Bar (grouped by status).

**Alert threshold (S17.3):** `failed` runs > 5% of total daily volume → notify operator.

---

## Widget 2 — Gap rate per slot

**SQL:**

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

**Visualization:** Bar chart.

**Alert threshold (S17.3):** Any slot gap rate > 40% → investigate slot question clarity.

---

## Widget 3 — Coverage iteration rate

**SQL:**

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

**Visualization:** Pie or Bar.

**Alert threshold (S17.3):** > 30% of runs hit max_iterations (3) → tune coverage confidence_floor.

---

## Widget 4 — Evidence / fetch volume per run

**SQL:**

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

**Visualization:** Table.

**Alert threshold (S17.3):** Any run with 0 fetches but `status = 'complete'` → flag as potential grounding failure.

---

## Widget 5 — Grounding recast rate

**SQL:**

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

**Visualization:** Line.

**Alert threshold (S17.3):** Grounding recast rate > 10% → investigate evidence quality or analyst prompt.

---

## Widget 6 — Cost p50 / p95 per run

**SQL:**

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

**Visualization**: Scalar (two numbers).

**Alert threshold (S17.3):** p95 cost > $0.50 per run → investigate token bloat or coverage loop overshoot.

---

## Widget 7 — Cache savings rate (future-ready)

**SQL:**

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

**Visualization:** Scalar (percentage).

**Note:** For Gemma 4 on DeepInfra, cache read/write columns are currently zero (Gemma does not support prompt caching). This widget exists to demonstrate the metric structure for the operator if models are swapped later.

**Alert threshold (S17.3):** If a future model supports caching: savings rate < 20% → review cache key patterns.

---

## Dashboard Refresh

- Metabase auto-refresh: every 1 hour.
- Operator should set daily email summary if SMTP is configured in Metabase.
- Sensitive data: audit table may contain target names. Ensure Metabase access is restricted to operator accounts only.
