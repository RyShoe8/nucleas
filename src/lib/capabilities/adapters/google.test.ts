import { afterEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { ga4Traffic } from './google';
import type { CapabilityRunContext } from '../types';

afterEach(() => vi.unstubAllEnvs());

describe('ga4Traffic', () => {
  it('collects daily visitors and AI referral sessions', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    let report = 0;
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
      void _init;
      if (url.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'access' }), { status: 200 });
      report += 1;
      if (report === 1) {
        return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: '20261001' }], metricValues: [{ value: '20' }, { value: '15' }, { value: '8' }, { value: '40' }] }] }), { status: 200 });
      }
      if (report === 2) {
        return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '12' }] }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ rows: [
        { dimensionValues: [{ value: '20261001' }, { value: 'chatgpt.com' }], metricValues: [{ value: '3' }] },
        { dimensionValues: [{ value: '20261001' }, { value: 'perplexity.ai' }], metricValues: [{ value: '2' }] },
      ] }), { status: 200 });
    });
    const ctx: CapabilityRunContext = {
      organizationId: new Types.ObjectId(),
      companyId: new Types.ObjectId(),
      access: { provider: 'ga4', connectionId: new Types.ObjectId(), credential: 'refresh', resource: { externalId: '123', label: 'Property' } },
      reportUnits: () => {},
      now: new Date(),
      fetch,
    };

    const output = await ga4Traffic(ctx, { startDate: '2026-10-01', endDate: '2026-10-01' });

    expect(output.days).toEqual([{ date: '2026-10-01', sessions: 20, users: 15, newUsers: 8, pageViews: 40, aiClicks: 5 }]);
    expect(output.totals).toMatchObject({ sessions: 20, users: 15, newUsers: 8, aiClicks: 5 });
    const aiRequest = JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body));
    expect(aiRequest.dimensionFilter.filter.inListFilter.values).toContain('chatgpt.com');
  });
});
