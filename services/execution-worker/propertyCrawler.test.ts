import { describe, expect, it } from 'vitest';
import { extractPage } from './propertyCrawler';

describe('VPS property crawler', () => {
  it('extracts auditable SEO and link data from a page', () => {
    const parsed = extractPage(`<!doctype html><html lang="en"><head><title>Useful page title for a real search result</title><meta name="description" content="A sufficiently detailed description of this page that explains what visitors will find when they open it from a search result listing."><meta name="robots" content="index,follow"><link rel="canonical" href="/guide"><script type="application/ld+json">{"@type":"Article","datePublished":"2026-01-02"}</script></head><body><h1>Guide</h1><h2>Details</h2><a href="/next">Next</a><a href="https://other.test/source">Source</a><img src="hero.jpg">${'<p>word '.repeat(120)}</body></html>`, new URL('https://site.test/guide'), 200, 'text/html');
    expect(parsed.title).toContain('Useful page');
    expect(parsed.canonical).toBe('https://site.test/guide');
    expect(parsed.internalLinks).toEqual(['https://site.test/next']);
    expect(parsed.externalLinks).toEqual(['https://other.test/source']);
    expect(parsed.structuredDataTypes).toEqual(['Article']);
    expect(parsed.imagesMissingAlt).toBe(1);
    expect(parsed.indexable).toBe(true);
    expect(parsed.wordCount).toBeGreaterThan(100);
  });
});
