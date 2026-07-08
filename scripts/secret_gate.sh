#!/usr/bin/env bash
# scripts/secret_gate.sh
# Pre-commit gate: refuses to commit if any secret-like string is found.
# Checks: workflow JSONs, source files, and evidence directory.
#
# Usage: bash scripts/secret_gate.sh
#        (or wire via `make hooks` as pre-commit)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXIT_CODE=0

echo "=== Secret Gate ==="

# --- Patterns ---
# sk-ant      = Anthropic key prefix
# sk-...      = Generic secret key (length heuristic)
# Bearer ...  = Inline authorization header
# hooks.slack.com/services = Slack webhook
# "data":"... credential blobs in n8n exports
PATTERNS=(
  'sk-ant'
  'sk-[a-zA-Z0-9]{24,}'
  'Bearer [a-zA-Z0-9_-]{20,}'
  'hooks\.slack\.com/services'
  '"data":"[a-zA-Z0-9+/=]{40,}'
)

# --- Files to scan ---
# All tracked files + untracked files under workflows/, src/, docs/evidence/
SCAN_FILES=()

while IFS= read -r -d '' file; do
  SCAN_FILES+=("$file")
done < <(git ls-files -z)

# Also scan untracked files in sensitive dirs
if [ -d "$REPO_ROOT/workflows" ]; then
  while IFS= read -r -d '' file; do
    SCAN_FILES+=("$file")
  done < <(find "$REPO_ROOT/workflows" -type f -print0 2>/dev/null)
fi

if [ -d "$REPO_ROOT/docs/evidence" ]; then
  while IFS= read -r -d '' file; do
    SCAN_FILES+=("$file")
  done < <(find "$REPO_ROOT/docs/evidence" -type f -print0 2>/dev/null)
fi

# --- Scan ---
for file in "${SCAN_FILES[@]}"; do
  # Skip .env files (expected to hold secrets locally) and session HTML docs (contain pattern mentions in prose)
  case "$(basename "$file")" in
    .env|.env.*|*.html) continue ;;
  esac

  for pattern in "${PATTERNS[@]}"; do
    if grep -q -E "$pattern" "$file" 2>/dev/null; then
      echo "❌ FAIL: $file matches pattern '$pattern'"
      EXIT_CODE=1
    fi
  done
done

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "Secret gate FAILED. Fix the matches above before committing."
  echo "Remember: n8n Cloud credentials live in n8n credential storage ONLY."
  echo "Workflow JSON exports must contain credential references, not literal values."
  exit 1
else
  echo "✅ Secret gate PASSED — no credential patterns found."
fi
