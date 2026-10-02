import 'server-only';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { getAppBaseUrl } from '@/lib/utils/appBaseUrl';

/** Hand a long-running Company Overview crawl to the VPS and return as soon as it accepts the job. */
export async function dispatchPropertyOverview(input: { overviewId: string; rootUrl: string }): Promise<void> {
  const base = process.env.NUCLEAS_EXECUTION_WORKER_URL?.trim().replace(/\/+$/, '');
  const token = process.env.NUCLEAS_EXECUTION_WORKER_TOKEN?.trim();
  if (!base || !token) throw new Error('The VPS execution worker is not configured.');
  const endpoint = assertSafePublicHttpsUrl(`${base}/v1/property-crawls`);
  const callbackUrl = `${getAppBaseUrl()}/api/internal/property-overviews/${input.overviewId}`;
  const browserUrl = process.env.NUCLEAS_BROWSER_WORKER_URL?.trim().replace(/\/+$/, '');
  const browserSecret = process.env.NUCLEAS_BROWSER_WORKER_SECRET?.trim();
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 1, requestId: input.overviewId, rootUrl: assertSafePublicHttpsUrl(input.rootUrl).toString(), callbackUrl, ...(browserUrl?.startsWith('https://') && browserSecret && browserSecret.length >= 16 ? { browserWorker: { url: browserUrl, secret: browserSecret } } : {}) }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    if (response.status === 400 && detail.includes('Invalid property crawl request')) {
      throw new Error('The VPS crawl worker is out of date. Rebuild it from the latest main branch before starting a full-site Company Overview.');
    }
    throw new Error(`VPS crawl worker returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
}
