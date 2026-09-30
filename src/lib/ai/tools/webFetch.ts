import { assertSafePublicHttpsUrl, isSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';

const MAX_BYTES = 250_000;
const TIMEOUT_MS = 12_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type WebFetchResult = {
  url: string;
  title: string | null;
  text: string;
  thin: boolean;
  escalateHint: boolean;
  links: string[];
};

function extractLinks(raw: string, base: URL): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  for (const match of raw.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const href = new URL(match[1], base).toString();
      if (!isSafePublicHttpsUrl(href) || seen.has(href)) continue;
      seen.add(href);
      links.push(href.slice(0, 4000));
      if (links.length >= 500) break;
    } catch {
      // Ignore malformed page links.
    }
  }
  return links;
}

export async function webFetch(
  rawUrl: string,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {}
): Promise<WebFetchResult> {
  const url = assertSafePublicHttpsUrl(rawUrl);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) throw new Error('Fetch cancelled.');
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, TIMEOUT_MS);
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Fetch failed with HTTP ${response.status}.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty response body.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(Math.min(size, MAX_BYTES));
    let offset = 0;
    for (const chunk of chunks) {
      const slice = chunk.byteLength + offset > MAX_BYTES ? chunk.subarray(0, MAX_BYTES - offset) : chunk;
      bytes.set(slice, offset);
      offset += slice.byteLength;
      if (offset >= MAX_BYTES) break;
    }
    const raw = new TextDecoder().decode(bytes.subarray(0, offset));
    const contentType = response.headers.get('content-type') ?? '';
    let text = raw;
    let title: string | null = null;
    if (contentType.includes('html') || /<html/i.test(raw)) {
      const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      title = titleMatch?.[1] ? stripHtml(titleMatch[1]).slice(0, 200) : null;
      text = stripHtml(raw);
    }
    text = text.slice(0, 12000);
    const thin =
      text.length < 280 ||
      /you need to enable javascript|enable javascript|noscript|__NEXT_DATA__|window\.__/i.test(raw);
    const escalateHint =
      thin ||
      /react-root|data-reactroot|ng-app|__NEXT_DATA__|webpackJsonp/i.test(raw.slice(0, 4000));
    return { url: url.toString(), title, text, thin, escalateHint, links: extractLinks(raw, url) };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}
