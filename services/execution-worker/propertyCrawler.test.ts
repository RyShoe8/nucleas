import { describe, expect, it } from 'vitest';
import { archivedPage, createRoutePatternResolver, extractPage, resolveCrawlScope, routePattern, templateIdentity } from './propertyCrawler';

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

  it('groups semantic page families instead of splitting on content differences', () => {
    expect(routePattern(new URL('https://playbound.club/games/8bit-killer'))).toBe('/games/:item');
    expect(routePattern(new URL('https://playbound.club/games/castlevania-revamped'))).toBe('/games/:item');
    expect(routePattern(new URL('https://playbound.club/games/8bit-killer/controls'))).toBe('/games/:item/controls');
    expect(routePattern(new URL('https://playbound.club/games/8bit-killer/editions/openra-plus'))).toBe('/games/:item/editions/:item');
    expect(routePattern(new URL('https://playbound.club/hosting/0ad'))).toBe('/hosting/:item');
    expect(templateIdentity('<main><h1>First game</h1></main>', new URL('https://playbound.club/games/first-game')))
      .toBe(templateIdentity('<main><section><h1>Second game</h1></section></main>', new URL('https://playbound.club/games/second-game')));
    expect(templateIdentity('<main><h1>Controls</h1></main>', new URL('https://playbound.club/games/first-game/controls')))
      .not.toBe(templateIdentity('<main><h1>Game</h1></main>', new URL('https://playbound.club/games/first-game')));
    expect(templateIdentity('<main><h1>Developer one</h1></main>', new URL('https://playbound.club/developers/first-studio')))
      .toBe(templateIdentity('<article><section>Different markup</section></article>', new URL('https://playbound.club/developers/second-studio')));
    expect(templateIdentity('<main><h1>Mod one</h1></main>', new URL('https://playbound.club/mods/first-mod')))
      .toBe(templateIdentity('<article><section>Different markup</section></article>', new URL('https://playbound.club/mods/second-mod')));
  });

  it('learns template families from any sitemap instead of a property-specific route list', () => {
    const urls = [
      ...['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((slug) => `https://store.test/catalog/${slug}`),
      ...['one', 'two', 'three', 'four', 'five'].map((slug) => `https://store.test/catalog/${slug}/reviews/editor-${slug}`),
      ...['first', 'second'].map((slug) => `https://publisher.test/articles/${slug}`),
    ];
    const resolve = createRoutePatternResolver(urls);

    expect(resolve(new URL('https://store.test/catalog/alpha'))).toBe('/catalog/:item');
    expect(resolve(new URL('https://store.test/catalog/alpha/reviews/editor-alpha'))).toBe('/catalog/:item/reviews/:item');
    expect(resolve(new URL('https://publisher.test/articles/first'))).toBe('/articles/:item');
  });

  it('stores extracted SEO evidence without duplicating raw page bodies', () => {
    const extracted = extractPage('<html><body><h1>Stored evidence</h1></body></html>', new URL('https://site.test/page'), 200, 'text/html');
    const archived = archivedPage({ ...extracted, renderedText: 'Rendered body text' });

    expect(archived).not.toHaveProperty('htmlSnapshot');
    expect(archived).not.toHaveProperty('renderedText');
    expect(archived.h1).toEqual(['Stored evidence']);
  });

  it('treats submitted sitemap URLs as the authoritative crawl scope', () => {
    const scope = resolveCrawlScope('https://site.test/', ['https://site.test/indexed', 'https://site.test/indexed']);

    expect(scope).toEqual({ urls: ['https://site.test/indexed'], source: 'sitemap', followInternalLinks: false });
  });

  it('falls back to internal-link discovery only when no sitemap pages exist', () => {
    const scope = resolveCrawlScope('https://site.test/', []);

    expect(scope).toEqual({ urls: ['https://site.test/'], source: 'link-discovery', followInternalLinks: true });
  });
});
