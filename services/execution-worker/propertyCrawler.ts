import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { analyzeProperty } from './propertyAnalyzer';

type CrawlRequest = { requestId: string; rootUrl: string; callbackUrl: string; maxPages?: number; browserWorker?: { url: string; secret: string }; signal?: AbortSignal };
type CrawlEvidence = { url: string; title: string; description: string; h1: string[]; h2: string[]; metaKeywords: string[]; routePattern: string };
const MAX_HTML = 700_000; const TIMEOUT = 30_000; const DELAY_MS = 250;
const HEARTBEAT_MS = 60_000;
const SKIP = /\.(?:avif|bmp|css|csv|docx?|gif|ico|jpe?g|js|json|mp3|mp4|pdf|png|pptx?|svg|webp|xlsx?|xml|zip)$/i;
const DYNAMIC = /^(?:\d+|[0-9a-f]{12,}|[0-9a-f]{8}-[0-9a-f-]{27,}|(?=.*\d)[\w-]{16,})$/i;

function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); }
  const value = ip.toLowerCase(); return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value) || value.startsWith('ff');
}
async function safeUrl(raw: string): Promise<URL> {
  const url = new URL(raw); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only public HTTPS URLs are allowed.');
  if (/^(?:localhost|metadata)(?:\.|$)/i.test(url.hostname) || /\.(?:local|internal|arpa|onion)$/i.test(url.hostname)) throw new Error('Private hosts are not allowed.');
  const results = await dns.lookup(url.hostname, { all: true }); if (!results.length || results.some((item) => privateIp(item.address))) throw new Error('The host does not resolve exclusively to public addresses.');
  return url;
}
function timedSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}
async function fetchSafe(raw: string, accept = 'text/html,application/xhtml+xml,*/*;q=0.5', signal?: AbortSignal): Promise<Response> {
  let url = await safeUrl(raw);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url, { redirect: 'manual', signal: timedSignal(TIMEOUT, signal), headers: { Accept: accept, 'User-Agent': 'NucleasPropertyAudit/1.0 (+https://nucleas.app)' } });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location'); await response.body?.cancel(); if (!location) return response;
    url = await safeUrl(new URL(location, url).toString());
  }
  throw new Error('Too many redirects.');
}
async function readLimited(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) return ''; const parts: Uint8Array[] = []; let size = 0;
  while (size < limit) { const { done, value } = await reader.read(); if (done) break; const part = value.subarray(0, limit - size); parts.push(part); size += part.byteLength; if (part.byteLength < value.byteLength) { await reader.cancel(); break; } }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; } return new TextDecoder().decode(bytes);
}
function clean(value = '') { return value.replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|quot|#39);/g, ' ').replace(/\s+/g, ' ').trim(); }
function attr(tag: string, name: string) { return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]?.trim() ?? ''; }
function all(html: string, regex: RegExp) { return [...html.matchAll(regex)].map((match) => clean(match[1])).filter(Boolean); }
function sameSite(a: string, b: string) { return a.toLowerCase().replace(/^www\./, '') === b.toLowerCase().replace(/^www\./, ''); }
function absolute(raw: string, base: URL) { try { const url = new URL(raw, base); url.hash = ''; if (url.protocol !== 'https:' || SKIP.test(url.pathname)) return null; [...url.searchParams.keys()].forEach((key) => { if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key); }); return url.toString(); } catch { return null; } }
export function routePattern(url: URL) {
  const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  return '/' + parts.map((part, index) => {
    // A collection/item/subcollection/item hierarchy is the safest context-free fallback.
    // Sitemap-aware crawls replace this with rules learned from the site's own URL corpus.
    if (index > 0 && index % 2 === 1) return ':item';
    if (DYNAMIC.test(part)) return ':id';
    return part;
  }).join('/');
}

const LOW_VOLUME_COLLECTIONS = new Set('article articles author authors blog blogs category categories event events news post posts product products profile profiles tag tags'.split(' '));

/** Learn repeated dynamic path positions from this property's own submitted URLs. */
export function createRoutePatternResolver(urls: string[]): (url: URL) => string {
  const rows = urls.flatMap((value) => { try { return [new URL(value).pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))]; } catch { return []; } });
  const dynamic = new Set<string>();
  const normalizedPrefix = (parts: string[], end: number) => {
    const output: string[] = [];
    for (let index = 0; index < end; index += 1) {
      const prefix = output.join('/');
      output.push(dynamic.has(`${prefix}|${index}`) ? ':item' : parts[index]);
    }
    return output.join('/');
  };
  const maxDepth = Math.max(0, ...rows.map((parts) => parts.length));
  for (let index = 1; index < maxDepth; index += 1) {
    const groups = new Map<string, Set<string>>();
    for (const parts of rows) {
      if (parts.length <= index) continue;
      const prefix = normalizedPrefix(parts, index); const values = groups.get(prefix) ?? new Set<string>();
      values.add(parts[index].toLowerCase()); groups.set(prefix, values);
    }
    for (const [prefix, values] of groups) {
      const first = prefix.split('/')[0]?.toLowerCase() ?? '';
      if (values.size >= 5 || (index === 1 && LOW_VOLUME_COLLECTIONS.has(first) && values.size >= 2)) dynamic.add(`${prefix}|${index}`);
    }
  }
  return (url: URL) => {
    const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
    const output: string[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const prefix = output.join('/');
      output.push(dynamic.has(`${prefix}|${index}`) || DYNAMIC.test(parts[index]) ? ':item' : parts[index]);
    }
    return '/' + output.join('/');
  };
}

function structuralFingerprint(html: string): string {
  const landmarks = [...html.toLowerCase().replace(/<!--[\s\S]*?-->/g, '').replace(/<(?:script|style|svg)[\s\S]*?<\/(?:script|style|svg)>/g, '').matchAll(/<\/?(header|nav|main|aside|footer|article|section|form|table|h1|h2|ul|ol|li)\b[^>]*>/g)]
    .map((match) => `${match[0].startsWith('</') ? '/' : ''}${match[1]}`)
    .filter((tag, index, rows) => tag !== rows[index - 1]);
  return crypto.createHash('sha1').update(landmarks.slice(0, 2_000).join('|')).digest('hex').slice(0, 12);
}

export function templateIdentity(html: string, url: URL, pattern = routePattern(url)): string {
  return pattern.includes(':') ? `route:${pattern}` : `structure:${structuralFingerprint(html)}`;
}

export function extractPage(html: string, url: URL, statusCode: number, contentType: string, resolvedPattern = routePattern(url)) {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]); const h1 = all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi); const h2 = all(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi); const h3 = all(html, /<h3[^>]*>([\s\S]*?)<\/h3>/gi);
  const meta = (name: string) => attr(html.match(new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`, 'i'))?.[0] ?? '', 'content');
  const link = (rel: string) => attr(html.match(new RegExp(`<link\\b[^>]*rel\\s*=\\s*["'][^"']*${rel}[^"']*["'][^>]*>`, 'i'))?.[0] ?? '', 'href');
  const anchors = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((match) => absolute(match[1], url)).filter((value): value is string => Boolean(value));
  const internalLinks = [...new Set(anchors.filter((value) => sameSite(new URL(value).hostname, url.hostname)))]; const externalLinks = [...new Set(anchors.filter((value) => !sameSite(new URL(value).hostname, url.hostname)))];
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]); const description = meta('description'); const robots = meta('robots'); const canonical = absolute(link('canonical'), url) ?? ''; const language = attr(html.match(/<html\b[^>]*>/i)?.[0] ?? '', 'lang');
  const body = clean((html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '').replace(/<(?:script|style|svg)[^>]*>[\s\S]*?<\/(?:script|style|svg)>/gi, '')); const wordCount = body.split(/\s+/).filter(Boolean).length;
  const structuredDataTypes = [...new Set([...html.matchAll(/["']@type["']\s*:\s*["']([^"']+)["']/gi)].map((match) => match[1]))];
  const issues: string[] = []; if (statusCode >= 400) issues.push(`HTTP ${statusCode}`); if (!title) issues.push('Missing title'); else if (title.length < 30 || title.length > 60) issues.push(`Title length ${title.length}`); if (!description) issues.push('Missing meta description'); else if (description.length < 70 || description.length > 160) issues.push(`Meta description length ${description.length}`); if (!h1.length) issues.push('Missing H1'); else if (h1.length > 1) issues.push(`${h1.length} H1 headings`); if (!canonical) issues.push('Missing canonical'); if (!language) issues.push('Missing HTML language'); const imagesMissingAlt = images.filter((tag) => !/\balt\s*=\s*["'][^"']*["']/i.test(tag)).length; if (imagesMissingAlt) issues.push(`${imagesMissingAlt} images missing alt text`); if (wordCount < 100) issues.push('Thin content');
  const published = meta('article:published_time') || html.match(/["']datePublished["']\s*:\s*["']([^"']+)/i)?.[1]; const modified = meta('article:modified_time') || html.match(/["']dateModified["']\s*:\s*["']([^"']+)/i)?.[1];
  return { url: url.toString(), routePattern: resolvedPattern, statusCode, contentType, title, description, canonical, robots, language, h1, h2, h3, metaKeywords: meta('keywords').split(',').map((item) => item.trim()).filter(Boolean), wordCount, internalLinks, externalLinks, imageCount: images.length, imagesMissingAlt, structuredDataTypes, ...(published && !Number.isNaN(Date.parse(published)) ? { datePublished: new Date(published).toISOString() } : {}), ...(modified && !Number.isNaN(Date.parse(modified)) ? { dateModified: new Date(modified).toISOString() } : {}), indexable: !/noindex/i.test(robots), templateKey: crypto.createHash('sha1').update(templateIdentity(html, url, resolvedPattern)).digest('hex').slice(0, 12), issues, fetchedAt: new Date().toISOString(), htmlSnapshot: html, renderMode: 'html' as const };
}

/** Raw page bodies are useful while extracting evidence, but are too large for durable crawl storage. */
export function archivedPage<T extends { htmlSnapshot: string; renderedText?: string }>(page: T): Omit<T, 'htmlSnapshot' | 'renderedText'> {
  const seoEvidence = { ...page } as Partial<T>;
  delete seoEvidence.htmlSnapshot;
  delete seoEvidence.renderedText;
  return seoEvidence as Omit<T, 'htmlSnapshot' | 'renderedText'>;
}

async function enrichRendered(request: CrawlRequest, page: ReturnType<typeof extractPage>) {
  if (!request.browserWorker || (page.wordCount >= 100 && !/__NEXT_DATA__|data-reactroot|ng-app|id=["']root["']/i.test(page.htmlSnapshot))) return page;
  try {
    const endpoint = await safeUrl(`${request.browserWorker.url.replace(/\/+$/, '')}/navigate`);
    const response = await fetch(endpoint, { method: 'POST', signal: timedSignal(60_000, request.signal), headers: { Authorization: `Bearer ${request.browserWorker.secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: page.url, maxChars: 50_000 }) });
    if (!response.ok) return page;
    const body = await response.json() as { url?: unknown; title?: unknown; text?: unknown; links?: unknown };
    const renderedText = typeof body.text === 'string' ? body.text.slice(0, 50_000).replace(/\s+/g, ' ').trim() : '';
    const links = Array.isArray(body.links) ? body.links.filter((value): value is string => typeof value === 'string').map((value) => absolute(value, new URL(page.url))).filter((value): value is string => Boolean(value)) : [];
    const internalLinks = [...new Set([...page.internalLinks, ...links.filter((value) => sameSite(new URL(value).hostname, new URL(page.url).hostname))])];
    const externalLinks = [...new Set([...page.externalLinks, ...links.filter((value) => !sameSite(new URL(value).hostname, new URL(page.url).hostname))])];
    const wordCount = Math.max(page.wordCount, renderedText.split(/\s+/).filter(Boolean).length);
    return { ...page, title: page.title || (typeof body.title === 'string' ? body.title.slice(0, 4_000) : ''), wordCount, internalLinks, externalLinks, renderedText, renderMode: 'rendered' as const, issues: page.issues.filter((issue) => issue !== 'Thin content' || wordCount < 100) };
  } catch (error) { if (request.signal?.aborted) throw error; return page; }
}

async function callback(request: CrawlRequest, payload: unknown) {
  let last = ''; for (let attempt = 0; attempt < 4; attempt += 1) { try { const response = await fetch(await safeUrl(request.callbackUrl), { method: 'POST', signal: timedSignal(60_000, request.signal), headers: { Authorization: `Bearer ${process.env.NUCLEAS_EXECUTION_WORKER_TOKEN!.trim()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (response.ok) return; const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 500); last = `HTTP ${response.status}${detail ? `: ${detail}` : ''}`; } catch (error) { if (request.signal?.aborted) throw error; last = error instanceof Error ? error.message : 'callback failed'; } await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1))); } throw new Error(`Nucleas callback failed: ${last}`);
}
async function discoverSitemaps(root: URL, signal?: AbortSignal) {
  const pending = [new URL('/sitemap.xml', root).toString(), new URL('/sitemap_index.xml', root).toString()]; const seen = new Set<string>(); const pages: string[] = [];
  try { const robots = await fetchSafe(new URL('/robots.txt', root).toString(), 'text/plain', signal); if (robots.ok) for (const match of (await readLimited(robots, 1_000_000)).matchAll(/^sitemap:\s*(https:\/\/\S+)/gim)) pending.push(match[1]); } catch (error) { if (signal?.aborted) throw error; /* fallback sitemap candidates remain */ }
  while (pending.length && seen.size < 50) { signal?.throwIfAborted(); const candidate = pending.shift()!; if (seen.has(candidate)) continue; seen.add(candidate); try { const response = await fetchSafe(candidate, 'application/xml,text/xml', signal); if (!response.ok) continue; const xml = await readLimited(response, 5_000_000); const locations = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((match) => { try { const value = new URL(match[1].replace(/&amp;/g, '&'), root); value.hash = ''; return value.protocol === 'https:' && sameSite(value.hostname, root.hostname) ? value.toString() : null; } catch { return null; } }).filter((value): value is string => Boolean(value)); if (/<sitemapindex\b/i.test(xml)) pending.push(...locations); else pages.push(...locations.filter((value) => !SKIP.test(new URL(value).pathname))); } catch (error) { if (signal?.aborted) throw error; /* malformed sitemap does not abort link discovery */ } }
  return [...new Set(pages)];
}

export function resolveCrawlScope(rootUrl: string, sitemapPages: string[]) {
  const urls = [...new Set(sitemapPages)];
  return urls.length
    ? { urls, source: 'sitemap' as const, followInternalLinks: false }
    : { urls: [rootUrl], source: 'link-discovery' as const, followInternalLinks: true };
}

export async function runPropertyCrawl(request: CrawlRequest): Promise<void> {
  let processed = 0; let discoveredCount = 1; let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    void callback(request, { action: 'heartbeat', processed, discovered: Math.max(1, discoveredCount) })
      .catch((error) => console.warn(`[property-crawl:${request.requestId}] heartbeat failed`, error))
      .finally(() => { heartbeatBusy = false; });
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    const root = await safeUrl(request.rootUrl); const scope = resolveCrawlScope(root.toString(), await discoverSitemaps(root, request.signal)); const resolvePattern = createRoutePatternResolver(scope.urls); const queue = request.maxPages ? scope.urls.slice(0, request.maxPages) : [...scope.urls]; const queued = new Set(queue); const visited = new Set<string>(); const evidence: CrawlEvidence[] = [];
    const hasCapacity = () => request.maxPages === undefined || visited.size < request.maxPages;
    const discovered = () => request.maxPages === undefined ? visited.size + queue.length : Math.min(request.maxPages, visited.size + queue.length);
    discoveredCount = Math.max(1, queue.length);
    await callback(request, { action: 'progress', processed: 0, discovered: Math.max(1, queue.length), message: scope.source === 'sitemap' ? `Found ${queue.length} submitted sitemap pages; beginning crawl…` : 'No usable sitemap pages found; discovering pages from first-party links…' });
    while (queue.length && hasCapacity()) {
      request.signal?.throwIfAborted(); const target = queue.shift()!; if (visited.has(target)) continue; visited.add(target);
      processed = visited.size; discoveredCount = discovered();
      try {
        const response = await fetchSafe(target, undefined, request.signal); const contentType = response.headers.get('content-type') ?? ''; const finalUrl = new URL(response.url || target); if (!sameSite(finalUrl.hostname, root.hostname)) continue; const html = contentType.includes('text/html') ? await readLimited(response, MAX_HTML) : ''; const page = await enrichRendered(request, extractPage(html, finalUrl, response.status, contentType, resolvePattern(new URL(target))));
        evidence.push({ url: page.url, title: page.title, description: page.description, h1: page.h1, h2: page.h2, metaKeywords: page.metaKeywords, routePattern: page.routePattern });
        if (scope.followInternalLinks) for (const link of page.internalLinks) if (!queued.has(link) && !visited.has(link) && (request.maxPages === undefined || queue.length + visited.size < request.maxPages)) { queued.add(link); queue.push(link); }
        discoveredCount = discovered();
        await callback(request, { action: 'page', processed, discovered: discoveredCount, page: archivedPage(page) });
      } catch (error) {
        if (request.signal?.aborted) throw error;
        const url = new URL(target); await callback(request, { action: 'page', processed, discovered: discoveredCount, page: { url: target, routePattern: resolvePattern(url), h1: [], h2: [], h3: [], metaKeywords: [], wordCount: 0, internalLinks: [], externalLinks: [], imageCount: 0, imagesMissingAlt: 0, structuredDataTypes: [], indexable: false, issues: [`Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`], fetchedAt: new Date().toISOString(), renderMode: 'html' } });
      }
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
    await callback(request, { action: 'progress', processed: visited.size, discovered: Math.max(visited.size, discovered()), message: 'Analyzing property positioning, audience, keywords, and competitors…' });
    await callback(request, { action: 'analysis', analysis: await analyzeProperty(evidence, root.toString(), request.signal) });
    await callback(request, { action: 'complete' });
  } catch (error) {
    if (request.signal?.aborted) {
      console.info(`[property-crawl:${request.requestId}] cancelled`);
      return;
    }
    const message = error instanceof Error ? error.message.slice(0, 1500) : 'Property crawl failed.';
    console.error(`[property-crawl:${request.requestId}] ${message}`);
    await callback(request, { action: 'failed', error: message }).catch((callbackError) => {
      console.error(`[property-crawl:${request.requestId}] failure callback failed`, callbackError);
    });
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
