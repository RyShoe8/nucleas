import { fetchPublicText, type FetchLike } from './fetchPublic';

/**
 * Finds new pages on a company's site from its own sitemap or RSS/Atom feed. Nucleas works out which
 * part of the site the person means ("new games" → /games/<slug>) once, when the job is set up; each
 * hourly check then only reads the feed. The parsing below is pure so it can be tested on its own.
 */

export interface SiteEntry {
  url: string;
  /** lastmod or the feed's published date, when given. */
  date: Date | null;
  title: string | null;
}

export type ParsedFeed = { kind: 'sitemap'; entries: SiteEntry[] } | { kind: 'sitemap_index'; sitemaps: string[] } | { kind: 'rss' | 'atom'; entries: SiteEntry[] } | { kind: 'unknown' };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(value: string): string {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<(?:[a-z]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z]+:)?${name}>`, 'i').exec(block);
  return match ? decode(match[1]!) : null;
}

function date(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function parseFeed(xml: string): ParsedFeed {
  const head = xml.slice(0, 2000).toLowerCase();
  if (/<sitemapindex\b/.test(head)) {
    const sitemaps = [...xml.matchAll(/<sitemap\b[\s\S]*?<\/sitemap>/gi)].map((m) => tag(m[0], 'loc')).filter((u): u is string => Boolean(u));
    return { kind: 'sitemap_index', sitemaps };
  }
  if (/<urlset\b/.test(head)) {
    const entries = [...xml.matchAll(/<url\b[\s\S]*?<\/url>/gi)]
      .map((m): { url: string | null; date: Date | null; title: string | null } => ({ url: tag(m[0], 'loc'), date: date(tag(m[0], 'lastmod')), title: null }))
      .filter((e): e is SiteEntry => Boolean(e.url));
    return { kind: 'sitemap', entries };
  }
  if (/<rss\b|<rdf:rdf\b/.test(head)) {
    const entries = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
      .map((m) => ({ url: tag(m[0], 'link') ?? tag(m[0], 'guid'), date: date(tag(m[0], 'pubDate') ?? tag(m[0], 'date')), title: tag(m[0], 'title') }))
      .filter((e): e is SiteEntry => Boolean(e.url && /^https?:\/\//i.test(e.url)));
    return { kind: 'rss', entries };
  }
  if (/<feed\b/.test(head)) {
    const entries = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)]
      .map((m) => {
        const alternate = /<link\b(?=[^>]*rel=["']alternate["'])[^>]*href=["']([^"']+)["']/i.exec(m[0]) ?? /<link\b[^>]*href=["']([^"']+)["']/i.exec(m[0]);
        return { url: alternate ? decode(alternate[1]!) : null, date: date(tag(m[0], 'published') ?? tag(m[0], 'updated')), title: tag(m[0], 'title') };
      })
      .filter((e): e is SiteEntry => Boolean(e.url));
    return { kind: 'atom', entries };
  }
  return { kind: 'unknown' };
}

/** Where to look for a feed, best first: feeds the homepage links to, sitemaps from robots.txt, then the usual addresses. */
export function feedCandidates(origin: string, homepageHtml: string, robotsTxt: string): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    try {
      const url = new URL(raw, origin);
      if (url.protocol === 'https:' && !out.includes(url.toString())) out.push(url.toString());
    } catch {
      // Not an address.
    }
  };
  for (const match of homepageHtml.matchAll(/<link\b[^>]*>/gi)) {
    const el = match[0];
    if (/rel=["']alternate["']/i.test(el) && /type=["']application\/(rss|atom)\+xml["']/i.test(el)) {
      const href = /href=["']([^"']+)["']/i.exec(el)?.[1];
      if (href) add(decode(href));
    }
  }
  for (const line of robotsTxt.split(/\r?\n/)) {
    const match = /^\s*sitemap:\s*(\S+)/i.exec(line);
    if (match) add(match[1]!);
  }
  for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/rss.xml', '/feed.xml', '/feed']) add(path);
  return out;
}

/** The first path segment as a section ("/games/"), with how many pages sit directly under it. */
export function pathGroups(entries: SiteEntry[]): { prefix: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    let path: string;
    try {
      path = new URL(entry.url).pathname;
    } catch {
      continue;
    }
    const segments = path.split('/').filter(Boolean);
    if (segments.length !== 2) continue;
    const prefix = `/${segments[0]}/`;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()].map(([prefix, count]) => ({ prefix, count })).sort((a, b) => b.count - a.count);
}

const singular = (word: string) => word.toLowerCase().replace(/ies$/, 'y').replace(/(ss|sh|ch|x)es$/, '$1').replace(/s$/, '');

/** The section the request names: an explicit path ("playbound.club/games"), or a word that matches a section ("new games"). */
export function choosePrefix(brief: string, groups: { prefix: string; count: number }[]): string | null {
  const explicit = /(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/[a-z0-9_-]+)\/?/i.exec(brief)?.[1];
  if (explicit) {
    const wanted = `${explicit.toLowerCase()}/`;
    const hit = groups.find((g) => g.prefix.toLowerCase() === wanted);
    if (hit) return hit.prefix;
  }
  const words = new Set((brief.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []).map(singular));
  const matches = groups.filter((g) => words.has(singular(g.prefix.replace(/\//g, ''))));
  return matches.sort((a, b) => b.count - a.count)[0]?.prefix ?? null;
}

/** What one item is called: the section's name in the singular ("/games/" → "game"). */
export function nounForPrefix(prefix: string): string {
  const section = prefix.replace(/\//g, '').replace(/[-_]+/g, ' ').trim().toLowerCase();
  // "news" is not the plural of "new": a news section holds articles.
  if (section === 'news' || section === 'latest news') return 'article';
  if (section === 'blog' || section === 'blogs') return 'post';
  const word = singular(section);
  return word || 'page';
}

const REQUEST_NOUNS = ['article', 'post', 'guide', 'story', 'page', 'review', 'tutorial', 'entry', 'episode', 'game', 'recipe', 'resource', 'newsletter', 'update'];

/** What the person called one item ("one article every 3 weeks" -> "article"), when they said. */
export function nounFromRequest(text: string): string | null {
  const t = text.toLowerCase();
  const match = new RegExp(`\\b(?:one|an?|each|every|per)\\s+(?:(?:evergreen|new|latest|existing)\\s+)?(${REQUEST_NOUNS.join('|')})\\b`).exec(t);
  return match?.[1] ?? null;
}

/** Pages directly under the section (not the section page itself or deeper sub-pages), on the site's own host. */
export function entriesUnder(entries: SiteEntry[], prefix: string, host: string): SiteEntry[] {
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, '');
  const seen = new Set<string>();
  return entries.filter((entry) => {
    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      return false;
    }
    if (bare(url.hostname) !== bare(host)) return false;
    const segments = url.pathname.split('/').filter(Boolean);
    const want = prefix.split('/').filter(Boolean);
    const ok = prefix === '/' ? segments.length >= 1 : segments.length === want.length + 1 && want.every((s, i) => segments[i]?.toLowerCase() === s.toLowerCase());
    const key = `${bare(url.hostname)}${url.pathname.replace(/\/$/, '')}`;
    if (!ok || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Newest first; undated entries keep the feed's order after the dated ones (feeds usually list newest last for sitemaps). */
export function newestFirst(entries: SiteEntry[]): SiteEntry[] {
  const dated = entries.filter((e) => e.date).sort((a, b) => b.date!.getTime() - a.date!.getTime());
  const undated = entries.filter((e) => !e.date).reverse();
  return [...dated, ...undated];
}

// ---------- Network ----------

const MAX_CHILD_SITEMAPS = 20;

async function readFeed(url: string, fetcher?: FetchLike): Promise<ParsedFeed> {
  const target = new URL(url);
  const label = `${target.origin}${target.pathname}`;
  const timeoutMs = 30_000;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const started = Date.now();
    console.info('[publishing/source] fetching', { url: label, attempt, timeoutMs });
    try {
      const res = await fetchPublicText(url, { accept: 'application/xml,text/xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.5', maxBytes: 8_000_000, timeoutMs, fetcher });
      const parsed = parseFeed(res.text);
      console.info('[publishing/source] fetched', { url: label, attempt, elapsedMs: Date.now() - started, kind: parsed.kind });
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown fetch error';
      const retryable = error instanceof Error && (['AbortError', 'TimeoutError', 'TypeError'].includes(error.name) || /timeout|timed out|returned (408|429|5\d\d)\b/i.test(message));
      console.warn('[publishing/source] fetch failed', { url: label, attempt, elapsedMs: Date.now() - started, message, retrying: retryable && attempt < 2 });
      if (!retryable || attempt === 2) throw new Error(`Could not fetch ${label} (${attempt} attempt${attempt === 1 ? '' : 's'}, up to 30 seconds each): ${message}`);
    }
  }
  throw new Error(`Could not fetch ${label}.`);
}

/** Every entry a feed lists; a sitemap index is followed into its children, the ones named like the section first. */
export async function readFeedEntries(feedUrl: string, options: { prefix?: string; fetcher?: FetchLike } = {}): Promise<{ kind: 'sitemap' | 'rss' | 'atom'; entries: SiteEntry[] } | null> {
  const parsed = await readFeed(feedUrl, options.fetcher);
  if (parsed.kind === 'unknown') return null;
  if (parsed.kind !== 'sitemap_index') return parsed;
  const hint = options.prefix ? options.prefix.replace(/\//g, '').toLowerCase() : '';
  const children = [...parsed.sitemaps].sort((a, b) => Number(hint && b.toLowerCase().includes(hint)) - Number(hint && a.toLowerCase().includes(hint))).slice(0, MAX_CHILD_SITEMAPS);
  const entries: SiteEntry[] = [];
  for (const child of children) {
    const sub = await readFeed(child, options.fetcher).catch(() => null);
    if (sub && sub.kind === 'sitemap') entries.push(...sub.entries);
  }
  return { kind: 'sitemap', entries };
}

export type PickPrefix = (input: { brief: string; groups: { prefix: string; count: number }[] }) => Promise<string | null>;

export type DiscoverResult =
  | { ok: true; feedUrl: string; feedKind: 'sitemap' | 'rss' | 'atom'; pathPrefix: string; noun: string; count: number; newest: SiteEntry | null }
  | { ok: false; error: string };

/**
 * Finds the feed and section for a request. Words in the request decide the section; when they do not,
 * `pick` (a model) chooses among the site's sections. Nothing is guessed silently: no match is an error
 * that tells the person what to add.
 */
export async function discoverSiteSource(input: { domain: string; brief: string; fetcher?: FetchLike; pick?: PickPrefix }): Promise<DiscoverResult> {
  const origin = `https://${input.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
  const host = new URL(origin).host;
  const [home, robots] = await Promise.all([
    fetchPublicText(origin, { accept: 'text/html', maxBytes: 1_500_000, fetcher: input.fetcher }).then((r) => r.text).catch(() => ''),
    fetchPublicText(`${origin}/robots.txt`, { accept: 'text/plain', maxBytes: 200_000, fetcher: input.fetcher }).then((r) => r.text).catch(() => ''),
  ]);
  const candidates = feedCandidates(origin, home, robots).slice(0, 8);
  let fallback: { feedUrl: string; kind: 'sitemap' | 'rss' | 'atom'; entries: SiteEntry[] } | null = null;
  for (const feedUrl of candidates) {
    const read = await readFeedEntries(feedUrl, { fetcher: input.fetcher }).catch(() => null);
    if (!read?.entries.length) continue;
    const groups = pathGroups(read.entries);
    const prefix = choosePrefix(input.brief, groups);
    if (prefix) {
      const under = newestFirst(entriesUnder(read.entries, prefix, host));
      if (under.length) return { ok: true, feedUrl, feedKind: read.kind, pathPrefix: prefix, noun: nounForPrefix(prefix), count: under.length, newest: under[0] ?? null };
    }
    if (!fallback && groups.length) fallback = { feedUrl, kind: read.kind, entries: read.entries };
  }
  if (!fallback) return { ok: false, error: `Nucleas could not find a sitemap or feed on ${host}. Add one (most site builders have a setting for it), then try again.` };
  if (input.pick) {
    const groups = pathGroups(fallback.entries).slice(0, 20);
    const picked = await input.pick({ brief: input.brief, groups }).catch(() => null);
    const prefix = picked && groups.some((g) => g.prefix === picked) ? picked : null;
    if (prefix) {
      const under = newestFirst(entriesUnder(fallback.entries, prefix, host));
      return { ok: true, feedUrl: fallback.feedUrl, feedKind: fallback.kind, pathPrefix: prefix, noun: nounForPrefix(prefix), count: under.length, newest: under[0] ?? null };
    }
  }
  const sections = pathGroups(fallback.entries).slice(0, 4).map((g) => `${host}${g.prefix}`).join(', ');
  return { ok: false, error: `Nucleas could not tell which pages you mean. Include the section's address in the request${sections ? ` (for example ${sections})` : ''}.` };
}

/** The pages in a job's section right now, newest first. */
export async function listSitePages(source: { feedUrl: string; pathPrefix: string }, fetcher?: FetchLike): Promise<SiteEntry[]> {
  const read = await readFeedEntries(source.feedUrl, { prefix: source.pathPrefix, fetcher });
  if (!read) throw new Error('The feed could not be read.');
  return newestFirst(entriesUnder(read.entries, source.pathPrefix, new URL(source.feedUrl).host));
}
