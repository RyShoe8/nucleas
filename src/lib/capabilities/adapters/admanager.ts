import { createHash, randomUUID } from 'crypto';
import { ExternalResource } from '@/lib/models/Integration';
import { CapabilityError, type CapabilityRunContext } from '../types';
import { providerJson } from './http';
import { googleAccessToken } from './google';
import { normalizeDomain } from './adsense';

const BASE = 'https://admanager.googleapis.com/v1';
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
interface Network { name: string; displayName?: string; currencyCode?: string; timeZone?: string }
interface Site { name: string; url: string }
export interface AdManagerSite { name: string; domain: string; network: string }
type Value = { intValue?: string; doubleValue?: number; stringValue?: string };
export interface AdxRow { dimensionValues?: Value[]; metricValueGroups?: { primaryValues?: Value[] }[] }
export interface AdxOutput {
  site: string; domain: string; startDate: string; endDate: string; currency: string; timeZone: string;
  totalEarnings: number; impressions: number; clicks: number;
  days: { date: string; earnings: number; impressions: number; clicks: number }[];
}

async function listAll<T>(fetchImpl: FetchLike, token: string, path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken = '';
  const seen = new Set<string>();
  do {
    const query = new URLSearchParams({ pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
    const res = await fetchImpl(`${BASE}/${path}?${query}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    if (!res.ok) throw new Error(`Ad Manager returned ${res.status}. Enable the Ad Manager API and network API access, then reconnect Google with reporting permissions.`);
    const data = await res.json() as Record<string, unknown>;
    out.push(...((data[key] ?? []) as T[]));
    pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
    if (pageToken && seen.has(pageToken)) throw new Error('Ad Manager pagination did not advance.');
    seen.add(pageToken);
    if (seen.size > 100) throw new Error('Ad Manager listing exceeds the supported page limit.');
  } while (pageToken);
  return out;
}

export async function listAdManagerSites(fetchImpl: FetchLike, token: string): Promise<AdManagerSite[]> {
  const networks = await listAll<Network>(fetchImpl, token, 'networks', 'networks');
  const out: AdManagerSite[] = [];
  for (const network of networks) {
    if (!/^networks\/\d+$/.test(network.name)) throw new Error('Ad Manager returned an invalid network.');
    const sites = await listAll<Site>(fetchImpl, token, `${network.name}/sites`, 'sites');
    for (const site of sites) {
      if (site.name.startsWith(network.name + '/sites/') && site.url) {
        out.push({ name: site.name, domain: normalizeDomain(site.url), network: network.displayName ? `${network.displayName} (${network.name})` : network.name });
      }
    }
  }
  return out;
}

function dateParts(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

export function adxReportDefinition(domain: string, range: { startDate: string; endDate: string }, currency: string) {
  return {
    reportType: 'HISTORICAL', dimensions: ['DATE', 'SITE'],
    metrics: ['AD_EXCHANGE_REVENUE', 'AD_EXCHANGE_IMPRESSIONS', 'AD_EXCHANGE_CLICKS'],
    dateRange: { fixed: { startDate: dateParts(range.startDate), endDate: dateParts(range.endDate) } },
    currencyCode: currency.toUpperCase(), timeZoneSource: 'PUBLISHER',
    filters: [{ fieldFilter: { field: { dimension: 'SITE' }, operation: 'IN', values: [{ stringValue: domain }, { stringValue: `www.${domain}` }] } }],
  };
}

function integer(value: Value | undefined): number {
  if (value?.intValue === undefined || !/^-?\d+$/.test(value.intValue)) throw new CapabilityError('failed', 'Ad Manager returned an unsupported numeric value.');
  const n = Number(value.intValue);
  if (!Number.isSafeInteger(n)) throw new CapabilityError('failed', 'Ad Manager returned an out-of-range number.');
  return n;
}

export function parseAdxRows(rows: AdxRow[], domain: string, range: { startDate: string; endDate: string }): AdxOutput['days'] {
  const days = new Map<string, { date: string; micros: number; impressions: number; clicks: number }>();
  for (const row of rows) {
    const raw = row.dimensionValues?.[0]?.stringValue ?? row.dimensionValues?.[0]?.intValue ?? '';
    const date = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    const site = normalizeDomain(row.dimensionValues?.[1]?.stringValue ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < range.startDate || date > range.endDate || site !== domain) {
      throw new CapabilityError('failed', 'Ad Manager returned data outside the pinned site or requested date range.');
    }
    if (row.metricValueGroups?.length !== 1) throw new CapabilityError('failed', 'Unexpected Ad Manager comparison columns.');
    const values = row.metricValueGroups[0].primaryValues;
    if (values?.length !== 3) throw new CapabilityError('failed', 'Ad Manager returned incomplete AdX metrics.');
    const day = days.get(date) ?? { date, micros: 0, impressions: 0, clicks: 0 };
    day.micros += integer(values[0]);
    day.impressions += integer(values[1]);
    day.clicks += integer(values[2]);
    days.set(date, day);
  }
  // Ad Manager MONEY values use micros. Nucleas money points use hundredths.
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
    date: d.date, earnings: Math.round(d.micros / 10_000), impressions: d.impressions, clicks: d.clicks,
  }));
}

type Operation = { name?: string; done?: boolean; error?: { code?: number }; response?: { reportResult?: string } };
type ReportState = { report?: string; operation?: string; completedAt?: string; leaseUntil?: Date; leaseToken?: string };

/** Persist the report and operation so a slow Google report resumes on the next sync. */
export async function admanagerRevenue(ctx: CapabilityRunContext, range: { startDate: string; endDate: string }): Promise<AdxOutput> {
  const site = ctx.access.resource?.externalId ?? '';
  const match = /^(networks\/\d+)\/sites\/\d+$/.exec(site);
  const domain = normalizeDomain(ctx.access.resource?.label ?? '');
  if (!match || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new CapabilityError('needs_setup', 'Choose an Ad Manager site for this company.');
  const network = match[1];
  const token = await googleAccessToken(ctx);
  const request = <T>(path: string, method = 'GET', body?: unknown) => providerJson<T>(ctx, `${BASE}/${path}`, {
    method, headers: { authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}),
  }, 'Ad Manager');
  const actualSite = await request<Site>(site);
  if (normalizeDomain(actualSite.url) !== domain) throw new CapabilityError('needs_setup', 'The pinned Ad Manager site changed. Choose the site again.');
  const info = await request<Network>(network);
  if (!info.currencyCode || !info.timeZone) throw new CapabilityError('failed', 'Ad Manager did not return its reporting currency and timezone.');
  const key = createHash('sha256').update(JSON.stringify([site, domain, range, ctx.access.connectionId])).digest('hex');
  const filter = { organizationId: ctx.organizationId, companyId: ctx.companyId, provider: 'admanager', resourceType: 'adx_report', externalId: key };
  await ExternalResource.updateOne(filter, { $setOnInsert: { canonicalType: 'Company', canonicalId: ctx.companyId, metadata: {} } }, { upsert: true });
  const leaseToken = randomUUID();
  const claimed = await ExternalResource.findOneAndUpdate({
    ...filter, $or: [{ 'metadata.leaseUntil': { $exists: false } }, { 'metadata.leaseUntil': { $lt: new Date() } }],
  }, { $set: { 'metadata.leaseUntil': new Date(Date.now() + 180_000), 'metadata.leaseToken': leaseToken } }, { new: true }).lean();
  if (!claimed) throw new CapabilityError('uncertain', 'AdX reporting is already running. Try syncing again shortly.');
  const state = (claimed.metadata ?? {}) as ReportState;
  const save = async (changes: Partial<ReportState>) => {
    Object.assign(state, changes);
    await ExternalResource.updateOne({ ...filter, 'metadata.leaseToken': leaseToken }, { $set: Object.fromEntries(Object.entries(changes).map(([k, v]) => [`metadata.${k}`, v])) });
  };
  try {
    if (!state.report) {
      const report = await request<{ name: string }>(`${network}/reports`, 'POST', {
        displayName: `Nucleas AdX · ${domain} · ${range.startDate}–${range.endDate}`, visibility: 'HIDDEN',
        reportDefinition: adxReportDefinition(domain, range, info.currencyCode),
      });
      if (!new RegExp(`^${network}/reports/\\d+$`).test(report.name)) throw new CapabilityError('failed', 'Invalid Ad Manager report name.');
      await save({ report: report.name });
    }
    if (!state.operation || (state.completedAt && Date.now() - Date.parse(state.completedAt) > 600_000)) {
      const op = await request<Operation>(`${state.report}:run`, 'POST', {});
      if (!op.name) throw new CapabilityError('failed', 'Ad Manager did not return a report operation.');
      await save({ operation: op.name, completedAt: '' });
    }
    if (!state.operation?.startsWith(`${network}/operations/`) || !/^[a-zA-Z0-9_/-]+$/.test(state.operation)) throw new CapabilityError('failed', 'Invalid Ad Manager operation.');
    let op = await request<Operation>(state.operation);
    for (const delay of [5000, 10000, 20000]) {
      if (op.done) break;
      await new Promise(resolve => setTimeout(resolve, delay));
      op = await request<Operation>(state.operation);
    }
    if (!op.done) throw new CapabilityError('uncertain', 'Google is still preparing the AdX report. The next sync will resume it.');
    if (op.error) {
      await save({ operation: '', completedAt: '' });
      throw new CapabilityError('failed', `Ad Manager report failed (code ${op.error.code ?? 'unknown'}). Check reporting permissions and site/metric compatibility.`);
    }
    const result = op.response?.reportResult;
    if (!result?.startsWith(`${state.report}/results/`) || !/^[a-zA-Z0-9_/-]+$/.test(result)) throw new CapabilityError('failed', 'Ad Manager returned an invalid report result.');
    const rows: AdxRow[] = [];
    let pageToken = '';
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({ pageSize: '10000', ...(pageToken ? { pageToken } : {}) });
      const page = await request<{ rows?: AdxRow[]; nextPageToken?: string }>(`${result}:fetchRows?${query}`);
      rows.push(...(page.rows ?? []));
      pageToken = page.nextPageToken ?? '';
      if ((pageToken && seen.has(pageToken)) || seen.size >= 100 || rows.length > 100_000) throw new CapabilityError('failed', 'Ad Manager report exceeded the supported pagination limit.');
      seen.add(pageToken);
    } while (pageToken);
    const days = parseAdxRows(rows, domain, range);
    if (!state.completedAt) await save({ completedAt: new Date().toISOString() });
    return { site, domain, ...range, currency: info.currencyCode.toLowerCase(), timeZone: info.timeZone, days,
      totalEarnings: days.reduce((n, d) => n + d.earnings, 0), impressions: days.reduce((n, d) => n + d.impressions, 0), clicks: days.reduce((n, d) => n + d.clicks, 0) };
  } finally {
    await ExternalResource.updateOne({ ...filter, 'metadata.leaseToken': leaseToken }, { $unset: { 'metadata.leaseUntil': '', 'metadata.leaseToken': '' } });
  }
}
