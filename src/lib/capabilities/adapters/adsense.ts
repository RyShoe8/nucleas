import type { CapabilityRunContext } from '../types';
import { providerJson } from './http';
import { googleAccessToken } from './google';
import { siteKey } from '@/lib/companies/productionDomain';

/**
 * AdSense Management API v2. Same approach The Ad Shop uses in production: daily
 * `reports:generate` filtered to the company's own domain, because one AdSense account usually
 * serves several sites and an unfiltered report would mix their revenue.
 */

const BASE = 'https://adsense.googleapis.com/v2';

export interface AdSenseSite {
  /** accounts/pub-XXX/sites/YYY */
  name: string;
  account: string;
  domain: string;
  state?: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function getJson<T>(fetchImpl: FetchLike, url: string, accessToken: string): Promise<T> {
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`AdSense returned ${res.status}`);
  return (await res.json()) as T;
}

export function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

/** Every site in every AdSense account the token can see. */
export async function listAdSenseSites(fetchImpl: FetchLike, accessToken: string): Promise<AdSenseSite[]> {
  const accounts = await getJson<{ accounts?: { name: string }[] }>(fetchImpl, `${BASE}/accounts`, accessToken);
  const out: AdSenseSite[] = [];
  for (const account of accounts.accounts ?? []) {
    const sites = await getJson<{ sites?: { name: string; domain?: string; state?: string }[] }>(
      fetchImpl,
      `${BASE}/${account.name}/sites?pageSize=500`,
      accessToken
    ).catch(() => ({ sites: [] }));
    for (const s of sites.sites ?? []) {
      if (s.domain) out.push({ name: s.name, account: account.name, domain: normalizeDomain(s.domain), state: s.state });
    }
  }
  return out;
}

export interface AdRevenueOutput {
  site: string;
  domain: string;
  startDate: string;
  endDate: string;
  currency: string;
  /** Minor units (cents). */
  totalEarnings: number;
  pageViews: number;
  clicks: number;
  days: { date: string; earnings: number; pageViews: number; clicks: number }[];
  /** The same days per website (www. and the bare domain are one site). */
  siteDays?: { date: string; site: string; earnings: number; pageViews: number; clicks: number }[];
}

type Report = {
  headers?: { name: string; currencyCode?: string }[];
  rows?: { cells: { value?: string }[] }[];
};

export async function adsenseRevenue(ctx: CapabilityRunContext, range: { startDate: string; endDate: string }): Promise<AdRevenueOutput> {
  const siteName = ctx.access.resource!.externalId;
  const domain = normalizeDomain(ctx.access.resource!.label ?? '');
  const account = siteName.split('/sites/')[0];
  const token = await googleAccessToken(ctx);

  const [sy, sm, sd] = range.startDate.split('-');
  const [ey, em, ed] = range.endDate.split('-');
  const qs = new URLSearchParams({
    'startDate.year': sy,
    'startDate.month': String(Number(sm)),
    'startDate.day': String(Number(sd)),
    'endDate.year': ey,
    'endDate.month': String(Number(em)),
    'endDate.day': String(Number(ed)),
  });
  for (const m of ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'CLICKS']) qs.append('metrics', m);
  qs.append('dimensions', 'DATE');
  qs.append('dimensions', 'DOMAIN_NAME');
  // Every company website in the account, each as example.com or www.example.com (either way the same site).
  const domains = [...new Set([domain, ...(ctx.companyWebsites ?? []).map((w) => normalizeDomain(w))])].filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 20);
  qs.append('filters', domains.flatMap((d) => [`DOMAIN_NAME==${d}`, `DOMAIN_NAME==www.${d}`]).join(','));

  const report = await providerJson<Report>(ctx, `${BASE}/${account}/reports:generate?${qs}`, { headers: { authorization: `Bearer ${token}` } }, 'AdSense');
  const currency = (report.headers?.find((h) => h.name === 'ESTIMATED_EARNINGS')?.currencyCode ?? 'USD').toLowerCase();
  // Cells follow the request: dimensions (DATE, DOMAIN_NAME) first, then the metrics.
  const rows = (report.rows ?? []).map((r) => ({
    date: r.cells[0]?.value ?? '',
    site: siteKey(r.cells[1]?.value ?? domain) || domain,
    earnings: Math.round(parseFloat(r.cells[2]?.value ?? '0') * 100),
    pageViews: parseInt(r.cells[3]?.value ?? '0', 10) || 0,
    clicks: parseInt(r.cells[4]?.value ?? '0', 10) || 0,
  })).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
  const sum = (list: typeof rows, by: (row: (typeof rows)[number]) => string) => {
    const out = new Map<string, (typeof rows)[number]>();
    for (const row of list) {
      const key = by(row);
      const prior = out.get(key);
      out.set(key, prior ? { ...prior, earnings: prior.earnings + row.earnings, pageViews: prior.pageViews + row.pageViews, clicks: prior.clicks + row.clicks } : { ...row });
    }
    return [...out.values()];
  };
  const days = sum(rows, (row) => row.date).map(({ date, earnings, pageViews, clicks }) => ({ date, earnings, pageViews, clicks }));
  const siteDays = sum(rows, (row) => `${row.date}|${row.site}`);

  return {
    site: siteName,
    domain,
    ...range,
    currency,
    totalEarnings: days.reduce((s, d) => s + d.earnings, 0),
    pageViews: days.reduce((s, d) => s + d.pageViews, 0),
    clicks: days.reduce((s, d) => s + d.clicks, 0),
    days,
    siteDays,
  };
}
