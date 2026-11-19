import { siteKey } from '@/lib/companies/productionDomain';
import type { CapabilityRunContext } from '../types';
import { googleAccessToken } from './google';
import { defaultRange, isoDate, providerJson } from './http';

/**
 * SEO opportunities from a company's own Search Console data (free, first-party):
 *  - striking distance: queries a page already ranks for on page 1–2 (positions 8–20 by default) with real impressions;
 *  - competing pages: one query split between several of the company's own pages (cannibalization);
 *  - low click-through: top positions that are seen but rarely clicked (title and description work);
 *  - declining pages: pages that lost clicks against the previous equal period.
 */

type GscRows = { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] };

export type OpportunityInput = { days: number; minImpressions: number; minPosition: number; maxPosition: number; website?: string };

export interface SearchOpportunitiesOutput {
  siteUrl: string;
  website: string | null;
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
  rowsRead: number;
  strikingDistance: { query: string; page: string; position: number; impressions: number; clicks: number; ctr: number }[];
  competingPages: { query: string; impressions: number; pages: { page: string; impressions: number; clicks: number; position: number }[] }[];
  lowClickThrough: { query: string; page: string; position: number; impressions: number; clicks: number; ctr: number }[];
  decliningPages: { page: string; clicks: number; previousClicks: number; changePct: number; impressions: number; previousImpressions: number }[];
}

const ROW_LIMIT = 25_000;
const MAX_PAGES = 2;
const LIST_LIMIT = 40;
const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;

export async function searchOpportunities(ctx: CapabilityRunContext, input: OpportunityInput, lagDays: number): Promise<SearchOpportunitiesOutput> {
  const siteUrl = ctx.access.resource!.externalId;
  const token = await googleAccessToken(ctx);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const headers = { authorization: `Bearer ${token}` };
  const current = defaultRange(input.days, ctx.now, lagDays);
  const previousEnd = new Date(`${current.startDate}T00:00:00Z`);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousEnd.getUTCDate() - (input.days - 1));
  const previous = { startDate: isoDate(previousStart), endDate: isoDate(previousEnd) };

  // One of the company's websites only: Search Console filters by page address (www. and the bare domain alike).
  const website = input.website ? siteKey(input.website) : '';
  const filter = website
    ? { dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'includingRegex', expression: `^https?://(www\\.)?${website.replace(/\./g, '\\.')}(/|$)` }] }] }
    : {};
  const query = (range: { startDate: string; endDate: string }, dimensions: string[], startRow = 0) =>
    providerJson<GscRows>(ctx, url, { method: 'POST', headers, body: JSON.stringify({ ...range, dimensions, rowLimit: ROW_LIMIT, startRow, ...filter }) }, 'Search Console');

  const pairs: NonNullable<GscRows['rows']> = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = (await query(current, ['query', 'page'], page * ROW_LIMIT)).rows ?? [];
    pairs.push(...rows);
    if (rows.length < ROW_LIMIT) break;
  }

  // Per query: every page that showed for it.
  const byQuery = new Map<string, { page: string; impressions: number; clicks: number; position: number; ctr: number }[]>();
  for (const r of pairs) {
    const list = byQuery.get(r.keys[0]) ?? [];
    list.push({ page: r.keys[1], impressions: r.impressions, clicks: r.clicks, position: r.position, ctr: r.ctr });
    byQuery.set(r.keys[0], list);
  }

  const strikingDistance: SearchOpportunitiesOutput['strikingDistance'] = [];
  const competingPages: SearchOpportunitiesOutput['competingPages'] = [];
  const lowClickThrough: SearchOpportunitiesOutput['lowClickThrough'] = [];
  for (const [q, pages] of byQuery) {
    const impressions = pages.reduce((sum, p) => sum + p.impressions, 0);
    if (impressions < input.minImpressions) continue;
    const best = pages.reduce((a, b) => (b.impressions > a.impressions ? b : a));
    const row = { query: q, page: best.page, position: round(best.position), impressions: best.impressions, clicks: best.clicks, ctr: round(best.ctr * 100, 2) };
    if (best.position >= input.minPosition && best.position <= input.maxPosition) strikingDistance.push(row);
    if (best.position <= 5 && best.ctr < 0.03 && best.impressions >= input.minImpressions * 2) lowClickThrough.push(row);
    // Two or more of the company's pages each taking a real share of the query's impressions.
    const sharing = pages.filter((p) => p.impressions >= impressions * 0.1);
    if (sharing.length >= 2) {
      competingPages.push({
        query: q,
        impressions,
        pages: sharing.sort((a, b) => b.impressions - a.impressions).slice(0, 5).map((p) => ({ page: p.page, impressions: p.impressions, clicks: p.clicks, position: round(p.position) })),
      });
    }
  }

  const [now, before] = await Promise.all([query(current, ['page']), query(previous, ['page'])]);
  const earlier = new Map((before.rows ?? []).map((r) => [r.keys[0], r]));
  const decliningPages: SearchOpportunitiesOutput['decliningPages'] = [];
  const nowByPage = new Map((now.rows ?? []).map((r) => [r.keys[0], r]));
  for (const [page, prior] of earlier) {
    if (prior.clicks < 20) continue;
    const latest = nowByPage.get(page);
    const clicks = latest?.clicks ?? 0;
    const change = (clicks - prior.clicks) / prior.clicks;
    if (change > -0.3) continue;
    decliningPages.push({ page, clicks, previousClicks: prior.clicks, changePct: round(change * 100), impressions: latest?.impressions ?? 0, previousImpressions: prior.impressions });
  }

  return {
    siteUrl,
    website: website || null,
    ...current,
    previousStartDate: previous.startDate,
    previousEndDate: previous.endDate,
    rowsRead: pairs.length,
    strikingDistance: strikingDistance.sort((a, b) => b.impressions - a.impressions).slice(0, LIST_LIMIT),
    competingPages: competingPages.sort((a, b) => b.impressions - a.impressions).slice(0, LIST_LIMIT),
    lowClickThrough: lowClickThrough.sort((a, b) => b.impressions - a.impressions).slice(0, LIST_LIMIT),
    decliningPages: decliningPages.sort((a, b) => (b.previousClicks - b.clicks) - (a.previousClicks - a.clicks)).slice(0, LIST_LIMIT),
  };
}
