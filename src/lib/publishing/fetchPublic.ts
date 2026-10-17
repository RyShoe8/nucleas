import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';

/**
 * Fetches a public HTTPS resource for publishing (sitemaps, pages, images). Every redirect target is
 * checked again, and bodies are capped, so a company's site cannot point Nucleas at a private address.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const MAX_REDIRECTS = 4;

export interface PublicResponse {
  url: string;
  contentType: string;
  bytes: Uint8Array;
}

export async function fetchPublic(
  rawUrl: string,
  options: { accept?: string; maxBytes?: number; timeoutMs?: number; fetcher?: FetchLike; headers?: Record<string, string> } = {}
): Promise<PublicResponse> {
  const fetcher = options.fetcher ?? fetch;
  const maxBytes = options.maxBytes ?? 2_000_000;
  let url = assertSafePublicHttpsUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetcher(url.toString(), {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: { accept: options.accept ?? '*/*', 'user-agent': 'NucleasBot/1.0 (+https://nucleas.app)', ...options.headers },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error(`Redirect without a location from ${url.host}.`);
      url = assertSafePublicHttpsUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`${url.host} returned ${response.status}.`);
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`The file at ${url.host} is too large.`);
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error(`The file at ${url.host} is too large.`);
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { url: url.toString(), contentType: (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(), bytes };
  }
  throw new Error('Too many redirects.');
}

export async function fetchPublicText(rawUrl: string, options: Parameters<typeof fetchPublic>[1] = {}): Promise<{ url: string; contentType: string; text: string }> {
  const res = await fetchPublic(rawUrl, options);
  return { url: res.url, contentType: res.contentType, text: new TextDecoder().decode(res.bytes) };
}
