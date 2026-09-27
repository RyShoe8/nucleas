import { Types } from 'mongoose';
import { MetricSnapshot, MetricSyncState } from '@/lib/models/Metric';
import { getCompanyProfile, listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import { METRICS, type MetricDefinition, type MetricUnit } from './catalog';
import { windowDates } from './sync';

export interface MetricView {
  key: string;
  label: string;
  unit: MetricUnit;
  kind: 'daily' | 'snapshot';
  stage?: string;
  series: { date: string; value: number }[];
  /** Daily: sum of the last 7 days. Snapshot: latest value. */
  current: number;
  /** Daily: sum of the 7 days before. Snapshot: value ~7 days earlier (if known). */
  previous: number | null;
  /** Relative change, e.g. 0.25 = +25%. Null when there is no meaningful baseline. */
  change: number | null;
  /** Most recent single day (daily metrics). */
  lastDay: { date: string; value: number } | null;
}

/** Minimum baseline before a change is worth calling out (money in minor units). */
const MIN_BASELINE: Record<MetricUnit, number> = { count: 10, money: 5_000, percent: 1, position: 1 };
const NOTABLE_CHANGE = 0.25;

function captureFor(metric: MetricDefinition, days: number, now: Date): string[] {
  return windowDates(metric.capabilityId, days, now);
}

function buildView(metric: MetricDefinition, rows: { date: string; value: number }[], now: Date, days: number): MetricView | null {
  if (rows.length === 0) return null;
  const byDate = new Map(rows.map((r) => [r.date, r.value]));

  if (metric.kind === 'daily') {
    const dates = captureFor(metric, days, now);
    const series = dates.map((date) => ({ date, value: byDate.get(date) ?? 0 }));
    const last7 = series.slice(-7).reduce((s, p) => s + p.value, 0);
    const prev7 = series.slice(-14, -7).reduce((s, p) => s + p.value, 0);
    return {
      key: metric.key,
      label: metric.label,
      unit: metric.unit,
      kind: metric.kind,
      stage: metric.stage,
      series,
      current: last7,
      previous: series.length >= 14 ? prev7 : null,
      change: series.length >= 14 && prev7 > 0 ? (last7 - prev7) / prev7 : null,
      lastDay: series.at(-1) ?? null,
    };
  }

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1)!;
  const weekAgo = new Date(`${latest.date}T00:00:00Z`);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const baseline = [...sorted].reverse().find((r) => r.date <= weekAgo.toISOString().slice(0, 10));
  return {
    key: metric.key,
    label: metric.label,
    unit: metric.unit,
    kind: metric.kind,
    stage: metric.stage,
    series: sorted.map((r) => ({ date: r.date, value: r.value })),
    current: latest.value,
    previous: baseline?.value ?? null,
    change: baseline && baseline.value > 0 ? (latest.value - baseline.value) / baseline.value : null,
    lastDay: null,
  };
}

function formatValue(unit: MetricUnit, value: number): string {
  if (unit === 'money') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value / 100);
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

/** Deterministic "what changed" lines: large relative moves on non-trivial baselines. */
export function whatChanged(views: MetricView[]): string[] {
  const lines: { weight: number; text: string }[] = [];
  for (const v of views) {
    if (v.change === null || v.previous === null || v.previous < MIN_BASELINE[v.unit]) continue;
    if (Math.abs(v.change) < NOTABLE_CHANGE) continue;
    const pct = Math.round(Math.abs(v.change) * 100);
    const span = v.kind === 'daily' ? 'last 7 days vs the 7 before' : 'vs a week ago';
    lines.push({
      weight: Math.abs(v.change),
      text: `${v.label} ${v.change > 0 ? 'up' : 'down'} ${pct}% (${formatValue(v.unit, v.current)} vs ${formatValue(v.unit, v.previous)}, ${span})`,
    });
  }
  return lines.sort((a, b) => b.weight - a.weight).map((l) => l.text);
}

async function loadRows(companyIds: Types.ObjectId[], keys: string[], since: string) {
  return MetricSnapshot.find({ companyId: { $in: companyIds }, metricKey: { $in: keys }, date: { $gte: since } })
    .select('companyId metricKey date value')
    .lean<{ companyId: Types.ObjectId; metricKey: string; date: string; value: number }[]>();
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
  options: { days?: number; includeSensitive?: boolean; now?: Date } = {}
): Promise<CompanyMetricsView | null> {
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return null;
  const now = options.now ?? new Date();
  const days = Math.min(Math.max(options.days ?? 28, 14), 365);
  const defs = METRICS.filter((m) => !m.sensitive || options.includeSensitive);
  const cid = new Types.ObjectId(companyId);

  const rows = await loadRows([cid], defs.map((m) => m.key), sinceDate(days, now));
  const views = defs
    .map((m) => buildView(m, rows.filter((r) => r.metricKey === m.key), now, days))
    .filter((v): v is MetricView => v !== null);
  const state = await MetricSyncState.findOne({ companyId: cid }).select('lastSuccessAt lastRunAt').lean<{ lastSuccessAt?: Date; lastRunAt?: Date }>();
  return { lastSyncedAt: (state?.lastSuccessAt ?? state?.lastRunAt)?.toISOString() ?? null, metrics: views, changes: whatChanged(views) };
}

/** Headline metrics for every company the viewer can see — the cross-company "Today" view. */
export const TODAY_METRICS = ['leads_new', 'users_new', 'sessions', 'customers_new', 'revenue_net', 'subscribers_active', 'mrr'] as const;

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
    if (mine.length === 0) continue;
    const views = defs.map((m) => buildView(m, mine.filter((r) => r.metricKey === m.key), now, 28)).filter((v): v is MetricView => v !== null);
    const metrics: TodayRow['metrics'] = {};
    for (const v of views) {
      if (!(TODAY_METRICS as readonly string[]).includes(v.key)) continue;
      metrics[v.key] = { current: v.current, change: v.change, lastDay: v.lastDay?.value ?? null, unit: v.unit };
      totals[v.key] = (totals[v.key] ?? 0) + v.current;
    }
    out.push({ companyId: company.id, name: company.name, color: company.color, relationship: company.relationship, metrics, changes: whatChanged(views).slice(0, 3) });
  }
  return { rows: out.sort((a, b) => (b.metrics.sessions?.current ?? 0) - (a.metrics.sessions?.current ?? 0)), totals };
}
