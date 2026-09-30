import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { isBrowserWorkerConfigured } from '@/lib/ai/tools/browseRouter';

export type BrowserNavigateResult = {
  url: string;
  title: string | null;
  text: string;
  note: string;
  /** Absolute https image URLs discovered on the page (og:image, content imgs). */
  images: string[];
};

function sanitizeImageList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const url = item.trim();
    if (!/^https:\/\//i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url.slice(0, 4000));
    if (out.length >= 12) break;
  }
  return out;
}

/** Call the optional Playwright browser worker. Fail closed when unset. */
export async function browserNavigate(
  rawUrl: string,
  options: { signal?: AbortSignal; fetcher?: typeof fetch } = {}
): Promise<BrowserNavigateResult> {
  if (!isBrowserWorkerConfigured()) {
    throw new Error(
      'Browser worker is not configured (set NUCLEAS_BROWSER_WORKER_URL and NUCLEAS_BROWSER_WORKER_SECRET). Use web_fetch instead.'
    );
  }
  const target = assertSafePublicHttpsUrl(rawUrl);
  const workerBase = process.env.NUCLEAS_BROWSER_WORKER_URL!.replace(/\/+$/, '');
  const workerUrl = assertSafePublicHttpsUrl(`${workerBase}/navigate`);
  const secret = process.env.NUCLEAS_BROWSER_WORKER_SECRET!.trim();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) throw new Error('Browser navigate cancelled.');
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 45000);
  try {
    const response = await (options.fetcher ?? fetch)(workerUrl, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ url: target.toString(), maxChars: 12000 }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Browser worker rejected the navigate request.');
    }
    const body = (await response.json()) as {
      url?: string;
      title?: string | null;
      text?: string;
      images?: unknown;
    };
    return {
      url: typeof body.url === 'string' ? body.url : target.toString(),
      title: typeof body.title === 'string' ? body.title.slice(0, 200) : null,
      text: typeof body.text === 'string' ? body.text.slice(0, 12000) : '',
      note: 'Rendered via Playwright browser worker.',
      images: sanitizeImageList(body.images),
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export type BrowserObserveResult = { url: string; title: string | null; loggedIn: boolean; text: string; note: string };

/**
 * Open one page of a company's own site with its captured admin session (read-only) through the browser
 * worker. The worker never returns the cookies; nothing here logs the request body.
 */
export async function browserObserve(
  input: { baseUrl: string; url: string; cookies: unknown[] },
  options: { signal?: AbortSignal; fetcher?: typeof fetch; timeoutMs?: number } = {}
): Promise<BrowserObserveResult> {
  if (!isBrowserWorkerConfigured()) {
    throw new Error('Browser worker is not configured (set NUCLEAS_BROWSER_WORKER_URL and NUCLEAS_BROWSER_WORKER_SECRET).');
  }
  const base = assertSafePublicHttpsUrl(input.baseUrl);
  const target = assertSafePublicHttpsUrl(input.url);
  if (base.origin !== target.origin) throw new Error('The page is outside the admin account’s site.');
  const workerBase = process.env.NUCLEAS_BROWSER_WORKER_URL!.replace(/\/+$/, '');
  const workerUrl = assertSafePublicHttpsUrl(`${workerBase}/observe`);
  const secret = process.env.NUCLEAS_BROWSER_WORKER_SECRET!.trim();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) throw new Error('Browser observe cancelled.');
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, options.timeoutMs ?? 60000);
  try {
    const response = await (options.fetcher ?? fetch)(workerUrl, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ baseUrl: base.origin, url: target.toString(), cookies: input.cookies, maxChars: 20000 }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('The browser worker could not open the page with the admin session (is it up to date?).');
    }
    const body = (await response.json()) as { url?: string; title?: string | null; loggedIn?: boolean; text?: string; note?: string };
    return {
      url: typeof body.url === 'string' ? body.url : target.toString(),
      title: typeof body.title === 'string' ? body.title.slice(0, 200) : null,
      loggedIn: body.loggedIn === true,
      text: typeof body.text === 'string' ? body.text.slice(0, 40000) : '',
      note: typeof body.note === 'string' ? body.note.slice(0, 300) : '',
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}
