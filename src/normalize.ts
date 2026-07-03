/**
 * Snippet normalization
 *
 * Rules (applied in order):
 * 1. Normalize Unicode to NFC.
 * 2. Replace zero-width characters (U+200B–U+200F, U+FEFF) with nothing.
 * 3. Fold smart quotes / dashes / ellipses to ASCII.
 * 4. Collapse horizontal whitespace runs (space, tab, NBSP) to a single space.
 * 5. Trim leading and trailing whitespace.
 */

// Zero-width space contributes to whitespace collapse; others are stripped.
const ZERO_WIDTH_SPACE = /\u200B/g;
const ZERO_WIDTH_OTHER = /[\u200C-\u200F\uFEFF]/g;

const SMART_TO_ASCII: [RegExp, string][] = [
  [/\u2018|\u2019/g, "'"],
  [/\u201C|\u201D/g, '"'],
  [/\u2013/g, '-'],
  [/\u2014/g, '--'],
  [/\u2026/g, '...'],
  [/\u00A0/g, ' '],
];

export function normalizeSnippet(input: string): string {
  let s = input.normalize('NFC');

  // Treat zero-width space as a break point (collapses to regular space)
  s = s.replace(ZERO_WIDTH_SPACE, ' ');
  // Strip other zero-width characters
  s = s.replace(ZERO_WIDTH_OTHER, '');

  for (const [re, replacement] of SMART_TO_ASCII) {
    s = s.replace(re, replacement);
  }

  // Collapse any horizontal whitespace run (space, tab, NBSP) to a single space
  s = s.replace(/[\s\t\u00A0]+/g, ' ');

  return s.trim();
}
