import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { webFetch } from '@/lib/ai/tools/webFetch';

const MAX_SITEMAP_BYTES = 1_000_000;
const MAX_CHILD_SITEMAPS = 5;
const TIMEOUT_MS = 10_000;

export type SiteMapResult = {
  origin: string;
  source: 'sitemap' | 'links';
  total: number;
  urls: string[];
};

type Options = { fetcher?: typeof fetch; signal?: AbortSignal; limit?: number; search?: string };

async function fetchText(url: URL, options: Options): Promise<string | null> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, TIMEOUT_MS);
  try {
    const response = await (options.fetcher ?? fetch)(url, { method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const text = await response.text();
    return text.slice(0, MAX_SITEMAP_BYTES);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
}

function normalize(raw: string, origin: string): string | null {
  try {
    const url = new URL(raw);
    if (url.origin !== origin) return null;
    url.hash = '';
    assertSafePublicHttpsUrl(url.toString());
    return url.toString();
  } catch {
    return null;
  }
}

/** Lists a public site's pages: sitemap.xml first (via robots.txt too), otherwise the links on its home page. Read-only. */
export async function mapSite(rawUrl: string, options: Options = {}): Promise<SiteMapResult> {
  const start = assertSafePublicHttpsUrl(rawUrl);
  const origin = start.origin;
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 500);

  const robots = await fetchText(new URL('/robots.txt', origin), options);
  const declared = (robots?.match(/^\s*sitemap:\s*(\S+)/gim) ?? []).map((line) => line.replace(/^\s*sitemap:\s*/i, '').trim());
  const queue = [...new Set([...declared.map((u) => normalize(u, origin)).filter((u): u is string => Boolean(u)), `${origin}/sitemap.xml`])];

  const found = new Set<string>();
  let childSitemaps = 0;
  for (let i = 0; i < queue.length && found.size < 5000; i++) {
    const xml = await fetchText(new URL(queue[i]), options);
    if (!xml) continue;
    const entries = locs(xml);
    if (/<sitemapindex/i.test(xml)) {
      for (const entry of entries) {
        const child = normalize(entry, origin);
        if (child && !queue.includes(child) && childSitemaps < MAX_CHILD_SITEMAPS) {
          queue.push(child);
          childSitemaps++;
        }
      }
    } else {
      for (const entry of entries) {
        const page = normalize(entry, origin);
        if (page) found.add(page);
      }
    }
  }

  let source: SiteMapResult['source'] = 'sitemap';
  if (found.size === 0) {
    source = 'links';
    const page = await webFetch(start.toString(), { fetcher: options.fetcher, signal: options.signal });
    for (const link of page.links) {
      const normalized = normalize(link, origin);
      if (normalized) found.add(normalized);
    }
  }

  const term = options.search?.trim().toLowerCase();
  const all = [...found].filter((u) => !term || u.toLowerCase().includes(term));
  return { origin, source, total: all.length, urls: all.slice(0, limit) };
}
