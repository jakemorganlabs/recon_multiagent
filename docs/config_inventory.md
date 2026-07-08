# Recon Configuration Inventory

> Every tunable parameter, its source file, and its default. Created during S07 config lockdown.

## Model / Provider

| Parameter | Value / Default | Source | Note |
|-----------|----------------|--------|------|
| Model name | `google/gemma-4-26B-A4B-it` | `config/budgets.json` → `.model.model_name` | Fallback in `server.ts` and agent modules. |
| Provider | `deepinfra` | `config/budgets.json` → `.model.provider` | `src/search_adapter.ts` search itself is HTTP, not LLM. |
| Base URL | `https://api.deepinfra.com/v1/openai` | `.env.example` → `DEEPINFRA_BASE_URL` | Server reads from env var at runtime. |
| API key | `<empty>` | `.env.example` → `DEEPINFRA_API_KEY` | Stored in n8n Credential storage only in production. |
| Temperature | `0.2` overall; agents enforce `0` | `config/budgets.json` → `.model.temperature` | Agents override with 0 for deterministic extraction. |

## Coverage Loop

| Parameter | Value | Source | Note |
|-----------|-------|--------|------|
| Max iterations | `3` | `config/budgets.json` → `.coverage.max_iterations` | Hard cap — coordinator, not model, decrements. |
| Confidence floor | `0.6` | `config/budgets.json` → `.coverage.confidence_floor` | Analyst signals below this trigger coverage continuation. |

## Search / Fetch Budgets

| Parameter | Value | Source | Note |
|-----------|-------|--------|------|
| Max queries per run | `20` | `config/budgets.json` → `.search.max_queries_per_run` | Strict ceiling enforced in `search_agent.ts`. |
| Max fetches per run | `30` | `config/budgets.json` → `.search.max_fetches_per_run` | Prevents runaway web traversal. |
| Fetch timeout (ms) | `15000` | `config/budgets.json` → `.search.fetch_timeout_ms` | Also in `.env.example` → `FETCH_TIMEOUT_MS`. |
| Max fetch bytes | `1048576` | `config/budgets.json` → `.search.max_fetch_bytes` | Also in `.env.example` → `FETCH_MAX_BYTES`. |
| Results per query | `10` | `config/budgets.json` → `.search.results_per_query` | Passed to search adapter. |

## Token Budgets per Stage

| Parameter | Value | Source | Note |
|-----------|-------|--------|------|
| Max tokens (Brief) | `2048` | `src/brief_normalizer.ts` | Hardcoded with opts override. |
| Max tokens (Search) | `2048` | `config/budgets.json` → `.model.max_tokens_search` | Agent respects config. |
| Max tokens (Analyst) | `4096` | `config/budgets.json` → `.model.max_tokens_analyst` | Agent respects config. |
| Max tokens (Synthesis) | `8192` | `config/budgets.json` → `.model.max_tokens_synthesis` | Agent respects config. |

## Domain Policy

| Parameter | Value | Source | Note |
|-----------|-------|--------|------|
| Allowed domains | `[]` (all) | `config/domain_policy.json` → `.allow_list` | Empty = no restriction. |
| Blocked domains | `[]` | `config/domain_policy.json` → `.deny_list` | Add malicious / low-trust domains here. |

## Slot Taxonomy

| Parameter | Value | Source | Note |
|-----------|-------|--------|------|
| Slot definitions | 9 slots (overview, products, funding, headcount, tech_stack, hiring, leadership, recent_news, risks) | `config/slot_taxonomy.json` | Rules: required vs optional, confidence floors. |

## Pricing

| Parameter | Value | Source | Note |
|-----------|-------|--------|------|
| Input rate | `$0.10 / M tok` | `config/pricing.json` → `.models[].input_per_mtok` | DeepInfra Gemma rate, 2026-07-09. |
| Output rate | `$0.20 / M tok` | `config/pricing.json` → `.models[].output_per_mtok` | DeepInfra Gemma rate, 2026-07-09. |
| Cache read | `$0.00 / M tok` | `config/pricing.json` → `.models[].cache_read_per_mtok` | Gemma does not support caching. |
| Cache creation | `$0.00 / M tok` | `config/pricing.json` → `.models[].cache_creation_per_mtok` | Gemma does not support caching. |
| Staleness warning | `90 days` | `config/pricing.json` → `.staleness_warning_days` | `src/pricing.ts` logs `pricing_stale` if exceeded. |

## Database

| Parameter | Value | Source | Note |
|-----------|-------|--------|------|
| DATABASE_URL | `postgresql://recon:recon@localhost:5432/recon` | `.env.example` | Operator overrides in production. |
| Audit table | `audit` | Migration 007 | Includes cost columns from Migration 010. |

## Security

| Parameter | Value | Source | Note |
|-----------|-------|--------|------|
| HMAC secret | `<empty>` | `.env.example` → `HMAC_SECRET` | Production lives in n8n Credential storage. |
| Auth stale window | `300 seconds` | `src/hmac.ts` | Requests signed >5 min ago are rejected. |

## Hardcoded Values Found (not moved — documented)

These values are intentionally hardcoded because they are architectural invariants, not tunable parameters:

| Value | Location | Rationale |
|-------|----------|-----------|
| Temperature `0` for agents | `src/brief_normalizer.ts`, `src/search_agent.ts`, `src/analyst_agent.ts`, `src/synthesis_agent.ts` | Deterministic extraction is non-negotiable; caller can override but default is 0. |
| 200-char log truncation | `src/log.ts` | n8n Cloud log retention limit (S07 §7). |
| `localhost` / `127.0.0.1` / `::1` block | `src/fetch_tool.ts` | Security invariant — never fetch from loopback. |
| `TRUNCATE_AT = 200` | `src/log.ts` | Matches n8n Cloud log retention policy. |

## Not Hardcoded (Good)

- Model budget caps: all from `config/budgets.json`.
- Slot taxonomy: from `config/slot_taxonomy.json`.
- Domain policy: from `config/domain_policy.json`.
- DB connection string: from env var only.
- Pricing: from `config/pricing.json` with freshness check.
