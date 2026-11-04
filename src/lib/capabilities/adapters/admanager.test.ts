import { afterEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { admanagerRevenue, adxReportDefinition, listAdManagerSites, parseAdxRows, type AdxRow } from './admanager';
import { ExternalResource } from '@/lib/models/Integration';
import type { CapabilityRunContext } from '../types';

vi.mock('@/lib/models/Integration', () => ({ ExternalResource: { updateOne: vi.fn(async () => ({})), findOneAndUpdate: vi.fn() } }));
const range = { startDate: '2026-11-01', endDate: '2026-11-02' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const row = (site = 'playbound.club', micros = '1230000'): AdxRow => ({
  dimensionValues: [{ stringValue: '2026-11-01' }, { stringValue: site }],
  metricValueGroups: [{ primaryValues: [{ intValue: micros }, { intValue: '120' }, { intValue: '3' }] }],
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('Ad Manager reporting', () => {
  it('filters explicitly to the site and requests only AdX metrics', () => {
    expect(adxReportDefinition('playbound.club', range, 'usd')).toMatchObject({
      dimensions: ['DATE', 'SITE'], metrics: ['AD_EXCHANGE_REVENUE', 'AD_EXCHANGE_IMPRESSIONS', 'AD_EXCHANGE_CLICKS'],
      filters: [{ fieldFilter: { field: { dimension: 'SITE' }, operation: 'IN', values: [{ stringValue: 'playbound.club' }, { stringValue: 'www.playbound.club' }] } }],
      dateRange: { fixed: { startDate: { year: 2026, month: 11, day: 1 }, endDate: { year: 2026, month: 11, day: 2 } } },
    });
  });
  it('aggregates same-day rows before rounding micros to hundredths', () => {
    expect(parseAdxRows([row('playbound.club', '1234500'), row('www.playbound.club', '5000')], 'playbound.club', range))
      .toEqual([{ date: '2026-11-01', earnings: 124, impressions: 240, clicks: 6 }]);
  });
  it('rejects foreign sites, out-of-window dates, and missing values instead of recording zero', () => {
    expect(() => parseAdxRows([row('other.com')], 'playbound.club', range)).toThrow('outside');
    expect(() => parseAdxRows([row()], 'playbound.club', { startDate: '2026-11-02', endDate: '2026-11-03' })).toThrow('outside');
    expect(() => parseAdxRows([{ ...row(), metricValueGroups: [] }], 'playbound.club', range)).toThrow('comparison');
    expect(parseAdxRows([], 'playbound.club', range)).toEqual([]);
  });
  it('follows both network and site pagination', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/networks?')) return json(url.includes('pageToken') ? { networks: [{ name: 'networks/2' }] } : { networks: [{ name: 'networks/1' }], nextPageToken: 'next' });
      if (url.includes('networks/1/sites')) return json(url.includes('pageToken') ? { sites: [{ name: 'networks/1/sites/2', url: 'other.com' }] } : { sites: [{ name: 'networks/1/sites/1', url: 'https://www.Playbound.club/' }], nextPageToken: 'more' });
      return json({ sites: [] });
    });
    expect(await listAdManagerSites(fetcher, 'token')).toEqual([
      { name: 'networks/1/sites/1', domain: 'playbound.club', network: 'networks/1' },
      { name: 'networks/1/sites/2', domain: 'other.com', network: 'networks/1' },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it('resumes a persisted operation, fetches every result page, and releases its lease', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test'); vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test');
    vi.mocked(ExternalResource.findOneAndUpdate).mockReturnValue({ lean: async () => ({ metadata: { report: 'networks/1/reports/2', operation: 'networks/1/operations/reports/runs/3' } }) } as never);
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('oauth2')) return json({ access_token: 'test' });
      if (url.endsWith('/sites/1')) return json({ url: 'playbound.club' });
      if (url.endsWith('/networks/1')) return json({ currencyCode: 'USD', timeZone: 'America/Chicago' });
      if (url.includes('/operations/')) return json({ done: true, response: { reportResult: 'networks/1/reports/2/results/3' } });
      if (url.includes('fetchRows')) return json(url.includes('pageToken') ? { rows: [row()] } : { rows: [row()], nextPageToken: 'next' });
      throw new Error('Unexpected request ' + url);
    });
    const ctx = { organizationId: new Types.ObjectId(), companyId: new Types.ObjectId(), now: new Date(), fetch: fetcher,
      access: { connectionId: new Types.ObjectId(), credential: 'refresh', resource: { externalId: 'networks/1/sites/1', label: 'playbound.club' } },
    } as unknown as CapabilityRunContext;
    expect(await admanagerRevenue(ctx, range)).toMatchObject({ totalEarnings: 246, impressions: 240, clicks: 6, currency: 'usd', timeZone: 'America/Chicago' });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith(':run'))).toBe(false);
    expect(ExternalResource.updateOne).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: ctx.organizationId, companyId: ctx.companyId }), { $unset: { 'metadata.leaseUntil': '', 'metadata.leaseToken': '' } });
  });
});
