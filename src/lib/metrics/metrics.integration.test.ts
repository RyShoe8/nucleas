import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import { ExternalResource, IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { CapabilityInvocation } from '@/lib/models/Capability';
import { MetricSnapshot, MetricSyncState } from '@/lib/models/Metric';
import { sealSecret } from '@/lib/security/secretBox';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { processMetricSync, runCompanySync, windowDates } from './sync';
import { getCompanyMetrics, getTodayOverview, whatChanged, type MetricView } from './query';

let replica: MongoMemoryReplSet;
const orgId = new Types.ObjectId();
const admin: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: orgId, employeeId: null, role: 'Administrator' };
const NOW = new Date('2026-09-28T15:00:00Z');
let companyId: Types.ObjectId;

beforeAll(async () => {
  vi.stubEnv('NUCLEAS_SECRETS_KEY', 'metrics-test-key');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csecret');
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_metrics_test'));
  await Promise.all([MetricSnapshot.syncIndexes(), MetricSyncState.syncIndexes(), IntegrationConnection.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose.disconnect();
  await replica?.stop();
});

async function connect(provider: string, secretProvider: string, credential: string) {
  const secret = await IntegrationSecret.create({ organizationId: orgId, provider: secretProvider, sealed: sealSecret(`integration:${secretProvider}`, credential) });
  await IntegrationConnection.create({ organizationId: orgId, companyId, provider, scope: 'company', status: 'connected', source: 'manual', secretId: secret._id });
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** GA4 returns sessions = day-of-month for each requested day; Stripe returns one $50 charge on 09-26. */
function fakeProviders(requestedDays: number[] = []) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'at' });
    if (url.includes(':runReport')) {
      const body = JSON.parse(String(init?.body));
      if (body.dimensions[0].name !== 'date') return json({ rows: [] });
      const { startDate, endDate } = body.dateRanges[0];
      const start = new Date(`${startDate}T00:00:00Z`);
      const end = new Date(`${endDate}T00:00:00Z`);
      requestedDays.push(Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
      const rows = [];
      for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        rows.push({ dimensionValues: [{ value: iso.replaceAll('-', '') }], metricValues: [{ value: String(d.getUTCDate()) }, { value: '1' }, { value: '1' }, { value: '2' }] });
      }
      return json({ rows });
    }
    if (url.startsWith('https://api.stripe.com/v1/charges')) {
      return json({ data: [{ id: 'ch1', amount: 5000, amount_refunded: 0, currency: 'usd', paid: true, status: 'succeeded', created: Date.parse('2026-09-26T10:00:00Z') / 1000 }], has_more: false });
    }
    if (url.startsWith('https://api.stripe.com/v1/')) return json({ data: [], has_more: false });
    return json({});
  });
}

beforeEach(async () => {
  await Promise.all([
    Client.deleteMany({}), Project.deleteMany({}), IntegrationConnection.deleteMany({}), IntegrationSecret.deleteMany({}),
    ExternalResource.deleteMany({}), CapabilityInvocation.deleteMany({}), MetricSnapshot.deleteMany({}), MetricSyncState.deleteMany({}),
  ]);
  const hub = await Project.create({ name: 'Frugal Gambler', projectType: 'internal', category: 'website', status: 'launched', color: '#111', userId: new Types.ObjectId() });
  const company = await Client.create({ organizationId: orgId, name: 'Frugal Gambler', color: '#111', relationship: 'owned', domain: 'frugalgambler.club', hubProjectId: hub._id });
  companyId = company._id as Types.ObjectId;
  await connect('ga4', 'google', 'refresh');
  await ExternalResource.create({ organizationId: orgId, companyId, provider: 'ga4', resourceType: 'property', externalId: '469087296', canonicalType: 'Company', canonicalId: companyId });
  await connect('stripe', 'stripe', 'rk_live_x');
});

describe('metric sync', () => {
  it('backfills 90 days on first run, then refreshes 3, and writes zero days explicitly', async () => {
    const requested: number[] = [];
    const first = await runCompanySync({ _id: companyId, organizationId: orgId }, { now: NOW, fetchImpl: fakeProviders(requested) });
    expect(first.status).toBe('synced');
    expect(requested).toEqual([90]);
    expect(await MetricSnapshot.countDocuments({ companyId, metricKey: 'sessions' })).toBe(90);

    const revenueDays = await MetricSnapshot.find({ companyId, metricKey: 'revenue_net' }).lean();
    expect(revenueDays).toHaveLength(90);
    expect(revenueDays.find((r) => r.date === '2026-09-26')?.value).toBe(5000);
    expect(revenueDays.filter((r) => r.value === 0)).toHaveLength(89);

    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    await runCompanySync({ _id: companyId, organizationId: orgId }, { now: later, fetchImpl: fakeProviders(requested) });
    expect(requested).toEqual([90, 3]);
    expect(await MetricSnapshot.countDocuments({ companyId, metricKey: 'sessions' })).toBe(90);
  });

  it('never runs overlapping syncs for one company and respects the hourly interval', async () => {
    await MetricSyncState.create({ organizationId: orgId, companyId, leaseUntil: new Date(NOW.getTime() + 60_000), leaseToken: 'other' });
    expect((await runCompanySync({ _id: companyId, organizationId: orgId }, { now: NOW, force: true, fetchImpl: fakeProviders() })).status).toBe('busy');

    await MetricSyncState.updateOne({ companyId }, { $unset: { leaseUntil: '', leaseToken: '' }, $set: { lastRunAt: new Date(NOW.getTime() - 10 * 60_000) } });
    expect((await runCompanySync({ _id: companyId, organizationId: orgId }, { now: NOW, fetchImpl: fakeProviders() })).status).toBe('not_due');
    expect((await runCompanySync({ _id: companyId, organizationId: orgId }, { now: NOW, force: true, fetchImpl: fakeProviders() })).status).toBe('synced');
  });

  it('cron processes due companies and leaves receipts marked as scheduled', async () => {
    const summary = await processMetricSync({ now: NOW, fetchImpl: fakeProviders() });
    expect(summary).toMatchObject({ synced: 1, failed: 0 });
    const receipts = await CapabilityInvocation.find({ companyId }).lean();
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts.every((r) => r.requestedBySystem === 'metrics-sync')).toBe(true);
  });
});

describe('metric queries', () => {
  it('computes last-7 vs previous-7 and reports notable changes', async () => {
    await runCompanySync({ _id: companyId, organizationId: orgId }, { now: NOW, fetchImpl: fakeProviders() });
    const view = await getCompanyMetrics(admin, String(companyId), { now: NOW });
    const sessions = view!.metrics.find((m) => m.key === 'sessions')!;
    const dates = windowDates('analytics.traffic.read', 28, NOW);
    const expected = (ds: string[]) => ds.reduce((s, d) => s + Number(d.slice(8, 10)), 0);
    expect(sessions.current).toBe(expected(dates.slice(-7)));
    expect(sessions.previous).toBe(expected(dates.slice(-14, -7)));
    expect(view!.metrics.map((m) => m.key)).not.toContain('cash_available');
  });

  it('whatChanged ignores small baselines and ranks the biggest moves first', () => {
    const v = (key: string, current: number, previous: number): MetricView => ({
      key, label: key, unit: 'count', kind: 'daily', series: [], current, previous, change: (current - previous) / previous, lastDay: null,
    });
    const lines = whatChanged([v('Sessions', 200, 100), v('Leads', 4, 2), v('Clicks', 90, 100), v('Views', 50, 100)]);
    expect(lines).toEqual([
      'Sessions up 100% (200 vs 100, last 7 days vs the 7 before)',
      'Views down 50% (50 vs 100, last 7 days vs the 7 before)',
    ]);
  });

  it('today overview lists companies with data and totals across them', async () => {
    await runCompanySync({ _id: companyId, organizationId: orgId }, { now: NOW, fetchImpl: fakeProviders() });
    const today = await getTodayOverview(admin, { now: NOW });
    expect(today.rows).toHaveLength(1);
    expect(today.rows[0]).toMatchObject({ name: 'Frugal Gambler', metrics: { revenue_total: { current: 5000, unit: 'money' } } });
    expect(today.totals.revenue_total).toBe(5000);
  });
});

describe('fetch window = write window', () => {
  it('Search Console refresh never zeroes a day it did not fetch', async () => {
    await connect('gsc', 'google', 'refresh');
    await ExternalResource.create({ organizationId: orgId, companyId, provider: 'gsc', resourceType: 'site', externalId: 'sc-domain:frugalgambler.club', canonicalType: 'Company', canonicalId: companyId });
    const ranges: { startDate: string; endDate: string }[] = [];
    const base = fakeProviders();
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('searchAnalytics/query')) {
        const body = JSON.parse(String(init?.body));
        if (body.dimensions?.[0] === 'date') {
          ranges.push({ startDate: body.startDate, endDate: body.endDate });
          const rows = windowDates('search.performance.read', 3, NOW)
            .filter((d) => d >= body.startDate && d <= body.endDate)
            .map((d) => ({ keys: [d], clicks: 7, impressions: 70, ctr: 0.1, position: 5 }));
          return json({ rows });
        }
        return json({ rows: [] });
      }
      return base(url, init);
    });
    await MetricSyncState.create({ organizationId: orgId, companyId, backfilledCapabilities: ['search.performance.read', 'analytics.traffic.read', 'payments.revenue.read'] });
    await runCompanySync({ _id: companyId, organizationId: orgId }, { now: NOW, force: true, fetchImpl: f });

    const expected = windowDates('search.performance.read', 3, NOW);
    expect(ranges[0]).toEqual({ startDate: expected[0], endDate: expected[2] });
    const clicks = await MetricSnapshot.find({ companyId, metricKey: 'search_clicks' }).sort({ date: 1 }).lean();
    expect(clicks.map((c) => [c.date, c.value])).toEqual(expected.map((d) => [d, 7]));
  });
});

describe('total revenue', () => {
  it('sums payment and ad revenue and reports each change once', async () => {
    const { withTotalRevenue } = await import('./query');
    const mk = (key: string, current: number, previous: number): MetricView => ({
      key, label: key, unit: 'money', kind: 'daily', series: [{ date: '2026-09-27', value: current }], current, previous, change: (current - previous) / previous, lastDay: null,
    });
    const both = withTotalRevenue([mk('revenue_net', 20_000, 10_000), mk('ad_revenue', 10_000, 10_000)]);
    expect(both[0]).toMatchObject({ key: 'revenue_total', label: 'Revenue (all sources)', current: 30_000, previous: 20_000, change: 0.5 });

    const single = withTotalRevenue([mk('ad_revenue', 20_000, 10_000)]);
    expect(single[0]).toMatchObject({ key: 'revenue_total', label: 'Revenue', current: 20_000 });
    expect(whatChanged(single)).toHaveLength(1);
  });
});
