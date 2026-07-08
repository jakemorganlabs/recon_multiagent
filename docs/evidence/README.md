# Evidence Directory

> Committed production evidence — the proof a reviewer can open. This directory is filled during the closeout commit.

## Index

| File | Status | Description |
|------|--------|-------------|
| `northwind_dossier.md` | `__AFTER_DEPLOY__` | Rendered demo dossier for Northwind Robotics. The portfolio's public face. |
| `eval_report.md` | `__AFTER_DEPLOY__` | Latest eval suite results (commit from CI artifact). |
| `dashboard.png` | `__AFTER_DEPLOY__` | Screenshot of Metabase dashboard with 6+ widgets showing real data. |
| `cost_month.txt` | `__AFTER_DEPLOY__` | Output of `scripts/cost_monthly.sh` — real dollars, cache savings rate. |
| `smoke_prod_output.txt` | `__AFTER_DEPLOY__` | Transcript of `scripts/smoke_prod.sh` run against production. |

## Sanitization Rules

Every file here must be:
- Secret-gate clean (no tokens, no URLs, no internal hostnames).
- Synthetic or redacted data only.
- Real client data, tokens, and internal URLs **never** enter evidence.

## Closeout Command

```bash
git checkout -b closeout-evidence
# Drop files into this directory per the table above
bash scripts/secret_gate.sh
git add docs/evidence README.md
git commit -m "closeout: production evidence — demo dossier, dashboard live, real cost numbers"
git push -u origin closeout-evidence
```
