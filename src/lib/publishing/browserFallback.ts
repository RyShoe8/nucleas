import { browserFetch, type BrowserFetchResult } from '@/lib/ai/tools/browserClient';
import { isBrowserWorkerConfigured } from '@/lib/ai/tools/browseRouter';
import type { FetchLike } from './fetchPublic';

/**
 * Some sites answer requests from cloud-provider addresses (where Nucleas's servers run) with 403 or a challenge,
 * while serving ordinary machines. When a page, sitemap or feed is refused that way, ask the browser worker to
 * fetch it instead and hand the body back as if it had come straight from the site. Only text pages: images and
 * anything that is not a plain GET are left alone. A host that refused once is sent straight to the worker for
 * a while, so a run does not repeat the refused attempts.
 */

const REFUSED = new Set([401, 403, 429, 503]);
const HOST_MEMORY_MS = 30 * 60_000;
const refusedHosts = new Map<string, number>();

/** For tests. */
export function forgetRefusedHosts() {
  refusedHosts.clear();
}

const wantsText = (init?: RequestInit) => {
  const accept = new Headers(init?.headers).get('accept') ?? '';
  return /html|xml|text|json|\*\/\*/.test(accept);
};

export function withBrowserFallback(base: FetchLike = fetch, browser: (url: string) => Promise<BrowserFetchResult> = (url) => browserFetch(url), configured: () => boolean = isBrowserWorkerConfigured): FetchLike {
  const viaBrowser = async (url: string): Promise<Response | null> => {
    try {
      const page = await browser(url);
      if (page.status < 200 || page.status >= 300) return null;
      return new Response(page.body, { status: 200, headers: { 'content-type': page.contentType || 'text/html' } });
    } catch {
      return null;
    }
  };
  return async (url, init) => {
    const eligible = (init?.method ?? 'GET').toUpperCase() === 'GET' && wantsText(init) && configured();
    const host = new URL(url).host;
    if (eligible && (refusedHosts.get(host) ?? 0) > Date.now()) {
      const rendered = await viaBrowser(url);
      if (rendered) return rendered;
    }
    const res = await base(url, init);
    if (!eligible || !REFUSED.has(res.status)) return res;
    const rendered = await viaBrowser(url);
    if (!rendered) return res;
    await res.body?.cancel().catch(() => undefined);
    refusedHosts.set(host, Date.now() + HOST_MEMORY_MS);
    return rendered;
  };
}
