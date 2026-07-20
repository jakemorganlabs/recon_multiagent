# Recon Multi-Agent Makefile.
# Commands for hooks, gates, cost reporting, smoke tests, and release dry-run.

.PHONY: hooks gate cost-month metabase-up smoke eval-prod release-dryrun help

help:
	@echo "Recon Makefile targets:"
	@echo "  hooks        - Install pre-commit hooks (runs secret_gate.sh before commit)"
	@echo "  gate         - Run the secret gate now"
	@echo "  cost-month   - Aggregate last 30 days of audit costs"
	@echo "  metabase-up  - Start Metabase container on ops VPS"
	@echo "  smoke        - Run production smoke test (requires RECON_WEBHOOK_URL + HMAC_SECRET)"
	@echo "  eval-prod    - Alias for: npm run eval"
	@echo "  release-dryrun - Simulate release artifact assembly"

hooks:
	@echo "Installing pre-commit hook..."
	@mkdir -p .git/hooks
	@echo '#!/usr/bin/env bash' > .git/hooks/pre-commit
	@echo 'bash scripts/secret_gate.sh' >> .git/hooks/pre-commit
	@chmod +x .git/hooks/pre-commit
	@echo "Pre-commit hook installed. It will run secret_gate.sh on every commit."

gate:
	@bash scripts/secret_gate.sh

cost-month:
	@bash scripts/cost_monthly.sh

metabase-up:
	@cd deploy/metabase && docker compose up -d

smoke:
	@bash scripts/smoke_prod.sh

eval-prod:
	@npm run eval

release-dryrun:
	@echo "=== Release Dry Run ==="
	@mkdir -p _release
	@cp workflows/*.json _release/ 2>/dev/null || true
	@cp docs/runbook.md _release/runbook.md 2>/dev/null || touch _release/runbook.md
	@cp evals/report.md _release/eval_report.md 2>/dev/null || touch _release/eval_report.md
	@echo "Artifact contents:"
	@ls -la _release/
	@echo ""
	@echo "Secret-grep check:"
	@if grep -rE 'sk-ant|sk-[a-zA-Z0-9]{24,}|Bearer [a-zA-Z0-9_-]{20,}|hooks\.slack\.com/services' _release/; then echo "❌ Would fail release"; else echo "✅ Would pass"; fi
