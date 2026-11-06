import { linksInText } from '@/lib/ai/evidence';
import { sameUrl } from '@/lib/ai/evidenceUrl';
import { browserFetch, plainPageText } from '@/lib/ai/tools/browserClient';
import { isSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { webFetch } from '@/lib/ai/tools/webFetch';

/**
 * Small research models report pages they never opened, and sometimes invent the address. Before anything is
 * written, code opens every link they name, with the real browser when a plain fetch fails, and records what is there.
 */
export type PageCheck = {
  url: string;
  /** opened: the page is there. gone: it does not exist. blocked: it could not be read, which proves nothing. */
  status: 'opened' | 'gone' | 'blocked';
  title?: string;
  text?: string;
};

const NOT_FOUND_TITLE = /\b(?:page )?not found\b|\b404\b|doesn.t exist|does not exist|no longer available/i;
const MIN_READABLE_TEXT = 200;
const EXCERPT_LENGTH = 700;
const TRANCO_PAUSE_MS = 1100;

const titleIn = (html: string) => /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1]?.trim();

async function openWithBrowser(url: string, signal?: AbortSignal): Promise<PageCheck> {
  const page = await browserFetch(url, { signal });
  if (page.status === 404 || page.status === 410) return { url, status: 'gone' };
  if (page.status < 200 || page.status >= 300) return { url, status: 'blocked' };
  const title = titleIn(page.body);
  if (title && NOT_FOUND_TITLE.test(title)) return { url, status: 'gone', title };
  const text = plainPageText(page.body);
  return text.length >= MIN_READABLE_TEXT ? { url, status: 'opened', title, text } : { url, status: 'blocked', title };
}

/** One page, tried the cheap way first. Anything short of a clear answer goes to the real browser before it counts against the page. */
export async function checkPage(url: string, signal?: AbortSignal): Promise<PageCheck> {
  try {
    const fetched = await webFetch(url, { signal });
    if (fetched.title && NOT_FOUND_TITLE.test(fetched.title)) return { url, status: 'gone', title: fetched.title };
    if (!fetched.thin && fetched.text.length >= MIN_READABLE_TEXT) return { url, status: 'opened', title: fetched.title ?? undefined, text: fetched.text };
  } catch {
    // Redirects, bot walls and timeouts all land here; the browser decides.
  }
  try {
    return await openWithBrowser(url, signal);
  } catch {
    return { url, status: 'blocked' };
  }
}

export async function checkPages(urls: string[], options: { signal?: AbortSignal; concurrency?: number } = {}): Promise<PageCheck[]> {
  const queue = [...urls];
  const results: PageCheck[] = [];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      if (options.signal?.aborted) return;
      results.push(await checkPage(url, options.signal));
    }
  };
  await Promise.all(Array.from({ length: options.concurrency ?? 3 }, worker));
  return results;
}

/** Links in some text that have not been checked yet. */
export function linksToCheck(text: string, checked: Iterable<string>, limit = 25): string[] {
  const seen = new Set([...checked].map(sameUrl));
  const urls: string[] = [];
  for (const { url } of linksInText(text)) {
    const key = sameUrl(url);
    if (seen.has(key) || !isSafePublicHttpsUrl(url)) continue;
    seen.add(key);
    urls.push(url);
    if (urls.length >= limit) break;
  }
  return urls;
}

/** What was really found, for the models that come next. */
export function describeChecks(checks: PageCheck[]): string {
  return [
    '# Pages Nucleas opened itself',
    ...checks.map((check) => {
      if (check.status === 'gone') return `- GONE ${check.url}: this page does not exist. Do not use this link.`;
      if (check.status === 'blocked') return `- BLOCKED ${check.url}: could not be read, so nothing is known either way.`;
      return `- OPENED ${check.url}${check.title ? ` "${check.title}"` : ''}: ${(check.text ?? '').replace(/\s+/g, ' ').slice(0, EXCERPT_LENGTH)}`;
    }),
  ].join('\n');
}

/** Turns links to pages that do not exist into plain text, so a reader is never sent to one. */
export function removeLinksTo(answer: string, gone: Iterable<string>): { text: string; removed: number } {
  const dead = new Set([...gone].map(sameUrl));
  let removed = 0;
  const text = answer.replace(/\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]+)\)/g, (whole, label: string, url: string) => {
    if (!dead.has(sameUrl(url))) return whole;
    removed += 1;
    return label;
  });
  return { text, removed };
}

export type SiteSize = { host: string; rank: number | null };

/** The sites behind a set of links, most mentioned first. */
export function sitesIn(text: string, limit = 15): string[] {
  const counts = new Map<string, number>();
  for (const { url } of linksInText(text)) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      counts.set(host, (counts.get(host) ?? 0) + 1);
    } catch {
      // Not a usable address, so it has no site to look up.
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([host]) => host).slice(0, limit);
}

/**
 * How big each site is, from one source, so sites can be compared at all. Tranco ranks the world's most visited
 * sites, is free, and allows about one request a second. A site it does not list is outside its top million.
 */
export async function siteSizes(hosts: string[], options: { signal?: AbortSignal; fetcher?: typeof fetch; pauseMs?: number } = {}): Promise<SiteSize[]> {
  const fetcher = options.fetcher ?? fetch;
  const pause = options.pauseMs ?? TRANCO_PAUSE_MS;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const sizes: SiteSize[] = [];
  for (const host of hosts) {
    if (options.signal?.aborted) break;
    let rank: number | null = null;
    try {
      const lookup = () => fetcher(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(host)}`, { signal: options.signal });
      let response = await lookup();
      if (response.status === 429) {
        await wait(pause * 2);
        response = await lookup();
      }
      if (response.ok) {
        const body = (await response.json()) as { ranks?: { rank?: unknown }[] };
        const latest = body.ranks?.[0]?.rank;
        rank = typeof latest === 'number' ? latest : null;
      }
    } catch {
      // A failed lookup leaves this one site unknown; the others still compare.
    }
    sizes.push({ host, rank });
    await wait(pause);
  }
  return sizes;
}

export function describeSizes(sizes: SiteSize[]): string {
  const ranked = [...sizes].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  return [
    '# Site size',
    'Tranco popularity rank, the same source for every site. A lower rank means a bigger site. "not ranked" means outside the top million or not found.',
    ...ranked.map((size) => `- ${size.host}: ${size.rank === null ? 'not ranked' : `#${size.rank.toLocaleString('en-US')}`}`),
  ].join('\n');
}
