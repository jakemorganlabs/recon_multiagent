/**
 * Cassette Recorder Script
 *
 * Run a single case against the live web in CASSETTE_MODE=record,
 * flushing results to fixtures/cassettes/{case_id}/.
 *
 * Usage:
 *   CASSETTE_MODE=record node --experimental-strip-types scripts/record_cassettes.ts <case_id>
 *
 *
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../src/pipeline.js';
import { flushCassette, getCassetteMode } from '../src/cassette_player.js';
import { getPool, closePool } from '../src/db.js';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const caseId = process.argv[2];
  if (!caseId) {
    console.error('Usage: CASSETTE_MODE=record node --experimental-strip-types scripts/record_cassettes.ts <case_id>');
    process.exit(1);
  }

  const mode = getCassetteMode();
  if (mode !== 'record') {
    console.error(`Warning: CASSETTE_MODE is "${mode}", expected "record". Forcing record mode.`);
    process.env.CASSETTE_MODE = 'record';
  }

  // Load the eval case
  const casePath = join(__dirname, `../fixtures/eval_cases`);
  let caseFile: string | null = null;
  for (const cat of ['rich', 'thin', 'empty', 'adversarial']) {
    const p = join(casePath, cat, `${caseId}.json`);
    if (existsSync(p)) {
      caseFile = p;
      break;
    }
  }

  if (!caseFile) {
    console.error(`Case "${caseId}" not found in fixtures/eval_cases`);
    process.exit(1);
  }

  const evalCase = JSON.parse(readFileSync(caseFile, 'utf8')) as {
    id: string;
    request: { target_name: string; slots: any[] };
  };

  console.error(`[record] Recording case: ${evalCase.id}`);

  // Ensure DB is ready
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
  } catch {
    console.error('[record] DB not ready. Running migrations...');
    execSync('npm run migrate', { cwd: join(__dirname, '..'), stdio: 'inherit' });
  }

  const pipelineOpts = {
    deepinfra: {
      baseUrl: process.env.DEEPINFRA_BASE_URL ?? 'https://api.deepinfra.com/v1/openai',
      apiKey: process.env.DEEPINFRA_API_KEY ?? '',
      model: process.env.MODEL_NAME ?? 'google/gemma-4-26B-A4B-it',
    },
    search: {
      apiKey: process.env.SEARCH_API_KEY ?? 'dummy',
    },
    fetch: {
      maxBytes: 1048576,
    },
    budgets: {
      max_queries_per_run: Number(process.env.MAX_QUERIES_PER_RUN ?? 20),
      max_fetches_per_run: Number(process.env.MAX_FETCHES_PER_RUN ?? 30),
      max_fetch_bytes: 1048576,
    },
    coverage: {
      maxIterations: Number(process.env.COVERAGE_MAX_ITERATIONS ?? 3),
      confidenceFloor: Number(process.env.COVERAGE_CONFIDENCE_FLOOR ?? 0.6),
    },
  };

  const result = await runPipeline(evalCase.id, evalCase.request, pipelineOpts);
  console.error(`[record] Pipeline status: ${result.status}`);
  console.error(`[record] Evidence items: ${result.evidence.length}`);
  console.error(`[record] Signals: ${result.signals.length}`);

  // Flush cassette
  flushCassette(evalCase.id);
  console.error(`[record] Cassette flushed for ${evalCase.id}`);

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
