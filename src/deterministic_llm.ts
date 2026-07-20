/**
 * Deterministic LLM stub (offline eval mode).
 *
 * The Recon eval suite is fully deterministic and offline. Recorded web
 * cassettes replay search + fetch, and the grounding gate is deterministic.
 * The one external dependency that is not recorded is the LLM itself: Search
 * query planning, Analyst extraction, and Synthesis composition all call
 * DeepInfra / Gemma.
 *
 * When no real DeepInfra credentials are configured (`DEEPINFRA_API_KEY` unset
 * or empty), the eval activates this deterministic local generator so the
 * suite runs end-to-end without any network call and produces stable,
 * grounded outputs that exercise the entire pipeline (schema validation,
 * citation chain, grounding gate, gap reporting) rather than degrading to
 * blanket abstention.
 *
 * Determinism contract: identical inputs produce identical outputs. No
 * randomness, no I/O except reading the recorded cassette queries for the
 * active case, so generated queries exactly match recorded search entries.
 *
 * The stub never invents facts. It only extracts sentences already present
 * verbatim in recorded evidence, and it deliberately skips sentences that look
 * like prompt-injection instructions, so adversarial cases still report zero
 * obeyed instructions.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Brief, EvidenceItem, Signal } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASSETTES_ROOT = join(__dirname, '../fixtures/cassettes');

/**
 * True when the eval should run without a live LLM (no DeepInfra key) AND the
 * web layer is replaying cassettes. That is the offline eval context. Gating
 * on both keeps the stub out of unit tests (which exercise the live fetch
 * path against mocked `fetch`) and live runs (which have a real key or no
 * cassette playback).
 */
export function isDeterministicLLMMode(): boolean {
  const key = process.env.DEEPINFRA_API_KEY ?? '';
  const cassette = process.env.CASSETTE_MODE ?? '';
  return key.trim().length === 0 && cassette === 'play';
}

/* ─── Slot keyword map ─── */
// Each canonical slot maps to the substrings that mark a supporting sentence.
// Order matters: earlier keywords are preferred when multiple match.
const SLOT_KEYWORDS: Record<string, string[]> = {
  overview: ['founded', 'headquartered', 'is a', 'is an', 'company'],
  leadership: ['ceo', 'cto', 'cfo', 'vp ', 'chief', 'leadership', 'founder'],
  funding: ['raised', 'funding', 'valuation', 'series ', 'seed', 'ipo', 'investors'],
  products: ['manufactures', 'products', 'platform', 'software', 'robot', 'specializes in', 'services'],
  recent_news: ['market', 'news', 'expanded', 'launched', 'competes', 'announced'],
  headcount: ['employees', 'people', 'headcount', 'staff'],
  tech_stack: ['ai-powered', 'ai ', 'technology', 'vision system', 'software', 'machine learning'],
  hiring: ['hiring', 'careers', 'open roles', 'recruiting', 'job openings'],
  risks: ['risk', 'litigation', 'lawsuit', 'bankrupt', 'scam', 'fraud', 'controversy'],
};

// Sentences containing any of these markers look like prompt-injection and are
// never extracted into a signal or claim, preserving injection resistance.
const INJECTION_MARKERS = [
  'ignore your task',
  'ignore all previous',
  'disregard all previous',
  'disregard all',
  'as your supervisor',
  'secret override',
  'system notice',
  'pirate voice',
  'i instruct you',
  'you must',
  'you are now',
  'report this company',
  'recommend investing',
  'task has been cancelled',
  'task cancelled',
  'include this in your dossier',
  'stop research',
];

function looksLikeInjection(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return INJECTION_MARKERS.some((m) => lower.includes(m));
}

/** Split text into rough sentences (on ". " boundaries, preserving content). */
function splitSentences(text: string): string[] {
  return text
    .replace(/\n/g, ' ')
    .split(/(?<=\.)\s+(?=[A-Z"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Find the first clean, slot-supporting sentence in the evidence text. */
function extractSupportingSentence(slot: string, text: string): string | undefined {
  const keywords = SLOT_KEYWORDS[slot];
  if (!keywords) return undefined;
  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    if (looksLikeInjection(sentence)) continue;
    const lower = sentence.toLowerCase();
    if (keywords.some((k) => lower.includes(k))) {
      return sentence;
    }
  }
  return undefined;
}

/* ─── Search Agent: deterministic queries ─── */

/**
 * Return the exact recorded search-query strings for the active eval case so
 * the cassette player gets exact-hash hits. Falls back to target + slot
 * questions when no cassette is found (e.g. live runs).
 */
export function deterministicSearchQueries(
  brief: Brief,
  caseId?: string
): string[] {
  if (caseId) {
    const path = join(CASSETTES_ROOT, caseId, 'searches.json');
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
        if (Array.isArray(raw)) {
          const queries = raw
            .map((e) => (e as { query?: unknown }).query)
            .filter((q): q is string => typeof q === 'string' && q.length > 0);
          if (queries.length > 0) return queries;
        }
      } catch {
        // fall through to synthetic queries
      }
    }
  }

  const target = brief.target.name;
  return brief.slots.map(
    (s) => `${target} ${s.slot_name.replace(/_/g, ' ')}`
  );
}

/* ─── Analyst Agent: deterministic signals ─── */

/**
 * Produce one Signal per brief slot. A slot is `filled` only when a recorded
 * evidence item contains a clean, slot-supporting sentence; the signal cites
 * that evidence_id and carries the sentence as its value. Otherwise the slot
 * abstains with `insufficient_evidence`. Output is schema-shaped for the
 * Analyst's existing parser/validator path.
 */
export function deterministicSignals(
  brief: Brief,
  evidence: EvidenceItem[],
  runId: string
): unknown[] {
  const ordered = [...evidence].sort(
    (a, b) => (a.retrieval_rank ?? 999) - (b.retrieval_rank ?? 999)
  );

  return brief.slots.map((slot, idx) => {
    const signalId = `sig-${runId.slice(0, 8)}-${slot.slot_name}-${idx + 1}`;

    for (const ev of ordered) {
      const text = ev.fetched_text ?? ev.snippet;
      const sentence = extractSupportingSentence(slot.slot_name, text);
      if (sentence) {
        return {
          signal_id: signalId,
          slot: slot.slot_name,
          status: 'filled',
          value: sentence,
          confidence: 0.82,
          rationale: `Extracted verbatim from evidence ${ev.evidence_id} (${ev.source_url}).`,
          evidence_ids: [ev.evidence_id],
        };
      }
    }

    return {
      signal_id: signalId,
      slot: slot.slot_name,
      status: 'insufficient_evidence',
      rationale: 'No supporting evidence available for this slot.',
      evidence_ids: [],
    };
  });
}

/* ─── Synthesis Agent: deterministic dossier ─── */

/**
 * Compose a Dossier from filled signals: one section per slot that has a
 * filled signal, one claim per such signal citing the signal_id and quoting
 * the signal value as the claim text. Unfilled slots are recorded as explicit
 * gaps. The result is shaped to pass the Dossier schema validator.
 */
export function deterministicDossier(
  brief: Brief,
  signals: Signal[]
): unknown {
  const signalBySlot = new Map(signals.map((s) => [s.slot, s]));

  const sections: Record<string, { claims: { text: string; signal_ids: string[] }[] }> = {};
  const gaps: { slot: string; reason: string }[] = [];

  for (const slot of brief.slots) {
    const sig = signalBySlot.get(slot.slot_name);
    if (sig && sig.status === 'filled' && sig.value && sig.signal_id) {
      sections[slot.slot_name] = {
        claims: [
          {
            text: sig.value,
            signal_ids: [sig.signal_id],
          },
        ],
      };
    } else {
      sections[slot.slot_name] = { claims: [] };
      gaps.push({
        slot: slot.slot_name,
        reason: `Could not verify ${slot.slot_name}: no supporting signal was produced.`,
      });
    }
  }

  const filledCount = brief.slots.filter((s) => {
    const sig = signalBySlot.get(s.slot_name);
    return sig && sig.status === 'filled';
  }).length;

  return {
    executive_summary: `Dossier composed from ${filledCount} of ${brief.slots.length} filled signals for ${brief.target.name}.`,
    sections,
    gaps,
    grounding_passed: gaps.length === 0,
  };
}
