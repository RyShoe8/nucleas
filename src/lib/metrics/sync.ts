import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import Client from '@/lib/models/Client';
import { IntegrationConnection } from '@/lib/models/Integration';
import { MetricSnapshot, MetricSyncState } from '@/lib/models/Metric';
import { invokeCapability } from '@/lib/capabilities/runtime';
import { defaultRange, isoDate } from '@/lib/capabilities/adapters/http';
import { SEARCH_LAG_DAYS } from '@/lib/capabilities/registry';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { METRICS, SYNC_CAPABILITIES, type MetricPoint } from './catalog';
import { dailyEventCounts, EVENTS_PROVIDER } from '@/lib/integrations/companyEvents';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const BACKFILL_DAYS = 90;
export const REFRESH_DAYS = 3;
const SYNC_INTERVAL_MS = 55 * 60 * 1000;
const LEASE_MS = 4 * 60 * 1000;

/** Every UTC date in a capability's fetch window — the same range the capability requests. */
export function windowDates(capabilityId: string, days: number, now: Date): string[] {
  const { startDate, endDate } = defaultRange(days, now, capabilityId === 'search.performance.read' ? SEARCH_LAG_DAYS : 1);
  const out: string[] = [];
  for (const d = new Date(`${startDate}T00:00:00Z`); isoDate(d) <= endDate; d.setUTCDate(d.getUTCDate() + 1)) out.push(isoDate(d));
  return out;
}

function systemViewer(organizationId: Types.ObjectId): CompanyViewer {
  return { userId: 'system', organizationId, employeeId: null, role: 'Administrator' };
}

async function connectedProviders(organizationId: Types.ObjectId, companyId: Types.ObjectId): Promise<Set<string>> {
  const rows = await IntegrationConnection.find({
    organizationId,
    status: 'connected',
    planLimited: { $ne: true },
    $or: [{ companyId }, { companyId: null }],
  })
    .select('provider')
    .lean<{ provider: string }[]>();
  return new Set(rows.map((r) => r.provider));
}

export interface CompanySyncResult {
  written: number;
  results: { capabilityId: string; status: string; error?: string }[];
}

/** Pulls each connected source for one company and upserts its daily metric values. */
export async function syncCompanyMetrics(
  organizationId: Types.ObjectId,
  companyId: Types.ObjectId,
  options: { days: number | ((capabilityId: string) => number); now?: Date; fetchImpl?: FetchLike }
): Promise<CompanySyncResult> {
  const now = options.now ?? new Date();
  const today = isoDate(now);
  const providers = await connectedProviders(organizationId, companyId);
  const result: CompanySyncResult = { written: 0, results: [] };
  const daysFor = (id: string) => (typeof options.days === 'function' ? options.days(id) : options.days);

  for (const cap of SYNC_CAPABILITIES) {
    if (!providers.has(cap.provider)) continue;
    const days = daysFor(cap.capabilityId);
    const res = await invokeCapability(systemViewer(organizationId), String(companyId), cap.capabilityId, cap.windowed ? { days } : {}, {
      system: 'metrics-sync',
      fetchImpl: options.fetchImpl,
      now,
    });
    if (!res.ok) {
      result.results.push({ capabilityId: cap.capabilityId, status: 'rejected', error: res.error });
      continue;
    }
    const inv = res.invocation;
    result.results.push({ capabilityId: cap.capabilityId, status: inv.status, error: inv.error });
    if (inv.status !== 'succeeded' || inv.output == null) continue;

    const dates = cap.windowed ? windowDates(cap.capabilityId, days, now) : [];
    const ops = [];
    for (const metric of METRICS.filter((m) => m.capabilityId === cap.capabilityId)) {
      let points: MetricPoint[];
      try {
        points = metric.extract(inv.output, today);
      } catch {
        continue;
      }
      if (metric.kind === 'daily' && dates.length) {
        // Days without activity are written as 0 so a revised day never keeps a stale value.
        const byDate = new Map(points.map((p) => [p.date, p]));
        points = dates.map((date) => byDate.get(date) ?? { date, value: 0 });
      }
      for (const p of points) {
        ops.push({
          updateOne: {
            filter: { companyId, metricKey: metric.key, date: p.date },
            update: {
              $set: { organizationId, value: p.value, breakdown: p.breakdown ?? null, invocationId: new Types.ObjectId(inv.id) },
            },
            upsert: true,
          },
        });
      }
    }
    if (ops.length) {
      await MetricSnapshot.bulkWrite(ops, { ordered: false });
      result.written += ops.length;
    }
  }
  if (providers.has(EVENTS_PROVIDER)) {
    // First-party signup events are already in Nucleas; aggregate them into daily counts.
    const days = daysFor('internal.events.signups');
    const counts = await dailyEventCounts(companyId, 'user.signed_up', windowDates('internal.events.signups', days, now));
    await MetricSnapshot.bulkWrite(
      counts.map((p) => ({
        updateOne: { filter: { companyId, metricKey: 'users_new', date: p.date }, update: { $set: { organizationId, value: p.value } }, upsert: true },
      })),
      { ordered: false }
    );
    result.written += counts.length;
    result.results.push({ capabilityId: 'internal.events.signups', status: 'succeeded' });
  }
  return result;
}

/**
 * Syncs one company under a lease. Each source backfills its history on its first successful run;
 * later runs refresh the last few days (providers revise them). `force` ignores the hourly interval
 * (manual "Sync now") but never an active lease.
 */
export async function runCompanySync(
  company: { _id: Types.ObjectId; organizationId: Types.ObjectId },
  options: { now?: Date; force?: boolean; fetchImpl?: FetchLike } = {}
): Promise<{ status: 'synced' | 'busy' | 'not_due'; result?: CompanySyncResult }> {
  const now = options.now ?? new Date();
  const token = randomUUID();
  await MetricSyncState.updateOne({ companyId: company._id }, { $setOnInsert: { organizationId: company.organizationId } }, { upsert: true });

  const leaseFree = { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lt: now } }] };
  const due = { $or: [{ lastRunAt: { $exists: false } }, { lastRunAt: null }, { lastRunAt: { $lt: new Date(now.getTime() - SYNC_INTERVAL_MS) } }] };
  const claimed = await MetricSyncState.findOneAndUpdate(
    { companyId: company._id, $and: options.force ? [leaseFree] : [leaseFree, due] },
    { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS), leaseToken: token } },
    { new: true }
  ).lean();
  if (!claimed) {
    const state = await MetricSyncState.findOne({ companyId: company._id }).select('leaseUntil').lean<{ leaseUntil?: Date }>();
    return { status: state?.leaseUntil && state.leaseUntil > now ? 'busy' : 'not_due' };
  }

  try {
    const done = new Set(claimed.backfilledCapabilities ?? []);
    const result = await syncCompanyMetrics(company.organizationId, company._id, {
      days: (id) => (done.has(id) ? REFRESH_DAYS : BACKFILL_DAYS),
      now,
      fetchImpl: options.fetchImpl,
    });
    const ok = result.results.every((r) => r.status === 'succeeded');
    const newlyBackfilled = result.results.filter((r) => r.status === 'succeeded' && !done.has(r.capabilityId)).map((r) => r.capabilityId);
    await MetricSyncState.updateOne(
      { companyId: company._id, leaseToken: token },
      {
        $set: {
          lastRunAt: now,
          ...(ok ? { lastSuccessAt: now } : {}),
          lastSummary: result.results.map((r) => `${r.capabilityId}:${r.status}`).join(' ').slice(0, 500),
        },
        $unset: { leaseUntil: '', leaseToken: '' },
        ...(newlyBackfilled.length ? { $addToSet: { backfilledCapabilities: { $each: newlyBackfilled } } } : {}),
      }
    );
    return { status: 'synced', result };
  } catch (err) {
    await MetricSyncState.updateOne({ companyId: company._id, leaseToken: token }, { $set: { lastRunAt: now }, $unset: { leaseUntil: '', leaseToken: '' } });
    throw err;
  }
}

/** Cron entry: syncs due companies (last run over ~an hour ago) within a time budget. */
export async function processMetricSync(options: { now?: Date; budgetMs?: number; maxCompanies?: number; fetchImpl?: FetchLike } = {}) {
  const started = Date.now();
  const budgetMs = options.budgetMs ?? 240_000;
  const maxCompanies = options.maxCompanies ?? 10;
  const summary = { synced: 0, skipped: 0, failed: 0 };

  const companyIds = (await IntegrationConnection.distinct('companyId', { status: 'connected', companyId: { $ne: null } })) as Types.ObjectId[];
  const companies = await Client.find({ _id: { $in: companyIds } })
    .select('organizationId')
    .lean<{ _id: Types.ObjectId; organizationId: Types.ObjectId }[]>();

  for (const company of companies) {
    if (summary.synced + summary.failed >= maxCompanies || Date.now() - started > budgetMs) break;
    try {
      const res = await runCompanySync(company, { now: options.now, fetchImpl: options.fetchImpl });
      if (res.status === 'synced') summary.synced += 1;
      else summary.skipped += 1;
    } catch (err) {
      console.error('[metrics-sync] company failed', String(company._id), err instanceof Error ? err.message : 'unknown');
      summary.failed += 1;
    }
  }
  return summary;
}
