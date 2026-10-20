import { describe, expect, it } from 'vitest';
import { choosePrefix, discoverSiteSource, entriesUnder, feedCandidates, listSitePages, newestFirst, nounForPrefix, nounFromRequest, parseFeed, pathGroups } from './siteSource';

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://playbound.club/</loc></url>
  <url><loc>https://playbound.club/games</loc></url>
  <url><loc>https://playbound.club/games/deus-ex</loc><lastmod>2026-10-10</lastmod></url>
  <url><loc>https://playbound.club/games/openra</loc><lastmod>2026-09-01</lastmod></url>
  <url><loc>https://playbound.club/games/openra/servers</loc></url>
  <url><loc>https://playbound.club/blog/patch-notes</loc></url>
  <url><loc>https://playbound.club/games/factorio?ref=a&amp;b=c</loc></url>
</urlset>`;

describe('parseFeed', () => {
  it('reads sitemaps, decoding entities and dates', () => {
    const parsed = parseFeed(SITEMAP);
    expect(parsed.kind).toBe('sitemap');
    if (parsed.kind !== 'sitemap') return;
    expect(parsed.entries).toHaveLength(7);
    expect(parsed.entries[2]).toEqual({ url: 'https://playbound.club/games/deus-ex', date: new Date('2026-10-10'), title: null });
    expect(parsed.entries[6]!.url).toBe('https://playbound.club/games/factorio?ref=a&b=c');
  });

  it('reads sitemap indexes, RSS and Atom', () => {
    expect(parseFeed('<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap><sitemap><loc>https://a.com/s2.xml</loc></sitemap></sitemapindex>')).toEqual({ kind: 'sitemap_index', sitemaps: ['https://a.com/s1.xml', 'https://a.com/s2.xml'] });
    const rss = parseFeed('<rss><channel><item><title><![CDATA[Deus Ex & co]]></title><link>https://a.com/games/deus-ex</link><pubDate>Sat, 10 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>');
    expect(rss).toEqual({ kind: 'rss', entries: [{ url: 'https://a.com/games/deus-ex', date: new Date('2026-10-10T12:00:00Z'), title: 'Deus Ex & co' }] });
    const atom = parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>X</title><link rel="alternate" href="https://a.com/x"/><published>2026-10-01T00:00:00Z</published></entry></feed>');
    expect(atom).toEqual({ kind: 'atom', entries: [{ url: 'https://a.com/x', date: new Date('2026-10-01T00:00:00Z'), title: 'X' }] });
    expect(parseFeed('<html></html>')).toEqual({ kind: 'unknown' });
  });
});

describe('choosing the section', () => {
  const parsed = parseFeed(SITEMAP);
  const entries = parsed.kind === 'sitemap' ? parsed.entries : [];

  it('groups pages one level under a section', () => {
    expect(pathGroups(entries)).toEqual([{ prefix: '/games/', count: 3 }, { prefix: '/blog/', count: 1 }]);
  });

  it('matches the words of the request, singular or plural, or an explicit address', () => {
    const groups = pathGroups(entries);
    expect(choosePrefix('Post every new game to our socials', groups)).toBe('/games/');
    expect(choosePrefix('Share new games on Bluesky', groups)).toBe('/games/');
    expect(choosePrefix('Announce posts at playbound.club/blog on Reddit', groups)).toBe('/blog/');
    expect(choosePrefix('Post new things to social', groups)).toBeNull();
  });

  it('names one item after its section', () => {
    expect(nounForPrefix('/games/')).toBe('game');
    expect(nounForPrefix('/stories/')).toBe('story');
    expect(nounForPrefix('/case-studies/')).toBe('case study');
    // "news" is not the plural of "new".
    expect(nounForPrefix('/news/')).toBe('article');
    expect(nounForPrefix('/blog/')).toBe('post');
  });

  it('uses the word the person used for one item', () => {
    expect(nounFromRequest('Post one article from frugalgambler.club/news every 3 weeks')).toBe('article');
    expect(nounFromRequest('share an evergreen guide every other week')).toBe('guide');
    expect(nounFromRequest('post each new game to Facebook')).toBe('game');
    expect(nounFromRequest('post to Facebook every week')).toBeNull();
  });

  it('keeps only direct pages under the section on the same host, once each', () => {
    const under = entriesUnder([...entries, { url: 'https://www.playbound.club/games/deus-ex/', date: null, title: null }, { url: 'https://evil.example/games/x', date: null, title: null }], '/games/', 'playbound.club');
    expect(under.map((e) => e.url)).toEqual(['https://playbound.club/games/deus-ex', 'https://playbound.club/games/openra', 'https://playbound.club/games/factorio?ref=a&b=c']);
  });

  it('puts dated entries newest first, then undated ones last-listed first', () => {
    const order = newestFirst([
      { url: 'a', date: new Date('2026-01-01'), title: null },
      { url: 'b', date: null, title: null },
      { url: 'c', date: new Date('2026-05-01'), title: null },
      { url: 'd', date: null, title: null },
    ]).map((e) => e.url);
    expect(order).toEqual(['c', 'a', 'd', 'b']);
  });

  it('finds feeds the homepage links to, then robots.txt sitemaps, then the usual places', () => {
    const list = feedCandidates('https://a.com', '<link rel="alternate" type="application/rss+xml" href="/games/feed.xml">', 'User-agent: *\nSitemap: https://a.com/sitemap-games.xml');
    expect(list.slice(0, 3)).toEqual(['https://a.com/games/feed.xml', 'https://a.com/sitemap-games.xml', 'https://a.com/sitemap.xml']);
  });
});

function fakeSite(files: Record<string, string>) {
  return async (url: string) => {
    const body = files[url];
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body, { status: 200, headers: { 'content-type': 'application/xml' } });
  };
}

describe('discovering a site source', () => {
  it('finds the section the request names through robots.txt and a sitemap index', async () => {
    const fetcher = fakeSite({
      'https://playbound.club/': '<html></html>',
      'https://playbound.club/robots.txt': 'Sitemap: https://playbound.club/sitemap_index.xml',
      'https://playbound.club/sitemap_index.xml': '<sitemapindex><sitemap><loc>https://playbound.club/sitemap-pages.xml</loc></sitemap><sitemap><loc>https://playbound.club/sitemap-games.xml</loc></sitemap></sitemapindex>',
      'https://playbound.club/sitemap-pages.xml': '<urlset><url><loc>https://playbound.club/about/team</loc></url></urlset>',
      'https://playbound.club/sitemap-games.xml': SITEMAP,
    });
    const found = await discoverSiteSource({ domain: 'playbound.club', brief: 'When a new game is published, post it to our socials', fetcher });
    expect(found).toMatchObject({ ok: true, feedUrl: 'https://playbound.club/sitemap_index.xml', feedKind: 'sitemap', pathPrefix: '/games/', noun: 'game', count: 3 });
    if (found.ok) expect(found.newest?.url).toBe('https://playbound.club/games/deus-ex');
    const pages = await listSitePages({ feedUrl: 'https://playbound.club/sitemap_index.xml', pathPrefix: '/games/' }, fetcher);
    expect(pages.map((p) => p.url)[0]).toBe('https://playbound.club/games/deus-ex');
  });

  it('asks the model when the words do not match, and explains when nothing does', async () => {
    const fetcher = fakeSite({ 'https://a.com/sitemap.xml': '<urlset><url><loc>https://a.com/titles/one</loc></url><url><loc>https://a.com/titles/two</loc></url></urlset>' });
    const picked = await discoverSiteSource({ domain: 'a.com', brief: 'Post each new release to social', fetcher, pick: async () => '/titles/' });
    expect(picked).toMatchObject({ ok: true, pathPrefix: '/titles/', noun: 'title' });
    const none = await discoverSiteSource({ domain: 'a.com', brief: 'Post each new release to social', fetcher, pick: async () => null });
    expect(none).toEqual({ ok: false, error: expect.stringContaining('a.com/titles/') });
    const nothing = await discoverSiteSource({ domain: 'b.com', brief: 'Post new games', fetcher });
    expect(nothing).toEqual({ ok: false, error: expect.stringContaining('could not find a sitemap or feed') });
  });

  it('never follows a redirect to a private address', async () => {
    const fetcher = async (url: string) =>
      url === 'https://a.com/sitemap.xml' ? new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest' } }) : new Response('nope', { status: 404 });
    const found = await discoverSiteSource({ domain: 'a.com', brief: 'Post new games', fetcher });
    expect(found.ok).toBe(false);
  });
});

describe('source fetch resilience', () => {
  it('retries a timeout and reads the sitemap instead of failing the dry run', async () => {
    let calls = 0;
    const entries = await listSitePages({ feedUrl: 'https://playbound.club/sitemap.xml', pathPrefix: '/games/' }, async () => {
      calls += 1;
      if (calls === 1) throw new DOMException('Request timed out', 'TimeoutError');
      return new Response(SITEMAP);
    });
    expect(calls).toBe(2);
    expect(entries.length).toBeGreaterThan(0);
  });
  it('stops after two timeouts and names the failing source', async () => {
    let calls = 0;
    await expect(listSitePages({ feedUrl: 'https://playbound.club/sitemap.xml', pathPrefix: '/games/' }, async () => {
      calls += 1;
      throw new DOMException('Request timed out', 'TimeoutError');
    })).rejects.toThrow('https://playbound.club/sitemap.xml (2 attempts');
    expect(calls).toBe(2);
  });
  it('does not retry a permanent missing feed', async () => {
    let calls = 0;
    await expect(listSitePages({ feedUrl: 'https://playbound.club/missing.xml', pathPrefix: '/games/' }, async () => { calls += 1; return new Response('', { status: 404 }); })).rejects.toThrow('404');
    expect(calls).toBe(1);
  });
});
