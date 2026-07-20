# Public demo plan

## URL

`https://recon.jakemorganlabs.dev`

Status: `__AFTER_DEPLOY__`. Operator fills after the n8n Cloud workflow is live.

## Rate limiting

Before the demo URL is public, a Cloudflare WAF rate-limiting rule must be active:

```
Rule name: recon-demo-rate-limit
Expression: (http.host eq "recon.jakemorganlabs.dev")
Action: Block
Rate limit:
  requests: 10
  period: 1 minute
  source: IP
```

This caps each IP to 10 requests per minute. The rule is intentionally strict. The demo is a portfolio showcase, not a production service.

## Demo run

The demo runs on the synthetic Northwind Robotics target. The pipeline produces a dossier that is:

1. Rendered to markdown (`docs/samples/northwind_dossier.md`) for v1.0.
2. Published at the demo URL via a static markdown renderer or n8n webhook response.
3. Branded PDF is deferred to a future enhancement.

## Known gaps policy

If any eval metric is red, the operator must either:

- Fix the failure before going public (preferred), or
- Ship a "known gaps" note beside the report with the gap, the root cause, and the remediation plan.

A reviewer meeting a silent failure first is the worst outcome.

## Steps

1. Ensure S06 evals are green on `main`.
2. Configure the n8n Cloud webhook trigger with the demo URL.
3. Activate the Cloudflare WAF rate-limit rule.
4. Run `scripts/smoke_prod.sh` from a non-VPS network.
5. Verify the returned dossier has citations and explicit gap annotations.
6. Inspect `docs/samples/northwind_dossier.md` for quality.
7. Go live.