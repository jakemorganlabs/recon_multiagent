/**
 * Main-Content Extraction Sidecar
 *
 * A lightweight HTML-to-text extractor. Finds the dominant content
 * block (<article>, <main>, or <body>), strips noise elements
 * explicitly, decodes entities, and returns clean text.
 *
 *
 */

export interface ExtractionResult {
  title: string;
  mainText: string;
  wordCount: number;
  confidence: 'high' | 'medium' | 'low';
}

/** Extract main content from raw HTML. */
export function extractMainContent(html: string, _url?: string): ExtractionResult {
  if (!html || html.trim().length === 0) {
    return { title: '', mainText: '', wordCount: 0, confidence: 'low' };
  }

  // 1. Extract title before any stripping
  const title = extractTitle(html);

  // 2. Remove <head> entirely
  let text = removeTagAndContent(html, 'head');

  // 3. Strip noise elements and their children
  text = removeTagAndContent(text, 'script');
  text = removeTagAndContent(text, 'style');
  text = removeTagAndContent(text, 'noscript');
  text = removeTagAndContent(text, 'nav');
  text = removeTagAndContent(text, 'header');
  text = removeTagAndContent(text, 'footer');
  text = removeTagAndContent(text, 'aside');
  text = removeComments(text);

  // 4. Find the best content container
  const content = extractTagContent(text, 'article')
    ?? extractTagContent(text, 'main')
    ?? extractTagContent(text, 'body')
    ?? text;

  // 5. Strip all remaining tags, decode entities, clean
  let clean = stripTags(content);
  clean = decodeHtmlEntities(clean);
  clean = clean.replace(/\s+/g, ' ').trim();

  const mainText = clean.slice(0, 12000);
  const wordCount = mainText.split(/\s+/).filter(Boolean).length;

  const confidence: 'high' | 'medium' | 'low' =
    wordCount > 80 ? 'high' : wordCount > 20 ? 'medium' : 'low';

  return { title, mainText, wordCount, confidence };
}

/** Extract text from <title> element. */
function extractTitle(html: string): string {
  const idx = html.toLowerCase().indexOf('<title');
  if (idx === -1) return '';
  const start = html.indexOf('>', idx) + 1;
  const end = html.toLowerCase().indexOf('</title>', start);
  if (end === -1) return '';
  return decodeHtmlEntities(html.slice(start, end).trim());
}

/** Remove an HTML element and everything inside it (case-insensitive). */
function removeTagAndContent(html: string, tagName: string): string {
  const open = `<${tagName.toLowerCase()}`;
  const close = `</${tagName.toLowerCase()}>`;
  const upperClose = `</${tagName.toUpperCase()}>`;

  let result = html;
  let idx = findCaseInsensitive(result, open);

  while (idx !== -1) {
    const tagEnd = result.indexOf('>', idx);
    if (tagEnd === -1) break;

    const closeIdx = result.toLowerCase().indexOf(close, tagEnd);
    const upperCloseIdx = upperClose === close ? -1 : result.indexOf(upperClose, tagEnd);
    const endIdx = closeIdx !== -1 ? closeIdx : upperCloseIdx;
    if (endIdx === -1) break;

    result = result.slice(0, idx) + ' ' + result.slice(endIdx + close.length);
    idx = findCaseInsensitive(result, open);
  }

  return result;
}

/** Find case-insensitive index of a substring. */
function findCaseInsensitive(haystack: string, needle: string): number {
  const lower = haystack.toLowerCase();
  return lower.indexOf(needle);
}

/** Extract inner text of a specific tag (first occurrence, case-insensitive). */
function extractTagContent(html: string, tagName: string): string | null {
  const idx = findCaseInsensitive(html, `<${tagName.toLowerCase()}`);
  if (idx === -1) return null;
  const contentStart = html.indexOf('>', idx) + 1;
  if (contentStart === 0) return null;
  const endIdx = html.toLowerCase().indexOf(`</${tagName.toLowerCase()}>`, contentStart);
  if (endIdx === -1) return null;
  return html.slice(contentStart, endIdx);
}

/** Strip HTML comments. */
function removeComments(html: string): string {
  let result = html;
  let idx = result.indexOf('<!--');
  while (idx !== -1) {
    const end = result.indexOf('-->', idx);
    if (end === -1) break;
    result = result.slice(0, idx) + ' ' + result.slice(end + 3);
    idx = result.indexOf('<!--');
  }
  return result;
}

/** Replace all HTML tags with a single space. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ');
}

/** Decode common named HTML entities and numeric entities. */
function decodeHtmlEntities(text: string): string {
  const map: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
    '&#8212;': '—',
    '&#8211;': '–',
    '&#8230;': '…',
    '&#8216;': '\\u2018',
    '&#8217;': '\\u2019',
    '&#8220;': '"',
    '&#8221;': '"',
  };
  // Named entities
  let out = text.replace(/&(?:#[\d]+|[a-zA-Z0-9]+);/g, (m) => map[m] ?? m);

  // Numeric decimal entities (e.g. &#36; -> $)
  out = out.replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));

  // Numeric hex entities (e.g. &#x24; -> $)
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));

  return out;
}
