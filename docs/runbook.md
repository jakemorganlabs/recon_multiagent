# Recon Runbook

> Operator procedures. Each entry is designed to be executable from cold without asking questions.

---

## 1. Redeploy

**Goal:** Update the production n8n Cloud workflow from a tagged JSON export.

**Preconditions:**
- You have a clean workflow JSON export (no secrets — verify with `bash scripts/secret_gate.sh` first).
- The n8n Cloud workspace is reachable and you have Owner or Admin role.

**Steps:**

1. Download the tagged workflow JSON from the GitHub Release assets.
2. Open https://app.n8n.cloud and sign in.
3. Navigate to **Settings → Workflows**.
4. Select the existing `recon` workflow.
5. Click **Import** → choose the JSON file.
6. n8n will prompt to map credentials. Ensure each credential is mapped to the existing n8n credential store entry (do NOT paste keys into the import dialog).
7. Click **Save**, then **Activate**.
8. Send a test request via `scripts/smoke_prod.sh` and verify 200.
9. Check `run.status` in the DB is `complete` for the smoke run.

**Rollback:** If the new workflow behaves badly, deactivate it, re-import the previous tagged JSON, and re-activate.

---

## 2. Rotate HMAC Secret

**Goal:** Replace the shared HMAC secret between client and n8n Cloud webhook.

**Which credential:** The HMAC secret is stored as an **n8n Credential** named `Recon HMAC Secret` (type: Generic Credential → String). The n8n webhook trigger node references this credential by ID.

**Steps:**

1. In n8n Cloud, go to **Settings → Credentials**.
2. Find `Recon HMAC Secret`.
3. Click **Duplicate** → give it a temporary name (e.g., `HMAC-v2`).
4. Paste the new secret.
5. Update the webhook trigger node to reference the new credential ID.
6. Save and activate the workflow.
7. Distribute the new secret to authorized clients via a secure channel (1Password, Signal, or in-person). Never via email or Slack.
8. After all clients have confirmed receipt, delete the old credential.

**Client update:** Clients must update their `HMAC_SECRET` env var and restart within 24 hours. A grace period of dual secret acceptance is not implemented — coordinate the cutover.

---

## 3. Refresh Cassettes

**Goal:** Re-record the cassette fixtures used by the eval harness.

**When:**
- Search provider API response format changes.
- New eval cases are added that need live fixture data.
- Cassettes have aged out of API-side cache and produce non-deterministic results.

**How:**

```bash
CASSETTE_MODE=record npm run record
```

This runs `scripts/record_cassettes.ts` in record mode, which:
1. Reads eval case definitions from `fixtures/eval_cases/`.
2. Calls the live search adapter for each query.
3. Writes cassettes to `fixtures/cassettes/<case-id>/`.

**API quota implication:** Recording consumes live search API quota. The eval suite has ~30 cases with 2–4 queries each. At Brave Search's ~$0.002/query, a full refresh costs ~$0.12. DeepInfra token costs for the LLM calls are negligible at this volume, but verify your monthly DeepInfra budget before recording.

**After recording:**
- Run `npm run eval` to confirm the new cassettes still produce green results.
- If any test turns red, investigate whether the cassette drift represents a real regression or just a stale fixture.
- Commit the new cassettes on a branch and open a PR.

---

## 4. Restore Shared State

**Goal:** Recover the audit / shared-state database from a backup.

**Path:** The operator backs up the external Postgres via `pg_dump` nightly. The restore path:

```bash
# 1. Identify the backup file (operator convention: /backups/recon_YYYYMMDD_HHMMSS.sql)
BACKUP="/backups/recon_20260709_030000.sql"

# 2. Stop the n8n Cloud workflow to prevent writes during restore
#    (n8n Cloud: deactivate the workflow)

# 3. Drop and recreate the database
psql "postgresql://admin:admin@db-host:5432/postgres" -c "
  DROP DATABASE IF EXISTS recon;
  CREATE DATABASE recon;
"

# 4. Restore
pg_restore --jobs=4 --dbname="postgresql://recon:recon@db-host:5432/recon" "$BACKUP"

# 5. Re-run migrations to ensure schema is current
npm run migrate

# 6. Re-activate the n8n workflow
#    (n8n Cloud: activate the workflow)

# 7. Run the smoke test to confirm end-to-end
bash scripts/smoke_prod.sh
```

**Point-in-time recovery:** If using Postgres with WAL archiving, use `pg_basebackup` + WAL replay. The operator's backup script handles this; refer to the ops VPS `backup.sh`.

---

## 5. Check DLQ (Dead Letter Queue)

**Goal:** Identify runs that failed and were written to the dead_letter table.

**SQL:**

```sql
-- Recent dead letters (last 7 days)
SELECT
  dl.id,
  dl.run_id,
  dl.stage,
  dl.error_message,
  dl.created_at,
  r.target_name
FROM dead_letter dl
LEFT JOIN run r ON r.id = dl.run_id
WHERE dl.created_at >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY dl.created_at DESC
LIMIT 50;
```

**Interpretation:**
- `stage = 'brief_normalize'` → model extraction failed repeatedly. Check DeepInfra API availability.
- `stage = 'search_agent_turns'` → search provider error or timeout. Check search API quota.
- `stage = 'grounding_gate'` → a claim could not be verified. Check evidence integrity.
- `stage = 'pipeline'` → unhandled exception. Check structured logs for the `run_id`.

**Action:** For each DLQ row, retry if transient, or ticket the root cause.

---

## 6. Health-Check Webhook

**Goal:** A no-op health endpoint that returns 200 without invoking the model.

**n8n workflow:** The health workflow is a separate, minimal n8n workflow (not the main `recon` workflow) with a single webhook trigger + a Postgres query node.

**Response shape:**

```json
{
  "db": "ok",
  "config": "ok",
  "last_run_age_sec": 1847
}
```

**How to set up the health workflow:**
1. In n8n Cloud, create a new workflow named `recon-health`.
2. Add a **Webhook** trigger. Path: `/webhook/recon-health`. Method: GET.
3. Add a **Postgres** node: `SELECT now() - MAX(created_at) AS last_run_age_sec FROM run;`
4. Add a **Code** node that returns the JSON shape above.
5. Save and activate.

**UptimeRobot monitor:**
- URL: `https://jakemorganlabs.n8n.cloud/webhook/recon-health`
- Interval: Every 60 minutes
- Alert contact: Email to `ops@jakemorganlabs.dev` (operator-supplied)
- Expected HTTP status: 200
- Expected content: `"db": "ok"`

---

## 7. Closeout Protocol

After operator deploys and evidence is gathered, the closeout commit brings the repo to reviewer-complete:

```bash
git checkout -b closeout-evidence
# Drop into docs/evidence/:
#   northwind_dossier.md  — rendered demo dossier
#   dashboard.png          — Metabase screenshot (crop URLs)
#   cost_month.txt         — output of scripts/cost_monthly.sh
#   smoke_prod_output.txt  — transcript of smoke_prod.sh run
bash scripts/secret_gate.sh
git add docs/evidence README.md
git commit -m "closeout: production evidence — demo dossier, dashboard live, real cost numbers"
git push -u origin closeout-evidence
# Merge, then tag if not already tagged v1.0.0
```

---

## 8. Release Notes Template

Every release should carry non-empty notes:

```markdown
## vX.Y.Z — YYYY-MM-DD

### Highlights
- (3 bullets max)

### Evidence
- [Eval report](docs/evidence/eval_report.md)
- [Dashboard screenshot](docs/evidence/dashboard.png)
- [Cost report](docs/evidence/cost_month.txt)

### Docs
- [SRS/TDD](docs/recon_multiagent_srs_tdd.html)
- [Runbook](docs/runbook.md)
```
