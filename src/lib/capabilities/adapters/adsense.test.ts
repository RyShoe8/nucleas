import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { adsenseRevenue, listAdSenseSites, normalizeDomain } from './adsense';
import type { CapabilityRunContext } from '../types';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('AdSense adapter', () => {
  it('filters the report to the pinned domain and converts earnings to cents', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csecret');
    const calls: string[] = [];
    const ctx = {
      organizationId: new Types.ObjectId(),
      companyId: new Types.ObjectId(),
      now: new Date('2026-09-28T12:00:00Z'),
      reportUnits: () => {},
      access: { provider: 'adsense', connectionId: new Types.ObjectId(), credential: 'refresh', resource: { externalId: 'accounts/pub-123/sites/abc', label: 'frugalgambler.club' } },
      fetch: vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes('oauth2')) return json({ access_token: 'at' });
        return json({
          headers: [{ name: 'DATE' }, { name: 'ESTIMATED_EARNINGS', currencyCode: 'USD' }, { name: 'PAGE_VIEWS' }, { name: 'CLICKS' }],
          rows: [
            { cells: [{ value: '2026-09-26' }, { value: '1.23' }, { value: '400' }, { value: '3' }] },
            { cells: [{ value: '2026-09-27' }, { value: '0.5' }, { value: '100' }, { value: '1' }] },
          ],
        });
      }),
    } as unknown as CapabilityRunContext;

    const out = await adsenseRevenue(ctx, { startDate: '2026-09-26', endDate: '2026-09-27' });
    expect(out).toMatchObject({ currency: 'usd', totalEarnings: 173, pageViews: 500, clicks: 4, domain: 'frugalgambler.club' });
    expect(out.days).toEqual([
      { date: '2026-09-26', earnings: 123, pageViews: 400, clicks: 3 },
      { date: '2026-09-27', earnings: 50, pageViews: 100, clicks: 1 },
    ]);
    const report = decodeURIComponent(calls.find((u) => u.includes('reports:generate'))!);
    expect(report).toContain('accounts/pub-123/reports:generate');
    expect(report).toContain('filters=DOMAIN_NAME==frugalgambler.club');
    vi.unstubAllEnvs();
  });

  it('lists sites across accounts with normalized domains', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/v2/accounts')) return json({ accounts: [{ name: 'accounts/pub-1' }] });
      return json({ sites: [{ name: 'accounts/pub-1/sites/x', domain: 'www.FrugalGambler.club' }, { name: 'accounts/pub-1/sites/y' }] });
    });
    expect(await listAdSenseSites(f, 'at')).toEqual([{ name: 'accounts/pub-1/sites/x', account: 'accounts/pub-1', domain: 'frugalgambler.club', state: undefined }]);
    expect(normalizeDomain('https://www.Example.com/path')).toBe('example.com');
  });
});
