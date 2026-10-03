import 'server-only';
import { Types } from 'mongoose';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { getAppBaseUrl } from '@/lib/utils/appBaseUrl';
import { JobRun } from '@/lib/models/Job';
import { PropertyOverview, PropertyPage } from '@/lib/models/PropertyOverview';
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

async function cancelWorkerCrawl(overviewId: string, fetchImpl: FetchLike): Promise<void> {
  const base = process.env.NUCLEAS_EXECUTION_WORKER_URL?.trim().replace(/\/+$/, '');
  const token = process.env.NUCLEAS_EXECUTION_WORKER_TOKEN?.trim();
  if (!base || !token) return;
  const response = await fetchImpl(assertSafePublicHttpsUrl(`${base}/v1/property-crawls/${overviewId}`), {
    method: 'DELETE', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8_000),
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) throw new Error(`VPS crawl cancellation returned HTTP ${response.status}.`);
}

/** Cancels and removes an unfinished crawl while preserving any previous completed Company Overview. */
export async function cancelPropertyOverviewForJob(jobId: Types.ObjectId, reason: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  const now = new Date();
  const overview = await PropertyOverview.findOneAndUpdate(
    { jobId, status: { $in: ['queued', 'dispatching', 'crawling'] } },
    { $set: { status: 'failed', completedAt: now, progress: 'Cancelled', error: reason.slice(0, 1500) } },
    { new: true }
  ).select('_id runId').lean<{ _id: Types.ObjectId; runId?: Types.ObjectId }>();
  if (!overview) return false;
  await cancelWorkerCrawl(String(overview._id), fetchImpl).catch((error) => {
    console.error('[property-overview] worker cancellation failed', error instanceof Error ? error.message : 'unknown');
  });
  await Promise.all([
    PropertyPage.deleteMany({ overviewId: overview._id }),
    overview.runId ? JobRun.updateOne(
      { _id: overview.runId, status: 'running' },
      { $set: { status: 'failed', error: reason.slice(0, 1000), finishedAt: now, progressState: { stage: 'complete', label: 'Cancelled', percent: 100, updatedAt: now } }, $unset: { leaseExpiresAt: '' } }
    ) : Promise.resolve(),
  ]);
  await PropertyOverview.deleteOne({ _id: overview._id });
  return true;
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
