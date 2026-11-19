import { afterEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import type { CapabilityRunContext } from '../types';
import { searchOpportunities } from './searchOpportunities';
import { serperSearch } from './serper';

afterEach(() => vi.unstubAllEnvs());

function ctx(fetch: CapabilityRunContext['fetch'], extra: Partial<CapabilityRunContext> = {}): CapabilityRunContext {
  return {
    organizationId: new Types.ObjectId(),
    companyId: new Types.ObjectId(),
    companyDomain: 'frugalgambler.club',
    access: { provider: 'gsc', connectionId: new Types.ObjectId(), credential: 'refresh', resource: { externalId: 'sc-domain:frugalgambler.club' } },
    reportUnits: () => {},
    now: new Date('2026-11-19T12:00:00Z'),
    fetch,
    ...extra,
  };
}

const row = (keys: string[], impressions: number, clicks: number, position: number) => ({ keys, impressions, clicks, ctr: impressions ? clicks / impressions : 0, position });

describe('searchOpportunities', () => {
  it('finds striking-distance queries, competing pages, poor click-through and declining pages', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.dimensions.join() === 'query,page') {
        return new Response(JSON.stringify({ rows: [
          row(['slot odds', 'https://frugalgambler.club/odds'], 900, 10, 11.4),
          row(['slot odds', 'https://frugalgambler.club/slots'], 300, 2, 14),
          row(['free play', 'https://frugalgambler.club/free-play'], 2000, 20, 2.1),
          row(['tiny query', 'https://frugalgambler.club/x'], 5, 0, 9),
        ] }), { status: 200 });
      }
      // Pages: the current window, then the previous one.
      const current = body.startDate === '2026-10-21';
      return new Response(JSON.stringify({ rows: current
        ? [row(['https://frugalgambler.club/odds'], 1000, 10, 11), row(['https://frugalgambler.club/new'], 50, 30, 5)]
        : [row(['https://frugalgambler.club/odds'], 1200, 100, 9), row(['https://frugalgambler.club/gone'], 400, 40, 6)] }), { status: 200 });
    });

    const out = await searchOpportunities(ctx(fetch), { days: 28, minImpressions: 50, minPosition: 8, maxPosition: 20, website: 'www.FrugalGambler.club' }, 2);

    expect(out).toMatchObject({ startDate: '2026-10-21', endDate: '2026-11-17', previousStartDate: '2026-09-23', previousEndDate: '2026-10-20', website: 'frugalgambler.club', rowsRead: 4 });
    expect(out.strikingDistance).toEqual([{ query: 'slot odds', page: 'https://frugalgambler.club/odds', position: 11.4, impressions: 900, clicks: 10, ctr: 1.11 }]);
    expect(out.competingPages).toEqual([{ query: 'slot odds', impressions: 1200, pages: [
      { page: 'https://frugalgambler.club/odds', impressions: 900, clicks: 10, position: 11.4 },
      { page: 'https://frugalgambler.club/slots', impressions: 300, clicks: 2, position: 14 },
    ] }]);
    expect(out.lowClickThrough.map((r) => r.query)).toEqual(['free play']);
    expect(out.decliningPages).toEqual([
      { page: 'https://frugalgambler.club/odds', clicks: 10, previousClicks: 100, changePct: -90, impressions: 1000, previousImpressions: 1200 },
      { page: 'https://frugalgambler.club/gone', clicks: 0, previousClicks: 40, changePct: -100, impressions: 0, previousImpressions: 400 },
    ]);
    // One website only: every request filters pages to it, www. or not.
    expect(bodies.every((b) => JSON.stringify(b).includes('^https?://(www\\\\.)?frugalgambler\\\\.club(/|$)'))).toBe(true);
  });
});

describe('serperSearch', () => {
  it('returns the results, questions and where the company ranks, and counts the credit', async () => {
    let units = 0;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ q: 'best slot apps', gl: 'us', hl: 'en', num: 10 });
      expect((init?.headers as Record<string, string>)['x-api-key']).toBe('serper-key');
      return new Response(JSON.stringify({
        organic: [
          { title: 'Top 10 slot apps', link: 'https://www.casino.org/apps', snippet: 'List', position: 1 },
          { title: 'Our pick', link: 'https://www.frugalgambler.club/slot-apps', snippet: 'Ours', position: 4 },
        ],
        peopleAlsoAsk: [{ question: 'Which slot app pays most?', link: 'https://reddit.com/r/x' }],
        relatedSearches: [{ query: 'slot apps real money' }],
        credits: 1,
      }), { status: 200 });
    });
    const out = await serperSearch(ctx(fetch, { access: { provider: 'serper', connectionId: new Types.ObjectId(), credential: 'serper-key' }, reportUnits: (n) => { units += n; } }), { query: 'best slot apps', country: 'us', language: 'en' });
    expect(out).toMatchObject({
      companyPosition: 4,
      companyUrl: 'https://www.frugalgambler.club/slot-apps',
      peopleAlsoAsk: [{ question: 'Which slot app pays most?', answerSource: 'reddit.com' }],
      relatedSearches: ['slot apps real money'],
      answerBox: null,
    });
    expect(out.organic[0]).toMatchObject({ position: 1, domain: 'casino.org' });
    expect(units).toBe(1);
  });

  it('treats a rejected key as needing a new key', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }));
    await expect(serperSearch(ctx(fetch, { access: { provider: 'serper', connectionId: new Types.ObjectId(), credential: 'bad' } }), { query: 'x y', country: 'us', language: 'en' })).rejects.toMatchObject({ code: 'needs_reauth' });
  });
});
