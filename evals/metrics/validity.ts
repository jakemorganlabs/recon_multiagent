/**
 * Metric 2: Structural Validity
 *
 * Measures per-agent schema-pass rates:
 * - Brief: brief.schema.json validation
 * - Analyst: signal.schema.json validation
 * - Synthesis: dossier.schema.json validation
 *
 *
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSchema(name: string) {
  return JSON.parse(readFileSync(join(__dirname, '../../schemas', name), 'utf8'));
}

const ajv = new Ajv2020({ strict: false, allErrors: true });

const validators = {
  brief: ajv.compile(loadSchema('brief.schema.json')),
  signal: ajv.compile(loadSchema('signal.schema.json')),
  dossier: ajv.compile(loadSchema('dossier.schema.json')),
};

export interface ValidityInput {
  brief?: unknown;
  signals?: unknown[];
  dossier?: unknown;
}

export interface ValidityResult {
  brief: number;    // 0 or 1
  analyst: number;  // avg pass rate across signals
  synthesis: number; // 0 or 1
  overall: number; // weighted avg
}

export function computeStructuralValidity(input: ValidityInput): ValidityResult {
  const briefScore = input.brief && validators.brief(input.brief) ? 1 : 0;

  let signalScore = 0;
  if (input.signals && input.signals.length > 0) {
    let pass = 0;
    for (const s of input.signals) {
      if (validators.signal(s)) pass++;
    }
    signalScore = pass / input.signals.length;
  } else {
    signalScore = 1; // vacuous pass when no signals
  }

  const dossierScore = input.dossier && validators.dossier(input.dossier) ? 1 : 0;

  // Weighted: brief 0.2, analyst 0.4, synthesis 0.4
  const overall = briefScore * 0.2 + signalScore * 0.4 + dossierScore * 0.4;

  return {
    brief: briefScore,
    analyst: signalScore,
    synthesis: dossierScore,
    overall,
  };
}
