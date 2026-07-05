import { describe, it, expect } from 'vitest';
import { extractMainContent } from '../src/extraction_sidecar.js';

describe('extractMainContent', () => {
  it('extracts title and main text from a simple article', () => {
    const html = `
      <html>
        <head><title>Acme Corp Overview</title></head>
        <body>
          <nav>Home | About | Contact</nav>
          <article>
            <h1>Acme Corp</h1>
            <p>Acme Corp is a leading provider of widgets and gadgets. Founded in 1999, the company has grown rapidly.</p>
            <p>They serve over 10,000 customers worldwide with a team of 500 employees across 12 offices.</p>
            <p>Their flagship product line includes the TurboWidget series which revolutionized the industry when launched in 2015.</p>
            <p>Recent funding rounds have brought the company to a $500M valuation led by top-tier venture capital firms.</p>
            <p>The company focuses on sustainable manufacturing practices and has pledged carbon neutrality by 2030.</p>
            <p>Acme Corp has expanded into adjacent markets including cloud services, enterprise software, and consumer electronics.</p>
            <p>Their customer base spans Fortune 500 companies, government agencies, and small businesses needing reliable widget solutions.</p>
            <p>Acme Corp was recognized as Industry Innovator of the Year by the Global Widget Association for three consecutive years.</p>
          </article>
          <footer>Copyright 2024</footer>
        </body>
      </html>
    `;

    const result = extractMainContent(html, 'https://example.com/acme');

    expect(result.title).toBe('Acme Corp Overview');
    expect(result.mainText).toContain('Acme Corp');
    expect(result.mainText).toContain('TurboWidget');
    expect(result.wordCount).toBeGreaterThan(40);
    expect(result.confidence).toBe('high');
  });

  it('handles empty input gracefully', () => {
    const result = extractMainContent('');
    expect(result.title).toBe('');
    expect(result.mainText).toBe('');
    expect(result.wordCount).toBe(0);
    expect(result.confidence).toBe('low');
  });

  it('penalizes high-link-density blocks', () => {
    const html = `
      <html>
        <head><title>Spam Page</title></head>
        <body>
          <div>
            <a href="1">link1</a> <a href="2">link2</a> <a href="3">link3</a>
            <a href="4">link4</a> <a href="5">link5</a> <a href="6">link6</a>
            Some real content here but dominated by links.
          </div>
          <article>
            <p>This is the actual article with substantial text content about a company that should be extracted by the sidecar extractor.</p>
            <p>More text here to make the word count higher and link density lower. No links in this section at all.</p>
            <p>The company operates in multiple jurisdictions and employs thousands of workers across several continents.</p>
            <p>They have received numerous industry awards for innovation and sustainability in their product categories.</p>
            <p>Growth has accelerated since the public offering and partnerships with major technology platforms.</p>
          </article>
        </body>
      </html>
    `;

    const result = extractMainContent(html);
    expect(result.mainText).toContain('actual article');
    expect(result.confidence).toBe('high');
  });

  it('handles very short pages with fallback', () => {
    const html = '<html><body><p>Short.</p></body></html>';
    const result = extractMainContent(html);
    expect(result.mainText).toContain('Short');
    expect(result.confidence).toBe('low');
  });

  it('decodes common HTML entities', () => {
    const html = `
      <html><head><title>Acme &amp; Co</title></head>
      <body><article><p>Revenue exceeds $1M&nbsp;with 99%&nbsp;uptime.</p></article></body></html>
    `;
    const result = extractMainContent(html);
    expect(result.title).toBe('Acme & Co');
    expect(result.mainText).toContain('$1M with');
  });

  it('strips scripts and styles', () => {
    const html = `
      <html><head><title>Clean</title><style>.x{color:red}</style></head>
      <body>
        <script>alert('evil');</script>
        <article><p>Good content only.</p></article>
        <noscript>track you</noscript>
      </body></html>
    `;
    const result = extractMainContent(html);
    expect(result.mainText).not.toContain('evil');
    expect(result.mainText).not.toContain('track');
    expect(result.mainText).toContain('Good content only');
  });

  it('truncates output at hard cap', () => {
    const longText = 'word '.repeat(3000);
    const html = `<html><body><article><p>${longText}</p></article></body></html>`;
    const result = extractMainContent(html);
    expect(result.mainText.length).toBeLessThanOrEqual(12000);
  });
});
