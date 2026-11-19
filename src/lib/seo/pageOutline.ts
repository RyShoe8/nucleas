import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { browserFetch, browserNavigate } from '@/lib/ai/tools/browserClient';
import { isBrowserWorkerConfigured } from '@/lib/ai/tools/browseRouter';

/**
 * The SEO shape of one page: title, description, headings, length, structured data and links. Used to see how a
 * ranking competitor built its page. The page is read through the browser worker (the real browser on the VPS)
 * whenever it is configured, so sites that refuse Nucleas's servers or build their content in JavaScript still read
 * correctly; a page that cannot be read is reported as such, never as an empty outline.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type PageOutline = {
  url: string;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robots: string | null;
  language: string | null;
  headings: { level: 1 | 2 | 3; text: string }[];
  wordCount: number;
  links: { internal: number; external: number };
  images: { total: number; missingAlt: number };
  structuredData: string[];
  published: string | null;
  modified: string | null;
  /** How the page was read: raw HTML, or rendered by the browser because the HTML had no headings. */
  readVia: 'browser_worker' | 'direct' | 'browser_rendered';
};

const MAX_BYTES = 1_500_000;
const MAX_HEADINGS = 80;

function decode(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'").replace(/&quot;|&ldquo;|&rdquo;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function meta(html: string, attr: 'name' | 'property', value: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = new RegExp(`\\b${attr}\\s*=\\s*["']${value}["']`, 'i');
    if (!key.test(tag)) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content !== undefined) return decode(content).slice(0, 500) || null;
  }
  return null;
}

function schemaTypes(html: string): { types: string[]; published: string | null; modified: string | null } {
  const types = new Set<string>();
  let published: string | null = null;
  let modified: string | null = null;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const type = record['@type'];
    for (const t of Array.isArray(type) ? type : [type]) if (typeof t === 'string') types.add(t);
    if (!published && typeof record.datePublished === 'string') published = record.datePublished;
    if (!modified && typeof record.dateModified === 'string') modified = record.dateModified;
    for (const value of Object.values(record)) if (value && typeof value === 'object') visit(value);
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1].trim()));
    } catch {
      // A broken JSON-LD block is skipped; the page's other data still counts.
    }
  }
  return { types: [...types].slice(0, 30), published, modified };
}

/** Parses an HTML document into its SEO outline. Exported for tests. */
export function outlineFromHtml(html: string, pageUrl: string, readVia: PageOutline['readVia']): PageOutline {
  const base = new URL(pageUrl);
  const body = html.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  const headings: PageOutline['headings'] = [];
  for (const match of body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = decode(match[2]).slice(0, 200);
    if (text) headings.push({ level: Number(match[1]) as 1 | 2 | 3, text });
    if (headings.length >= MAX_HEADINGS) break;
  }
  // Words in the main content when the page marks it, else the whole body minus navigation and footer.
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(body)?.[1] ?? /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(body)?.[1]
    ?? body.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = decode(main);
  let internal = 0;
  let external = 0;
  for (const match of body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const href = new URL(match[1], base);
      if (!/^https?:$/.test(href.protocol)) continue;
      if (href.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '')) internal += 1;
      else external += 1;
    } catch {
      // Malformed links are not counted.
    }
  }
  const images = body.match(/<img\b[^>]*>/gi) ?? [];
  const schema = schemaTypes(html);
  const canonical = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i.exec(html)?.[0];
  return {
    url: pageUrl,
    title: decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').slice(0, 300) || null,
    metaDescription: meta(html, 'name', 'description') ?? meta(html, 'property', 'og:description'),
    canonical: canonical ? /\bhref\s*=\s*["']([^"']+)["']/i.exec(canonical)?.[1]?.slice(0, 2000) ?? null : null,
    robots: meta(html, 'name', 'robots'),
    language: /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(html)?.[1]?.slice(0, 20) ?? null,
    headings,
    wordCount: text ? text.split(' ').length : 0,
    links: { internal, external },
    images: { total: images.length, missingAlt: images.filter((tag) => !/\balt\s*=\s*["'][^"']+["']/i.test(tag)).length },
    structuredData: schema.types,
    published: meta(html, 'property', 'article:published_time') ?? schema.published,
    modified: meta(html, 'property', 'article:modified_time') ?? schema.modified,
    readVia,
  };
}

/** Plain GET with redirects followed one hop at a time, each checked as a safe public HTTPS address. */
async function directHtml(start: URL, fetchImpl: FetchLike): Promise<{ url: string; html: string }> {
  let url = start;
  for (let hop = 0; hop < 4; hop += 1) {
    const res = await fetchImpl(url.toString(), { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15_000), headers: { accept: 'text/html,application/xhtml+xml' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      url = assertSafePublicHttpsUrl(new URL(res.headers.get('location')!, url).toString());
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`The page answered ${res.status}.`);
    }
    const html = (await res.text()).slice(0, MAX_BYTES);
    return { url: url.toString(), html };
  }
  throw new Error('The page redirected too many times.');
}

export async function pageOutline(rawUrl: string, options: { fetchImpl?: FetchLike; signal?: AbortSignal } = {}): Promise<PageOutline> {
  const target = assertSafePublicHttpsUrl(rawUrl);
  const viaWorker = isBrowserWorkerConfigured();
  let page: { url: string; html: string };
  if (viaWorker) {
    const fetched = await browserFetch(target.toString(), { signal: options.signal, ...(options.fetchImpl ? { fetcher: options.fetchImpl as typeof fetch } : {}) });
    if (fetched.status >= 400) throw new Error(`The page answered ${fetched.status}.`);
    page = { url: fetched.url, html: fetched.body.slice(0, MAX_BYTES) };
  } else {
    page = await directHtml(target, options.fetchImpl ?? fetch);
  }
  const outline = outlineFromHtml(page.html, page.url, viaWorker ? 'browser_worker' : 'direct');
  if (outline.headings.length || !viaWorker) return outline;

  // No headings in the raw HTML: the content is built in the browser, so read the rendered page instead.
  const rendered = await browserNavigate(page.url, { signal: options.signal, ...(options.fetchImpl ? { fetcher: options.fetchImpl as typeof fetch } : {}) });
  const headings: PageOutline['headings'] = [];
  for (const line of rendered.text.split('\n')) {
    const match = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line.trim());
    if (match) headings.push({ level: match[1].length as 1 | 2 | 3, text: match[2].replace(/[*_`[\]]/g, '').slice(0, 200) });
    if (headings.length >= MAX_HEADINGS) break;
  }
  const words = rendered.plainText ? rendered.plainText.split(/\s+/).filter(Boolean).length : outline.wordCount;
  return { ...outline, headings, wordCount: Math.max(words, outline.wordCount), title: outline.title ?? rendered.title, readVia: 'browser_rendered' };
}
