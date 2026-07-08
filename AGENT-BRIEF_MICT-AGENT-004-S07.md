# CURSOR AGENT BRIEF — MICT-AGENT-004 · S07 Dashboard, Cost, CI, Deploy

> Give this file to the Cursor agent together with the session doc (`MICT-AGENT-004-S07_dashboard-cost-ci-deploy.html`).
> Repo: `jakemorganlabs/recon_multiagent` · Session 7 of 7 · Parent: MICT-AGENT-004 v1.0

## Mission — and how this session is different

**The runtime is n8n Cloud (managed) — there is no VPS deploy of the workflow itself.** Deployment here means: structured logging + cost columns in code, a Metabase dashboard over the audit database, a CI **release** workflow with OIDC provenance (Piece III's discipline, different artifact), config lockdown, and a rate-limited public demo. You write everything committable; the operator handles n8n Cloud UI configuration, credentials, Metabase setup clicks, and the demo URL.

**Locked architecture decision (do not revisit):** n8n Cloud's internal Postgres is not customer-queryable, so the audit/shared-state database this repo already writes to is the external Postgres (per S02). Metabase runs as a container on the ops VPS and connects **outbound** to that same database. If S02's state DB is currently anything else, flag it in your report — do not silently migrate.

## Non-negotiable secret rules

1. Placeholders only; the env example is the only env file you create.
2. **Workflow JSON exports are the #1 leak vector in this repo.** Any file under `workflows/` you touch or export: grep for `sk-ant`, `sk-`, `Bearer `, `hooks.slack.com/services`, `"data":"` credential blobs. n8n Cloud credentials live in n8n credential storage **only**; exports must contain credential references only.
3. `scripts/secret_gate.sh` (org spec) green before every commit; wire it as the pre-commit hook (`make hooks`).
4. `config/pricing.json` contains prices, never keys. Anything with `key`, `token`, `secret` in `config/` is a stop-and-report.

## Files to create

### 1. `src/log.ts` — structured logger
One function, JSON-line output, mandatory fields per §17.1: `run_id`, `stage`, `status`, `latency_ms`; optional per-stage extras (`model_id`, `tokens`, `similarity_top`, `gate_fired`). **Truncate any free-text field to 200 chars** (§7 — n8n Cloud log retention); full content belongs in the audit row, not the log line. Wire it into every stage: `request_trigger`, `brief_normalize`, `search_agent_turns`, `analyst`, `coverage_check`, `synthesis`, `grounding_gate`, `persist`.

### 2. Audit cost columns + migration
Migration adding per-model-call columns: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. Populate from the API response on every Brief / Analyst / Synthesis / Search-agent-turn call. **Get the cache semantics right (§7):** `cache_read` = cache hit (cheap); `cache_creation` = cache write (premium). Record both separately; never sum them into one column.

### 3. `config/pricing.json` + staleness warning
Date-stamped (`"as_of": "YYYY-MM-DD"`) rates for the Anthropic models in use (input / output / cache-read / cache-write per MTok) + the search provider. **Pull current prices from the provider pricing pages at authoring time — do not use remembered numbers.** Runtime warning wherever pricing is loaded: if `as_of` > 90 days old, log a `pricing_stale` warning.

### 4. `scripts/cost_monthly.sh`
Aggregates audit rows for the trailing 30 days against `config/pricing.json`. Outputs: total cost, per-run cost (p50/p95), and cache savings rate = `cache_read / (cache_read + cache_creation + uncached_input)`. Reads DB connection from env (`AUDIT_DATABASE_URL`), never a literal.

### 5. `deploy/metabase/docker-compose.yml` (runs on the ops VPS)
Metabase pinned to a current stable tag (`# pinned — bump deliberately`), its app-data on a named volume, binding `127.0.0.1:3000` only (operator reaches it over SSH port-forward, or adds a Cloudflare Access-protected hostname later — note both options in a comment; **never** a public port). Env-file driven.

### 6. `docs/dashboard.md`
The Metabase build sheet so the operator's clicks are mechanical: for each of the 6+ §17.3 widgets — runs over time + status mix, gap rate per slot, coverage iteration rate, evidence/fetch volume per run, grounding recast rate, cost p50/p95 — give the exact SQL query and the alert threshold from the §17.3 table. Also include the two index migrations §7 calls for: `(created_at, status)` and `(slot_name)` on the audit table (put the actual `CREATE INDEX` statements in the migration from item 2).

### 7. Health-check webhook + monitor notes
A no-op health workflow (export JSON, credential-reference-clean) returning `{db:'ok', config:'ok', last_run_age_sec:N}` with **no model call**. In `docs/runbook.md`, note the UptimeRobot setup (hourly ping, email alert) as an operator step.

### 8. `.github/workflows/release.yml`
Piece III's shape, different artifact:
- Trigger `on.release.types: [published]`; permissions `contents: read`, `id-token: write` (plus `contents: write` if uploading assets via the API — keep minimal and justify in a comment).
- Steps: checkout → setup-node → `npm ci` → build → **run the eval suite as a release gate** (fail = no release) → assemble the release artifact: tagged clean workflow JSON exports + `docs/runbook.md` + the latest eval report → attach to the GitHub Release **with provenance/attestation** (use GitHub's artifact attestation action, `actions/attest-build-provenance`, against the assembled archive).
- Add a step that greps the workflow JSONs for token prefixes and **fails the release** on any hit — the automated version of the §7 mitigation.

### 9. Config lockdown pass
Sweep the codebase: budgets, floors, caps, slot taxonomy, allow/deny domains, model IDs, pricing — every one externalized to `config/*.json` or n8n env vars; nothing hardcoded. Produce `docs/config_inventory.md` listing each parameter, its file, and its default. Anything you find hardcoded, move it and note it in the report.

### 10. `scripts/smoke_prod.sh`
HMAC-signed request to the n8n Cloud webhook URL (URL from `$RECON_WEBHOOK_URL`, secret from `$HMAC_SECRET` — mirror the middleware's exact header/signing scheme) with the synthetic **Northwind Robotics** payload. Assert 200 + a grounded dossier (schema check via `jq`: citations present, no empty required slots) + instruct verifying the persisted shared-state row.

### 11. Demo docs
`docs/demo.md`: the demo URL plan (`recon.jakemorganlabs.dev`), **rate limiting before public** (10 req/hour/IP via a Cloudflare WAF rate-limiting rule — write the rule spec), and the render step: run Northwind, render dossier to markdown (v1.0; PDF deferred), publish at the demo URL. Include the §7 note: fix any red evals before going public, or ship a "known gaps" note beside the report.

### 12. `docs/runbook.md`
Exact procedures: **redeploy** (update the n8n Cloud workflow from the tagged JSON export — write the actual click path), **rotate HMAC secret** (which n8n credential, how clients get the new one), **refresh cassettes** (when, how, and the API quota implication), **restore shared state** (the real `pg_restore` path for the audit/state DB), **check DLQ** (the SQL). No stubs — each entry testable from cold.

### 13. `Makefile`
`hooks · gate · cost-month · metabase-up · smoke · eval-prod · release-dryrun`.

## Git protocol

```bash
git checkout -b s07-deploy
bash scripts/secret_gate.sh
git add -A && git commit -m "S07: observability, cost model, OIDC release, config lockdown, demo + runbook"
git push -u origin s07-deploy
```

## Definition of done (your half)

- [ ] Logger in every stage with truncation; cost columns populated on every model call; cache read/write never conflated.
- [ ] Pricing config date-stamped from live pricing pages; staleness warning wired.
- [ ] Dashboard build sheet has runnable SQL for all 6+ widgets + thresholds; indexes in the migration.
- [ ] `release.yml` gates on evals AND on a secret-grep of workflow exports; attestation step present.
- [ ] Config inventory complete; nothing hardcoded remains.
- [ ] Secret gate green; exports credential-reference-clean; branch pushed.

## Out of scope for you

n8n Cloud UI configuration and credential entry · Metabase account setup and widget clicking (you supplied the SQL) · UptimeRobot · Cloudflare WAF rule creation · running the demo · anything with a real secret. Operator steps — field manual `MICT-OPS-001`.

---

## Reviewer-facing completeness (required — the repo's front door)

This is the portfolio's flagship before the capstone — the repo a reviewer will read longest. It must show *outcomes*, not just machinery.

### README.md — restructure to this exact spine
1. **One-line thesis** ("The agents gather; the evidence grounds; the orchestrator bounds") + CI badge + release badge + demo link slot.
2. **See it run** — top of the README, three links: the rate-limited live demo (`recon.jakemorganlabs.dev`), the rendered Northwind Robotics dossier (commit the markdown render into `docs/samples/northwind_dossier.md` — reviewers read the artifact, not the code), and the latest eval report. Placeholders `__AFTER_DEPLOY__` until live.
3. **Architecture** — Mermaid of the three-agent topology: Search / Analyst / Synthesis, bounded toolsets, hard-capped coverage loop, deterministic grounding gate, no-action posture. One diagram, one paragraph on why no-action is the safety property.
4. **Observability & economics** — a screenshot of the Metabase dashboard (operator supplies; leave slot) and the headline from `cost_monthly.sh`: cost per run p50/p95 and cache savings rate. Real numbers here separate this repo from every agent demo on GitHub.
5. **Evals** — cassette-based harness explained in three sentences (reproducible without the live web), case counts, pass rate, CI gating.
6. **Release discipline** — provenance-attested releases, secret-grepped exports, link to the v1.0.0 attestation.
7. GitHub description ("Three-agent company-intelligence system — bounded loops, deterministic grounding, cassette evals, provenance-attested releases") + topics (`multi-agent`, `llm-orchestration`, `evals`, `n8n`, `anthropic`).

### The evidence commit (prepare the slots)
`__AFTER_DEPLOY__` slots for: demo URL live; `docs/samples/northwind_dossier.md` committed; dashboard screenshot in `docs/`; real cost numbers in README §4; prod smoke transcript + eval green link in `docs/deployment_evidence.md`. **Fix any red evals before the demo goes public, or ship the "known gaps" note beside the report (§7 of the session doc) — a reviewer meeting a silent failure first is the worst outcome. Not reviewer-complete until this commit lands on `main`.**

---

# PART II — REVIEWER COMPLETENESS (same session, required)

Deployment artifacts alone read as "infra was added," not "project finished." A reviewer judges the repo from the README, the committed evidence, the release history, and the hygiene below. All of this is committable and secret-free — produce it in the same branch.

## R1. README — full rewrite to the reviewer-facing spec

Order matters; this is the skim path:

1. **Title + one-sentence value claim** + badge row (CI status, release badge, eval-gate badge).
2. **Status line:** `v1.0.0 — deployed and live` with the demo URL `recon.jakemorganlabs.dev` (rate limit stated: 10 req/hr/IP) and a direct link to the rendered Northwind dossier.
3. **What it does** — 3–5 sentences, written for a hiring manager, not a user of the code.
4. **Architecture** — a Mermaid diagram of the three agents (Search · Analyst · Synthesis) with bounded toolsets, the hard-capped coverage loop, the deterministic grounding gate, and the no-action posture — this diagram is the single most reviewer-important artifact in the repo (GitHub renders Mermaid natively; no image files needed) + a one-paragraph walk-through.
5. **The measured bar** — a table of the eval suite results (suite name · cases · pass rate · gate) linking to the committed eval report. Numbers, not adjectives.
6. **Security posture** — a short section stating the actual guarantees: no-action posture (worst case is a dossier with explicit gaps), HMAC on the webhook, secrets only in n8n credential storage, exports secret-grepped in CI which fails the release on a hit, OIDC-attested releases. This section existing *is* a differentiator; most portfolio repos don't have one.
7. **Run it yourself** — local quickstart (compose up with the `.example` env), then a pointer to `docs/runbook.md` for production.
8. **Repo map** — a 10-line annotated tree of the important directories.
9. **Docs index** — links to the SRS/TDD doc, runbook, and evidence directory.

Anti-pattern to avoid: a README that only says how to install. The reviewer needs *what, why, how proven* before *how run*.

## R2. `docs/evidence/` — the proof directory

Create the directory with a README index and placeholder slots the closeout commit will fill:

- `docs/evidence/README.md` — index
- `northwind_dossier.md` — the rendered demo dossier (closeout; this is the portfolio's public face — link it from the README top)
- `eval_report.md` — cassette-suite results (commit now)
- `dashboard.png` — slot: Metabase with the 6+ widgets showing real data (closeout; crop any URLs)
- `cost_month.txt` — slot: `cost_monthly.sh` output — real dollars, real cache-savings rate (closeout; a cost number is rare in portfolio repos and lands hard)
- `smoke_prod_output.txt` — slot (closeout)

Every artifact here must be sanitized: synthetic/redacted data only, secret-gate clean. Real client data, tokens, and internal URLs never enter evidence.

## R3. Repo hygiene sweep

- `LICENSE` file present (MIT unless the SRS says otherwise).
- Remove or complete any stub/TODO files a reviewer would trip over; `grep -rn "TODO\|FIXME\|XXX" src/` and resolve or ticket each.
- No dead code paths or commented-out blocks left from earlier sessions in files this session touches.
- `package.json` description + repository fields accurate.
- Operator reminder (put in your report): set the GitHub repo **description + topics** (`multi-agent`, `llm-orchestration`, `grounding`, `n8n`, `anthropic`, `evals`) and pin the repo — the description line is the first thing a reviewer reads, before the README.

## R4. The closeout commit protocol (write it into `docs/runbook.md` as its final section)

The operator deploys per the field manual, then returns and commits the evidence:

```bash
git checkout -b closeout-evidence
# drop into docs/evidence/: Northwind dossier, dashboard screenshot, cost output, smoke transcript
bash scripts/secret_gate.sh          # evidence is the likeliest place a URL/token sneaks in
git add docs/evidence README.md && git commit -m "closeout: production evidence — demo dossier, dashboard live, real cost numbers"
git push -u origin closeout-evidence # merge, then tag if not already tagged
```

The repo is reviewer-complete only after this commit lands: the README claims are then backed by committed artifacts a stranger can open.

## R5. Definition of done — reviewer half

- [ ] README matches the R1 spec top-to-bottom; every claim links to a committed artifact or live URL.
- [ ] `docs/evidence/` exists with an index; closeout protocol written into the runbook.
- [ ] Hygiene sweep done; zero unresolved TODOs in touched paths; LICENSE present.
- [ ] Secret-handling is *visible*: exhaustive `.env.production.example`, gate script referenced in README's security section, CI gates named.

---

# PART III — FINISHING SIGNALS (same session, required)

Part II makes the repo complete; these make it *feel* finished in the first two minutes of a stranger's attention. All committable, all secret-free.

## F1. Hero visual at the top of the README

Directly under the badge row, before any prose: a two-panel hero: the architecture diagram (agents · loop · grounding gate · no-action posture) beside a screenshot excerpt of the rendered Northwind dossier with a visible citation and a visible flagged gap. Showing a *gap being surfaced honestly* is the point of the whole system — put it in the first screenful. Store images in `docs/img/`. A reviewer decides whether to keep reading based on this one visual — treat it as the most important artifact in the README. (Operator captures the screenshot; you create the slot, the caption, and the image reference now.)

## F2. Commit the controlled document — the differentiator, made findable

Copy the baselined SRS/TDD (`recon_multiagent_srs_tdd.html`) into `docs/` and link it prominently from the README's docs index as **"SRS/TDD — the controlled document this build implements (Rev 1.0, baselined)."** Note for the link text: GitHub serves committed HTML as raw source, so the link should point at the *hosted render* (portfolio site or GitHub Pages — operator step in the field manual §8.4) with the committed file as the canonical copy. A repo that implements a baselined spec with a revision history reads as engineering discipline almost no portfolio repo has — but only if the reviewer can actually open it.

## F3. Portfolio cross-link block

A short README section (near the bottom, above the author footer):

> **Part of a five-piece portfolio.** This is Piece IV — orchestration: bounded specialist agents, a hard-capped loop, and a deterministic gate between the model and the world.
> Piece I `intake-n-outbound.pipeline` · Piece II `document-intelligence-rag` · Piece III `shovels_n8n_nodes` · Capstone `fieldops`

Every repo links its siblings; a reviewer landing anywhere discovers the system. Use the composition framing where true — FIELD-005 explicitly reuses this piece's discipline: its agent orchestration and review-loop discipline become the capstone's Estimator/Writer/Reviewer team.

## F4. Author footer

Last section of the README: name, `jakemorganlabs` portfolio URL, LinkedIn, contact email (operator supplies final URLs — leave `__OPERATOR__` placeholders and flag in your report). The repo is a funnel; give it an exit.

## F5. Code-polish pass — the files a reviewer will actually open

Reviewers open two or three source files, usually the ones the README architecture section names. For each core module in the coverage-check loop, the grounding gate, the per-stage schema validators, and the cost-accounting path: a header comment block stating (a) what this module is responsible for, (b) the invariant it enforces, (c) what it deliberately does *not* do. Three to six lines each — design intent, not restated code. 

## F6. History & release hygiene

- Commit messages from here on: `type(scope): summary` — e.g. `feat(deploy): pgvector stack + tunnel sidecar`, `docs(evidence): prod eval report`. Don't rewrite old history; make the visible tail disciplined.
- PR descriptions carry a 3-line session summary (what/why/proof) — reviewers read merged PRs.
- Release notes are never blank. Template per release: **Highlights** (3 bullets) · **Evidence** (links into `docs/evidence/`) · **Docs** (SRS/TDD + runbook links).
- Operator reminder for your report: delete merged branches; zero stale branches or abandoned draft PRs at closeout — stale branches read as abandonment.

## F7. Definition of done — finishing half

- [ ] Hero visual slot + caption at README top; image path committed (capture flagged to operator).
- [ ] SRS/TDD committed under `docs/` and linked; hosted-render link slot present.
- [ ] Cross-link block + author footer in place (`__OPERATOR__` URLs flagged).
- [ ] Header comments on every named core module.
- [ ] Release-notes template in `docs/runbook.md`; commit style adopted; branch-cleanup flagged to operator.
