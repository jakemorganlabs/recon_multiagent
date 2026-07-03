# Recon — Multi-Agent Company Intelligence

Session-based build of a deterministic multi-agent research system.
Each session produces a green test suite and a clean handoff to the next.

## Stack

- TypeScript / Node 22+
- Postgres (plain — no pgvector)
- Vitest for tests
- GitHub Actions for CI

## Model

- Provider: DeepInfra
- Model: `google/gemma-4-26B-A4B-it`

## Sessions

| Session | Focus |
|---------|-------|
| S01 | Deterministic Core — schemas, migrations, citation verifier, coverage decision, idempotency |
| S02 | Brief & Shared State |
| S03 | Search Agent & Web Tools |
| S04 | Analyst & Coverage Loop |
| S05 | Synthesis & Grounding Gate |
| S06 | Eval Harness & Fixtures |
| S07 | Dashboard, Cost, CI, Deploy |

## Install

```bash
npm install
cp .env.example .env
# edit .env with your credentials
```

## Database

```bash
# Start Postgres (Docker is fine; no pgvector needed)
docker run -d -e POSTGRES_USER=recon -e POSTGRES_PASSWORD=recon -e POSTGRES_DB=recon -p 5432:5432 postgres:16

# Run migrations
npm run migrate
```

## Test

```bash
npm test
```

## CI

Pushes to `main` trigger tests + schema validation. Branch protection is required.
