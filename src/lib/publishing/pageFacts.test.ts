import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { extractPageFacts, structuredCoverImage } from './pageFacts';

const PAGE = 'https://playbound.club/games/wreckage';
const page = (head: string, body = '<main><p>Hello</p></main>') => `<html><head><title>Wreckage</title>${head}</head><body>${body}</body></html>`;
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const OG = '<meta property="og:image" content="https://playbound.club/games/wreckage/opengraph-image"/>';

describe('page cover image', () => {
  it('prioritizes complete editorial paragraphs over navigation and truncated metadata', () => {
    const about = 'Pass the ball between animal teammates and aim for the opposing goal in short physics-based matches.';
    const modes = 'Play one against one or bring more players for matches with up to three on each side.';
    const facts = extractPageFacts(page('<meta property="og:description" content="A sports game…">', `<main>Navigation <section><h2>About Sport Animals</h2><p>${about}</p><p>${modes}</p></section><section><h2>Related games</h2><p>Unrelated suggestions should never become the gameplay description.</p></section></main>`), PAGE);
    expect(facts.editorialText).toBe(`${about}\n\n${modes}`);
    expect(facts.text.startsWith(about)).toBe(true);
    expect(facts.editorialText).not.toContain('Unrelated');
  });
  it('uses the game’s own cover from its structured data instead of the generated share image', () => {
    const html = page(OG + ld({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization', image: 'https://playbound.club/org.png' }, { '@type': 'VideoGame', name: 'Wreckage', image: 'https://media.moddb.com/images/mods/1/17/16502/cover.jpg' }] }));
    expect(extractPageFacts(html, PAGE).image).toBe('https://media.moddb.com/images/mods/1/17/16502/cover.jpg');
  });

  it('reads image objects and arrays, resolves relative links, and skips unsafe or SVG images', () => {
    expect(structuredCoverImage(page(ld({ '@type': 'VideoGame', image: [{ '@type': 'ImageObject', url: '/covers/a.png' }] })), PAGE)).toBe('https://playbound.club/covers/a.png');
    expect(structuredCoverImage(page(ld({ '@type': 'Product', image: 'https://x.example/logo.svg' })), PAGE)).toBeNull();
    expect(structuredCoverImage(page(ld({ '@type': 'Product', image: 'http://insecure.example/a.png' })), PAGE)).toBeNull();
  });

  it('falls back to og:image when the page declares no cover, and ignores broken or organization-only data', () => {
    expect(extractPageFacts(page(OG), PAGE).image).toBe('https://playbound.club/games/wreckage/opengraph-image');
    expect(extractPageFacts(page(OG + '<script type="application/ld+json">{not json</script>' + ld({ '@type': 'Organization', image: 'https://playbound.club/org.png' })), PAGE).image).toBe('https://playbound.club/games/wreckage/opengraph-image');
  });
});
