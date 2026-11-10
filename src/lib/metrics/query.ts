import { Types } from 'mongoose';
import { MetricSnapshot, MetricSyncState } from '@/lib/models/Metric';
import { getCompanyProfile, listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import { METRICS, type MetricDefinition, type MetricUnit } from './catalog';
import { readServiceData } from '@/lib/companies/serviceData';
import { periodDates, summarizePeriod, type PeriodCoverage } from './period';
import type { ServiceReport } from '@/lib/companies/serviceReport';

function withServiceMetrics(views: MetricView[], report: ServiceReport | null, periodDays = 7, now = new Date()): MetricView[] {
  if (!report) return views;
  const replaced = new Set(['leads_new', 'customers_new', 'contacts_total', 'subscribers_active', 'subscriber_revenue', 'mrr', 'yrr']);
  const out = views.filter(v => !replaced.has(v.key));
  for (const [key, label, rows] of [
    ['leads_new', 'New leads', report.leads], ['bookings_new', 'Bookings created', report.bookings], ['customers_new', 'New customers', report.customers],
  ] as const) {
    out.push({ key, label, unit: 'count', kind: 'daily', ...summarizePeriod(rows, periodDates(periodDays * 2, now, report.timezone), periodDays), source: 'Connected service admin', timezone: report.timezone, updatedAt: report.generatedAt });
  }
  out.push({ key: 'customers_total', label: 'Customers', unit: 'count', kind: 'snapshot', series: [], current: report.customersTotal, previous: null, change: null, lastDay: null, source: 'Connected service admin', asOf: report.generatedAt.slice(0, 10), updatedAt: report.generatedAt });
  return out;
}

export interface MetricView {
  coverage?: PeriodCoverage;
  source?: string;
  timezone?: string;
  asOf?: string;
  updatedAt?: string;
  currency?: string;
  warning?: string;
  key: string;
  label: string;
  unit: MetricUnit;
  kind: 'daily' | 'snapshot';
  stage?: string;
  series: { date: string; value: number }[];
  /** Daily: sum of observed dates in the selected period (default 7). Snapshot: latest value. */
  current: number;
  /** Daily: preceding equal period, only when both are complete. Snapshot: start-of-period value if known. */
  previous: number | null;
  /** Relative change, e.g. 0.25 = +25%. Null when there is no meaningful baseline. */
  change: number | null;
  /** Most recent single day (daily metrics). */
  lastDay: { date: string; value: number } | null;
}

/** Minimum baseline before a change is worth calling out (money in minor units). */
const MIN_BASELINE: Record<MetricUnit, number> = { count: 10, money: 5_000, percent: 1, position: 1 };
const NOTABLE_CHANGE = 0.25;

function buildView(metric: MetricDefinition, rows: { date: string; value: number; breakdown?: Record<string, number>; updatedAt?: Date }[], now: Date, _days: number, periodDays = 7): MetricView | null {
  const today = now.toISOString().slice(0, 10);
  rows = rows.filter(r => r.date <= today && Number.isFinite(r.value));
  if (!rows.length) return null;
  const dates = periodDates(periodDays * 2, now);
  const relevant = rows.filter(r => r.date >= dates[0]);
  const currencies = [...new Set(relevant.flatMap(r => Object.keys(r.breakdown ?? {}).map(c => c.toUpperCase())))];
  const currency = currencies.length === 1 ? currencies[0] : undefined;
  const metadata = { source: metric.provider, currency, updatedAt: rows.map(r => r.updatedAt?.toISOString()).filter((v): v is string => Boolean(v)).sort().at(-1),
    warning: metric.unit === 'money' && currencies.length !== 1 ? (currencies.length > 1 ? 'Multiple currencies: no combined monetary total is shown.' : 'Currency not recorded by source.') : undefined };
  if (metric.kind === 'daily') {
    // Every headline and chart uses the exact same completed calendar days. Never synthesize missing observations.
    const period = summarizePeriod(rows, dates, periodDays);
    if (!period.series.length) return null;
    return { key: metric.key, label: metric.label, unit: metric.unit, kind: metric.kind, stage: metric.stage, ...period, ...metadata };
  }
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1)!;
  const baseline = [...sorted].reverse().find(r => r.date === dates.slice(-periodDays)[0]);
  return { key: metric.key, label: metric.label, unit: metric.unit, kind: metric.kind, stage: metric.stage,
    series: sorted.filter(r => r.date >= dates.slice(-periodDays)[0]).map(r => ({ date: r.date, value: r.value })),
    current: latest.value, previous: baseline?.value ?? null,
    change: baseline && baseline.value > 0 ? (latest.value - baseline.value) / baseline.value : null,
    lastDay: null, asOf: latest.date, ...metadata };
}

/** Revenue from every source (payments + ads), added when at least one part exists. */
export function withTotalRevenue(views: MetricView[]): MetricView[] {
  const parts = views.filter((v) => v.key === 'revenue_net' || v.key === 'ad_revenue' || v.key === 'adx_revenue');
  if (parts.length === 0) return views;
  const currencies = new Set(parts.map(p => p.currency));
  // A total must never silently add GBP, EUR and USD or values with unknown currency.
  if (parts.length > 1 && (currencies.size !== 1 || currencies.has(undefined) || parts.some(p => p.warning))) return views;
  const byDate = new Map<string, number>();
  for (const p of parts) for (const pt of p.series) byDate.set(pt.date, (byDate.get(pt.date) ?? 0) + pt.value);
  const series = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
  const current = parts.reduce((s, p) => s + p.current, 0);
  const hasPrevious = parts.every((p) => p.previous !== null);
  const previous = hasPrevious ? parts.reduce((s, p) => s + (p.previous ?? 0), 0) : null;
  const total: MetricView = {
    currency: parts[0].currency,
    warning: parts.find(p => p.warning)?.warning,
    source: parts.map(p => p.source).filter(Boolean).join(' + '),
    coverage: parts[0].coverage ? { ...parts[0].coverage, observed: series.filter(row => parts.every(p => p.series.some(r => r.date === row.date))).length, previousObserved: Math.min(...parts.map(p => p.coverage?.previousObserved ?? 0)) } : undefined,
    key: 'revenue_total',
    label: parts.length > 1 ? 'Revenue (all sources)' : 'Revenue',
    unit: 'money',
    kind: 'daily',
    series,
    current,
    previous,
    change: previous !== null && previous > 0 ? (current - previous) / previous : null,
    lastDay: series.at(-1) ?? null,
  };
  return [total, ...views];
}

function formatValue(unit: MetricUnit, value: number, currency = 'USD'): string {
  if (unit === 'money') return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value / 100);
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

/** Deterministic "what changed" lines: large relative moves on non-trivial baselines. */
export function whatChanged(views: MetricView[]): string[] {
  const lines: { weight: number; text: string }[] = [];
  // With a single revenue source the total equals that source; report it once.
  const revenueParts = views.filter((v) => v.key === 'revenue_net' || v.key === 'ad_revenue' || v.key === 'adx_revenue').length;
  for (const v of views) {
    if (v.key === 'revenue_total' && revenueParts < 2) continue;
    if (v.warning || (v.unit === 'money' && !v.currency)) continue;
    if (v.change === null || v.previous === null || v.previous < MIN_BASELINE[v.unit]) continue;
    if (Math.abs(v.change) < NOTABLE_CHANGE) continue;
    const pct = Math.round(Math.abs(v.change) * 100);
    const span = v.kind === 'daily' ? v.coverage ? `${v.coverage.start}–${v.coverage.end} vs preceding ${v.coverage.days} days` : 'last 7 days vs the 7 before' : 'vs start of period';
    lines.push({
      weight: Math.abs(v.change),
      text: `${v.label} ${v.change > 0 ? 'up' : 'down'} ${pct}% (${formatValue(v.unit, v.current, v.currency)} vs ${formatValue(v.unit, v.previous, v.currency)}, ${span})`,
    });
  }
  return lines.sort((a, b) => b.weight - a.weight).map((l) => l.text);
}

async function loadRows(companyIds: Types.ObjectId[], keys: string[], since: string) {
  return MetricSnapshot.find({ companyId: { $in: companyIds }, metricKey: { $in: keys }, date: { $gte: since } })
    .select('companyId metricKey date value breakdown updatedAt')
    .lean<{ companyId: Types.ObjectId; metricKey: string; date: string; value: number; breakdown?: Record<string, number>; updatedAt?: Date }[]>();
}

function sinceDate(days: number, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days - 3));
  return d.toISOString().slice(0, 10);
}

export interface CompanyMetricsView {
  lastSyncedAt: string | null;
  metrics: MetricView[];
  changes: string[];
}

export async function getCompanyMetrics(
  viewer: CompanyViewer,
  companyId: string,
  options: { days?: number; periodDays?: number; includeSensitive?: boolean; now?: Date } = {}
): Promise<CompanyMetricsView | null> {
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return null;
  const now = options.now ?? new Date();
  const days = Math.min(Math.max(options.days ?? 28, 14), 365);
  const periodDays = Math.min(Math.max(Math.floor(options.periodDays ?? 7), 1), 90);
  const defs = METRICS.filter((m) => !m.sensitive || options.includeSensitive);
  const cid = new Types.ObjectId(companyId);

  const rows = await loadRows([cid], defs.map((m) => m.key), sinceDate(Math.max(days, periodDays * 2), now));
  const views = withServiceMetrics(withTotalRevenue(
    defs.map((m) => buildView(m, rows.filter((r) => r.metricKey === m.key), now, days, periodDays)).filter((v): v is MetricView => v !== null)
  ), await readServiceData(viewer.organizationId, companyId), periodDays, now);
  const state = await MetricSyncState.findOne({ companyId: cid }).select('lastSuccessAt lastRunAt').lean<{ lastSuccessAt?: Date; lastRunAt?: Date }>();
  return { lastSyncedAt: state?.lastSuccessAt?.toISOString() ?? null, metrics: views, changes: whatChanged(views) };
}

/** Headline metrics for every company the viewer can see — the cross-company "Today" view. */
export const TODAY_METRICS = ['leads_new', 'users_new', 'sessions', 'customers_new', 'revenue_total', 'subscribers_active', 'mrr'] as const;

export interface TodayRow {
  companyId: string;
  name: string;
  color?: string;
  relationship: string;
  metrics: Record<string, { current: number; change: number | null; lastDay: number | null; unit: MetricUnit }>;
  changes: string[];
}

export async function getTodayOverview(viewer: CompanyViewer, options: { now?: Date } = {}): Promise<{ rows: TodayRow[]; totals: Record<string, number> }> {
  const now = options.now ?? new Date();
  const companies = await listCompanyProfiles(viewer);
  const defs = METRICS.filter((m) => !m.sensitive);
  const rows = await loadRows(
    companies.map((c) => new Types.ObjectId(c.id)),
    defs.map((m) => m.key),
    sinceDate(28, now)
  );

  const out: TodayRow[] = [];
  const totals: Record<string, number> = {};
  for (const company of companies) {
    const mine = rows.filter((r) => String(r.companyId) === company.id);
    const service = await readServiceData(viewer.organizationId, company.id);
    if (mine.length === 0 && !service) continue;
    const views = withServiceMetrics(withTotalRevenue(defs.map((m) => buildView(m, mine.filter((r) => r.metricKey === m.key), now, 28)).filter((v): v is MetricView => v !== null)), service, 7, now);
    const metrics: TodayRow['metrics'] = {};
    for (const v of views) {
      if (!(TODAY_METRICS as readonly string[]).includes(v.key)) continue;
      if (v.warning || (v.unit === 'money' && v.currency !== 'USD')) continue;
      metrics[v.key] = { current: v.current, change: v.change, lastDay: v.lastDay?.value ?? null, unit: v.unit };
      totals[v.key] = (totals[v.key] ?? 0) + v.current;
    }
    out.push({ companyId: company.id, name: company.name, color: company.color, relationship: company.relationship, metrics, changes: whatChanged(views).slice(0, 3) });
  }
  return { rows: out.sort((a, b) => (b.metrics.sessions?.current ?? 0) - (a.metrics.sessions?.current ?? 0)), totals };
}
