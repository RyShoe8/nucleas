import 'server-only';
import { Types } from 'mongoose';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { getAppBaseUrl } from '@/lib/utils/appBaseUrl';
import { PropertyOverview } from '@/lib/models/PropertyOverview';
import { failPropertyOverviewJob, queuePropertyOverviewJob, startPropertyOverviewJob } from './job';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class PropertyCrawlBusyError extends Error {
  constructor() {
    super('The VPS crawl worker is busy.');
    this.name = 'PropertyCrawlBusyError';
  }
}

/** Hand a long-running Company Overview crawl to the VPS and return as soon as it accepts the job. */
export async function dispatchPropertyOverview(input: { overviewId: string; rootUrl: string }, fetchImpl: FetchLike = fetch): Promise<void> {
  const base = process.env.NUCLEAS_EXECUTION_WORKER_URL?.trim().replace(/\/+$/, '');
  const token = process.env.NUCLEAS_EXECUTION_WORKER_TOKEN?.trim();
  if (!base || !token) throw new Error('The VPS execution worker is not configured.');
  const endpoint = assertSafePublicHttpsUrl(`${base}/v1/property-crawls`);
  const callbackUrl = `${getAppBaseUrl()}/api/internal/property-overviews/${input.overviewId}`;
  const browserUrl = process.env.NUCLEAS_BROWSER_WORKER_URL?.trim().replace(/\/+$/, '');
  const browserSecret = process.env.NUCLEAS_BROWSER_WORKER_SECRET?.trim();
  const response = await fetchImpl(endpoint, {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 1, requestId: input.overviewId, rootUrl: assertSafePublicHttpsUrl(input.rootUrl).toString(), callbackUrl, ...(browserUrl?.startsWith('https://') && browserSecret && browserSecret.length >= 16 ? { browserWorker: { url: browserUrl, secret: browserSecret } } : {}) }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    if (response.status === 429) throw new PropertyCrawlBusyError();
    if (response.status === 400 && detail.includes('Invalid property crawl request')) {
      throw new Error('The VPS crawl worker is out of date. Rebuild it from the latest main branch before starting a full-site Company Overview.');
    }
    throw new Error(`VPS crawl worker returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
}

/**
 * Claims and dispatches the oldest queued crawl. A busy worker is normal capacity pressure: the
 * claim is returned to the durable queue and a later cron/callback advances it.
 */
export async function processPropertyOverviewQueue(options: { fetchImpl?: FetchLike } = {}): Promise<'started' | 'busy' | 'empty' | 'failed'> {
  const staleReservation = new Date(Date.now() - 5 * 60_000);
  await PropertyOverview.updateMany(
    { status: 'dispatching', updatedAt: { $lt: staleReservation } },
    { $set: { status: 'queued', progress: 'Queued · recovering an interrupted worker reservation' } }
  );
  const claimed = await PropertyOverview.findOneAndUpdate(
    { status: 'queued' },
    { $set: { status: 'dispatching', progress: 'Reserving the VPS crawl worker…' } },
    { sort: { createdAt: 1 }, new: true }
  ).lean<{ _id: Types.ObjectId; jobId?: Types.ObjectId; runId?: Types.ObjectId; rootUrl: string }>();
  if (!claimed) return 'empty';

  try {
    await dispatchPropertyOverview({ overviewId: String(claimed._id), rootUrl: claimed.rootUrl }, options.fetchImpl);
    const now = new Date();
    await Promise.all([
      PropertyOverview.updateOne(
        { _id: claimed._id, status: 'dispatching' },
        { $set: { status: 'crawling', startedAt: now, progress: 'VPS worker is discovering pages…' } }
      ),
      startPropertyOverviewJob({ jobId: claimed.jobId, runId: claimed.runId, now }),
    ]);
    return 'started';
  } catch (error) {
    if (error instanceof PropertyCrawlBusyError) {
      await Promise.all([
        PropertyOverview.updateOne(
          { _id: claimed._id, status: 'dispatching' },
          { $set: { status: 'queued', progress: 'Queued · waiting for the VPS crawl worker' } }
        ),
        queuePropertyOverviewJob({ runId: claimed.runId }),
      ]);
      return 'busy';
    }
    const message = error instanceof Error ? error.message : 'Could not start the VPS crawl.';
    await PropertyOverview.updateOne(
      { _id: claimed._id, status: 'dispatching' },
      { $set: { status: 'failed', completedAt: new Date(), progress: 'Failed to start', error: message } }
    );
    await failPropertyOverviewJob({ jobId: claimed.jobId, runId: claimed.runId, error: message });
    return 'failed';
  }
}
