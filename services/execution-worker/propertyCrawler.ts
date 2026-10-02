import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

type CrawlRequest = { requestId: string; rootUrl: string; callbackUrl: string; maxPages: number; browserWorker?: { url: string; secret: string } };
const MAX_HTML = 700_000; const TIMEOUT = 30_000; const DELAY_MS = 250;
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
async function fetchSafe(raw: string, accept = 'text/html,application/xhtml+xml,*/*;q=0.5'): Promise<Response> {
  let url = await safeUrl(raw);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: accept, 'User-Agent': 'NucleasPropertyAudit/1.0 (+https://nucleas.app)' } });
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
function route(url: URL) { return '/' + url.pathname.split('/').filter(Boolean).map((part) => DYNAMIC.test(decodeURIComponent(part)) ? ':id' : part).join('/'); }

export function extractPage(html: string, url: URL, statusCode: number, contentType: string) {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]); const h1 = all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi); const h2 = all(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi); const h3 = all(html, /<h3[^>]*>([\s\S]*?)<\/h3>/gi);
  const meta = (name: string) => attr(html.match(new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`, 'i'))?.[0] ?? '', 'content');
  const link = (rel: string) => attr(html.match(new RegExp(`<link\\b[^>]*rel\\s*=\\s*["'][^"']*${rel}[^"']*["'][^>]*>`, 'i'))?.[0] ?? '', 'href');
  const anchors = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((match) => absolute(match[1], url)).filter((value): value is string => Boolean(value));
  const internalLinks = [...new Set(anchors.filter((value) => sameSite(new URL(value).hostname, url.hostname)))]; const externalLinks = [...new Set(anchors.filter((value) => !sameSite(new URL(value).hostname, url.hostname)))];
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]); const description = meta('description'); const robots = meta('robots'); const canonical = absolute(link('canonical'), url) ?? ''; const language = attr(html.match(/<html\b[^>]*>/i)?.[0] ?? '', 'lang');
  const body = clean((html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '').replace(/<(?:script|style|svg)[^>]*>[\s\S]*?<\/(?:script|style|svg)>/gi, '')); const wordCount = body.split(/\s+/).filter(Boolean).length;
  const structuredDataTypes = [...new Set([...html.matchAll(/["']@type["']\s*:\s*["']([^"']+)["']/gi)].map((match) => match[1]))]; const skeleton = html.toLowerCase().replace(/<script[\s\S]*?<\/script>/g, '').replace(/>[^<]+</g, '><').match(/<(?:header|nav|main|aside|footer|article|section)\b[^>]*>/g)?.join('|') ?? route(url);
  const issues: string[] = []; if (statusCode >= 400) issues.push(`HTTP ${statusCode}`); if (!title) issues.push('Missing title'); else if (title.length < 30 || title.length > 60) issues.push(`Title length ${title.length}`); if (!description) issues.push('Missing meta description'); else if (description.length < 70 || description.length > 160) issues.push(`Meta description length ${description.length}`); if (!h1.length) issues.push('Missing H1'); else if (h1.length > 1) issues.push(`${h1.length} H1 headings`); if (!canonical) issues.push('Missing canonical'); if (!language) issues.push('Missing HTML language'); const imagesMissingAlt = images.filter((tag) => !/\balt\s*=\s*["'][^"']*["']/i.test(tag)).length; if (imagesMissingAlt) issues.push(`${imagesMissingAlt} images missing alt text`); if (wordCount < 100) issues.push('Thin content');
  const published = meta('article:published_time') || html.match(/["']datePublished["']\s*:\s*["']([^"']+)/i)?.[1]; const modified = meta('article:modified_time') || html.match(/["']dateModified["']\s*:\s*["']([^"']+)/i)?.[1];
  return { url: url.toString(), routePattern: route(url), statusCode, contentType, title, description, canonical, robots, language, h1, h2, h3, metaKeywords: meta('keywords').split(',').map((item) => item.trim()).filter(Boolean), wordCount, internalLinks, externalLinks, imageCount: images.length, imagesMissingAlt, structuredDataTypes, ...(published && !Number.isNaN(Date.parse(published)) ? { datePublished: new Date(published).toISOString() } : {}), ...(modified && !Number.isNaN(Date.parse(modified)) ? { dateModified: new Date(modified).toISOString() } : {}), indexable: !/noindex/i.test(robots), templateKey: crypto.createHash('sha1').update(skeleton.slice(0, 20_000)).digest('hex').slice(0, 12), issues, fetchedAt: new Date().toISOString(), htmlSnapshot: html, renderMode: 'html' as const };
}

async function enrichRendered(request: CrawlRequest, page: ReturnType<typeof extractPage>) {
  if (!request.browserWorker || (page.wordCount >= 100 && !/__NEXT_DATA__|data-reactroot|ng-app|id=["']root["']/i.test(page.htmlSnapshot))) return page;
  try {
    const endpoint = await safeUrl(`${request.browserWorker.url.replace(/\/+$/, '')}/navigate`);
    const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${request.browserWorker.secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: page.url, maxChars: 50_000 }) });
    if (!response.ok) return page;
    const body = await response.json() as { url?: unknown; title?: unknown; text?: unknown; links?: unknown };
    const renderedText = typeof body.text === 'string' ? body.text.slice(0, 50_000).replace(/\s+/g, ' ').trim() : '';
    const links = Array.isArray(body.links) ? body.links.filter((value): value is string => typeof value === 'string').map((value) => absolute(value, new URL(page.url))).filter((value): value is string => Boolean(value)) : [];
    const internalLinks = [...new Set([...page.internalLinks, ...links.filter((value) => sameSite(new URL(value).hostname, new URL(page.url).hostname))])];
    const externalLinks = [...new Set([...page.externalLinks, ...links.filter((value) => !sameSite(new URL(value).hostname, new URL(page.url).hostname))])];
    const wordCount = Math.max(page.wordCount, renderedText.split(/\s+/).filter(Boolean).length);
    return { ...page, title: page.title || (typeof body.title === 'string' ? body.title.slice(0, 4_000) : ''), wordCount, internalLinks, externalLinks, renderedText, renderMode: 'rendered' as const, issues: page.issues.filter((issue) => issue !== 'Thin content' || wordCount < 100) };
  } catch { return page; }
}

async function callback(request: CrawlRequest, payload: unknown) {
  let last = ''; for (let attempt = 0; attempt < 4; attempt += 1) { try { const response = await fetch(await safeUrl(request.callbackUrl), { method: 'POST', signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${process.env.NUCLEAS_EXECUTION_WORKER_TOKEN!.trim()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); if (response.ok) return; last = `HTTP ${response.status}`; } catch (error) { last = error instanceof Error ? error.message : 'callback failed'; } await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1))); } throw new Error(`Nucleas callback failed: ${last}`);
}
async function discoverSitemaps(root: URL) {
  const pending = [new URL('/sitemap.xml', root).toString(), new URL('/sitemap_index.xml', root).toString()]; const seen = new Set<string>(); const pages: string[] = [];
  try { const robots = await fetchSafe(new URL('/robots.txt', root).toString(), 'text/plain'); if (robots.ok) for (const match of (await readLimited(robots, 1_000_000)).matchAll(/^sitemap:\s*(https:\/\/\S+)/gim)) pending.push(match[1]); } catch { /* fallback sitemap candidates remain */ }
  while (pending.length && seen.size < 50) { const candidate = pending.shift()!; if (seen.has(candidate)) continue; seen.add(candidate); try { const response = await fetchSafe(candidate, 'application/xml,text/xml'); if (!response.ok) continue; const xml = await readLimited(response, 5_000_000); const locations = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((match) => { try { const value = new URL(match[1].replace(/&amp;/g, '&'), root); value.hash = ''; return value.protocol === 'https:' && sameSite(value.hostname, root.hostname) ? value.toString() : null; } catch { return null; } }).filter((value): value is string => Boolean(value)); if (/<sitemapindex\b/i.test(xml)) pending.push(...locations); else pages.push(...locations.filter((value) => !SKIP.test(new URL(value).pathname))); } catch { /* malformed sitemap does not abort link discovery */ } }
  return [...new Set(pages)];
}

export async function runPropertyCrawl(request: CrawlRequest): Promise<void> {
  try {
    const root = await safeUrl(request.rootUrl); const seeds = [root.toString(), ...(await discoverSitemaps(root))]; const queue = [...new Set(seeds)].slice(0, request.maxPages); const queued = new Set(queue); const visited = new Set<string>();
    await callback(request, { action: 'progress', processed: 0, discovered: Math.max(1, queue.length), message: `Discovered ${queue.length} pages; beginning accuracy-first crawl…` });
    while (queue.length && visited.size < request.maxPages) {
      const target = queue.shift()!; if (visited.has(target)) continue; visited.add(target);
      try {
        const response = await fetchSafe(target); const contentType = response.headers.get('content-type') ?? ''; const finalUrl = new URL(response.url || target); if (!sameSite(finalUrl.hostname, root.hostname)) continue; const html = contentType.includes('text/html') ? await readLimited(response, MAX_HTML) : ''; const page = await enrichRendered(request, extractPage(html, finalUrl, response.status, contentType));
        for (const link of page.internalLinks) if (!queued.has(link) && !visited.has(link) && queue.length + visited.size < request.maxPages) { queued.add(link); queue.push(link); }
        await callback(request, { action: 'page', processed: visited.size, discovered: Math.min(request.maxPages, visited.size + queue.length), page });
      } catch (error) {
        const url = new URL(target); await callback(request, { action: 'page', processed: visited.size, discovered: Math.min(request.maxPages, visited.size + queue.length), page: { url: target, routePattern: route(url), h1: [], h2: [], h3: [], metaKeywords: [], wordCount: 0, internalLinks: [], externalLinks: [], imageCount: 0, imagesMissingAlt: 0, structuredDataTypes: [], indexable: false, issues: [`Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`], fetchedAt: new Date().toISOString(), htmlSnapshot: '', renderMode: 'html' } });
      }
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
    await callback(request, { action: 'complete' });
  } catch (error) {
    await callback(request, { action: 'failed', error: error instanceof Error ? error.message.slice(0, 1500) : 'Property crawl failed.' }).catch(() => undefined);
  }
}
