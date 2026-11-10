'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import { SOCIAL_PLATFORMS } from '@/lib/metrics/social';
import { revenueMetricVisible } from '@/lib/metrics/revenueVisibility';
import type { OsConnection } from './companyTypes';
import { periodDates, type PeriodCoverage } from '@/lib/metrics/period';
import ServiceDataPanel from './ServiceDataPanel';

/** Mirrors the server InvocationView fields the UI needs. */
export interface OsInvocation {
    id: string;
    capabilityId: string;
    title: string;
    kind: 'read' | 'write';
    providerName: string;
    status: string;
    summary?: string;
    error?: string;
    output?: unknown;
    resource?: { label?: string; externalUrl?: string };
    verified?: boolean;
    approvalId?: string;
    requestedBy: 'user' | 'ai' | 'system';
    createdAt: string;
    cached?: boolean;
}

export async function invoke(companyId: string, capabilityId: string, input: unknown = {}): Promise<OsInvocation | { error: string }> {
    const res = await fetch(`/api/os/companies/${companyId}/capabilities/${capabilityId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
    });
    const data = (await res.json().catch(() => ({}))) as { invocation?: OsInvocation; error?: string };
    return data.invocation ?? { error: data.error ?? `Failed (${res.status})` };
}

export interface OsMetric {
    coverage?: PeriodCoverage;
    source?: string;
    asOf?: string;
    updatedAt?: string;
    currency?: string;
    warning?: string;
    key: string;
    label: string;
    unit: 'count' | 'money' | 'percent' | 'position';
    kind: 'daily' | 'snapshot';
    stage?: string;
    series: { date: string; value: number }[];
    current: number;
    previous: number | null;
    change: number | null;
    lastDay: { date: string; value: number } | null;
}

const nf = new Intl.NumberFormat('en-US');
export function formatMetric(unit: OsMetric['unit'], value: number | null | undefined): string {
    if (value == null) return '–';
    if (unit === 'money') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value / 100);
    return nf.format(Math.round(value));
}

export function ChangeBadge({ change }: { change: number | null }) {
    if (change === null || !Number.isFinite(change)) return <span className="text-[11px] text-text-secondary">–</span>;
    const pct = Math.round(change * 100);
    const tone = pct > 0 ? 'text-emerald-400' : pct < 0 ? 'text-red-400' : 'text-text-secondary';
    return (
        <span className={`text-[11px] tabular-nums ${tone}`}>
            {pct > 0 ? '▲' : pct < 0 ? '▼' : ''} {Math.abs(pct)}%
        </span>
    );
}

const DAY_MS = 86_400_000;

/** Which days get a label under a chart: every day for a week, then every few, always the first and the last. */
export function dayTicks(firstMs: number, lastMs: number): { ms: number; label: string; major: boolean }[] {
    const days = Math.max(0, Math.round((lastMs - firstMs) / DAY_MS));
    const step = days <= 7 ? 1 : days <= 14 ? 2 : days <= 31 ? 7 : 14;
    const out: { ms: number; label: string; major: boolean }[] = [];
    for (let i = 0; i <= days; i++) {
        const ms = firstMs + i * DAY_MS;
        // Count back from the last day so the most recent day is always labelled; drop a label that would crowd the first.
        const major = i === 0 || i === days || ((days - i) % step === 0 && i >= Math.ceil(step / 2));
        const date = new Date(ms);
        const label = days <= 7
            ? date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
            : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
        out.push({ ms, label, major });
    }
    return out;
}

export function Sparkline({ series, label, start, end, format }: { series: { value: number; date?: string }[]; label: string; start?: string; end?: string; format?: (value: number) => string }) {
    if (!series.length) return null;
    const show = format ?? ((value: number) => new Intl.NumberFormat('en-US').format(Math.round(value)));
    const dated = series.every(p => p.date);
    const dates = series.map((p, i) => p.date ? Date.parse(p.date + 'T00:00:00Z') : i);
    const first = start ? Date.parse(start + 'T00:00:00Z') : dates[0];
    const last = end ? Date.parse(end + 'T00:00:00Z') : dates.at(-1)!;
    const min = Math.min(...series.map(p => p.value));
    const max = Math.max(...series.map(p => p.value));
    // Position across the chart as a share of its width, so the day labels underneath line up with the points above.
    const across = (ms: number) => last === first ? 50 : ((ms - first) / (last - first)) * 100;
    const points = series.map((p, i) => ({ x: across(dates[i]), y: max === min ? 20 : 37 - (p.value - min) / (max - min) * 34 }));
    const ticks = dated && last > first ? dayTicks(first, last) : [];
    const edge = (x: number) => x < 8 ? 'translate-x-0' : x > 92 ? '-translate-x-full' : '-translate-x-1/2';
    return <figure className="text-primary" aria-label={`${label}; ${start ?? series[0].date ?? ''} to ${end ?? series.at(-1)?.date ?? ''}; ${series.length} observations`}>
        <div className="flex justify-between text-[10px] tabular-nums text-text-secondary"><span>High {show(max)}</span><span>Low {show(min)}</span></div>
        <div className="mx-1">
            <svg viewBox="0 0 100 40" width="100%" height={56} preserveAspectRatio="none" role="img" aria-label={`${label} by day`} className="block overflow-visible">
                <title>{label}: a missing day is a gap, not zero</title>
                {ticks.map(tick => <line key={tick.ms} x1={across(tick.ms)} x2={across(tick.ms)} y1={tick.major ? 0 : 37} y2={40} stroke="currentColor" strokeOpacity={tick.major ? 0.18 : 0.3} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
                <line x1="0" x2="100" y1="40" y2="40" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                {points.map((p, i) => i > 0 && (!series[i].date || dates[i] - dates[i - 1] === DAY_MS)
                    ? <line key={`l${i}`} x1={points[i - 1].x} y1={points[i - 1].y} x2={p.x} y2={p.y} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    : null)}
                {points.map((p, i) => <line key={`p${i}`} x1={p.x} y1={p.y} x2={p.x} y2={p.y} stroke="currentColor" strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke"><title>{series[i].date ? `${series[i].date}: ` : ''}{show(series[i].value)}</title></line>)}
            </svg>
            {ticks.length > 0 && <div className="relative mt-0.5 h-3.5 text-[10px] text-text-secondary" aria-hidden>
                {ticks.filter(tick => tick.major).map(tick => <span key={tick.ms} className={`absolute top-0 whitespace-nowrap ${edge(across(tick.ms))}`} style={{ left: `${across(tick.ms)}%` }}>{tick.label}</span>)}
            </div>}
        </div>
    </figure>;
}

interface MetricSlot {
    key: string;
    label: string;
    unit: OsMetric['unit'];
    kind: OsMetric['kind'];
}

const METRIC_GROUPS: { title: string; metrics: MetricSlot[] }[] = [
    {
        title: 'Traffic',
        metrics: [
            { key: 'sessions', label: 'Sessions', unit: 'count', kind: 'daily' },
            { key: 'new_visitors', label: 'New visitors', unit: 'count', kind: 'daily' },
            { key: 'total_visitors', label: 'Daily visitors (sum)', unit: 'count', kind: 'daily' },
            { key: 'search_clicks', label: 'Search clicks', unit: 'count', kind: 'daily' },
            { key: 'search_impressions', label: 'Search impressions', unit: 'count', kind: 'daily' },
            { key: 'ai_citations', label: 'AI citations', unit: 'count', kind: 'snapshot' },
            { key: 'ai_clicks', label: 'AI clicks', unit: 'count', kind: 'daily' },
        ],
    },
    {
        title: 'Audience',
        metrics: [
            { key: 'leads_new', label: 'New leads', unit: 'count', kind: 'daily' },
            { key: 'contacts_total', label: 'Email contacts', unit: 'count', kind: 'snapshot' },
            { key: 'customers_new', label: 'New customers', unit: 'count', kind: 'daily' },
            { key: 'subscribers_active', label: 'Subscribers', unit: 'count', kind: 'snapshot' },
        ],
    },
    {
        title: 'Revenue',
        metrics: [
            { key: 'revenue_total', label: 'Revenue', unit: 'money', kind: 'daily' },
            { key: 'subscriber_revenue', label: 'Subscriber revenue', unit: 'money', kind: 'daily' },
            { key: 'ad_revenue', label: 'AdSense revenue', unit: 'money', kind: 'daily' },
            { key: 'adx_revenue', label: 'AdX revenue', unit: 'money', kind: 'daily' },
            { key: 'adx_impressions', label: 'AdX impressions', unit: 'count', kind: 'daily' },
            { key: 'adx_clicks', label: 'AdX clicks', unit: 'count', kind: 'daily' },
            { key: 'mrr', label: 'MRR', unit: 'money', kind: 'snapshot' },
            { key: 'yrr', label: 'YRR', unit: 'money', kind: 'snapshot' },
        ],
    },
];

const REVENUE_KEYS = new Set(METRIC_GROUPS.find(group => group.title === 'Revenue')!.metrics.map(slot => slot.key));

function MetricCard({ m, slot }: { m?: OsMetric; slot: MetricSlot }) {
    const c = m?.coverage;
    const value = !m ? '–' : m.unit === 'money' ? m.currency && !m.warning ? new Intl.NumberFormat('en-US', { style: 'currency', currency: m.currency }).format(m.current / 100) : '–' : formatMetric(m.unit, m.current);
    return <div className="rounded-xl border border-border bg-background-card/40 p-3 min-w-0 space-y-1">
        <div className="flex items-baseline justify-between gap-2"><span className="text-xs text-text-secondary">{slot.label}</span><ChangeBadge change={m?.warning ? null : m?.change ?? null} /></div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <p className="text-[11px] text-text-secondary">{!m ? 'No observations for this period' : c ? `${c.start} → ${c.end}` : `Latest observation${m.asOf ? ` · ${m.asOf}` : ''}`}</p>
        {c && <p className={`text-[11px] ${c.observed < c.days ? 'text-amber-300' : 'text-text-secondary'}`}>{c.observed}/{c.days} days recorded{c.observed < c.days ? ' · partial total' : ''}</p>}
        {m?.series.length && !m.warning ? <Sparkline series={m.series} label={slot.label} start={c?.start} end={c?.end} format={(value) => m.unit === 'money' && m.currency ? new Intl.NumberFormat('en-US', { style: 'currency', currency: m.currency, maximumFractionDigits: 0 }).format(value / 100) : formatMetric(m.unit, value)} /> : null}
        {m && <details className="text-[11px] text-text-secondary"><summary className="cursor-pointer">Source & accuracy</summary>
            <p>{m.source ?? 'Company evidence'}{m.updatedAt ? ` · stored ${new Date(m.updatedAt).toLocaleString()}` : ''}</p>
            {m.warning && <p className="text-amber-300">{m.warning}</p>}
            {c && <p>Comparison: {c.previousStart} → {c.previousEnd}. {c.previousObserved}/{c.days} days recorded. Change requires two complete periods and a nonzero baseline. Missing dates are never zero.</p>}
            {slot.key === 'total_visitors' && <p>Sum of daily visitors, not distinct people over the period. Returning visitors can count on multiple days.</p>}
            {m.source === 'gsc' && <p>Search Console reporting is delayed; recent days may not have arrived.</p>}
            {m.kind === 'snapshot' && <p>A point-in-time measurement, not a period total.</p>}
        </details>}
    </div>;
}

function MetricGroup({ title, slots, metrics }: { title: string; slots: MetricSlot[]; metrics: Map<string, OsMetric> }) {
    return (
        <details className="space-y-2" open>
            <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-text-secondary">{title}</summary>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                {slots.map((slot) => <MetricCard key={slot.key} m={metrics.get(slot.key)} slot={slot} />)}
            </div>
        </details>
    );
}

function LiveTile({ title, source, children }: { title: string; source: string; children: ReactNode }) {
    return (
        <div className="rounded-md border border-border p-2.5 min-w-0">
            <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[11px] text-text-secondary">{title}</span>
                <span className="text-[10px] text-text-secondary">{source}</span>
            </div>
            {children}
        </div>
    );
}

export function timeAgo(iso: string | null): string {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export default function CompanySnapshot({
    companyId,
    connections,
    aiCitations,
    aiCitationSeries,
    onActivity,
}: {
    companyId: string;
    connections: OsConnection[];
    aiCitations: number;
    aiCitationSeries: { date: string; value: number }[];
    onActivity: () => void;
}) {
    const auth = useOsAuth();
    const has = (provider: string) => connections.some((c) => c.provider === provider);
    const hasPerformanceConnection = ['ga4', 'gsc', 'brevo', 'stripe', 'adsense', 'admanager', 'ahrefs', 'mercury', 'signups'].some(has);
    const [data, setData] = useState<{ lastSyncedAt: string | null; metrics: OsMetric[]; changes: string[] } | null>(null);
    const [period, setPeriod] = useState(7);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [serviceBusiness, setServiceBusiness] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [seo, setSeo] = useState<string | null>(null);
    const [cash, setCash] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        void fetch(`/api/os/companies/${companyId}/metrics?period=${period}`, { signal: controller.signal })
            .then(async res => { if (!res.ok) throw new Error(`Could not load metrics (${res.status}).`); return res.json(); })
            .then(body => { if (!controller.signal.aborted) { setData(body); setLoadError(null); } })
            .catch(error => { if (!controller.signal.aborted) setLoadError(error.message); });
        return () => controller.abort();
    }, [companyId, period, reloadKey]);

    const syncNow = async () => {
        setSyncing(true);
        setMessage(null);
        const res = await fetch(`/api/os/companies/${companyId}/metrics/sync`, { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as { error?: string; results?: { capabilityId: string; status: string; error?: string }[] };
        setSyncing(false);
        const problems = (body.results ?? []).filter((r) => r.status !== 'succeeded');
        setMessage(!res.ok ? body.error ?? `Sync failed (${res.status})` : problems.length ? problems.map((p) => p.error ?? p.status).join(' · ') : null);
        setReloadKey((k) => k + 1);
        onActivity();
    };

    const runSeo = async (capabilityId: string) => {
        setSeo('Working…');
        const res = await invoke(companyId, capabilityId);
        if (!('id' in res)) {
            setSeo(res.error);
        } else {
            setSeo(res.status === 'succeeded' || res.status === 'verified' ? res.summary ?? 'Done' : res.error ?? res.status);
        }
        onActivity();
    };

    const revealCash = async () => {
        setCash('Loading…');
        const res = await invoke(companyId, 'finance.cash.read');
        if (!('id' in res)) {
            setCash(res.error);
            return;
        }
        if (res.status !== 'succeeded') {
            setCash(res.error ?? res.status);
            return;
        }
        const out = res.output as { totalAvailable: number };
        setCash(formatMetric('money', Math.round(out.totalAvailable * 100)));
    };

    const citationDates = periodDates(period, new Date());
    const citationMetric: OsMetric = {
        key: 'ai_citations', label: 'AI citations', unit: 'count', kind: 'snapshot', series: aiCitationSeries.filter(row => row.date >= citationDates[0] && row.date <= citationDates.at(-1)!), source: 'Company citation evidence',
        current: aiCitations,
        previous: null,
        change: null,
        lastDay: null,
    };
    const metrics = new Map([...(data?.metrics ?? []), citationMetric].map((metric) => [metric.key, metric]));

    return (
        <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="font-medium">Company performance</h3><p className="text-xs text-text-secondary">Completed reporting days · compare with the preceding equal period. Source timezones may differ.</p></div>
                <label className="text-xs">Timeframe <select aria-label="Performance timeframe" value={period} onChange={e => { setData(null); setLoadError(null); setPeriod(Number(e.target.value)); }} className="ml-2 rounded-lg border border-border bg-background-card p-2">{[7, 14, 28, 90].map(days => <option value={days} key={days}>{days} days</option>)}</select></label>
            </div>
            {loadError && <p role="alert" className="text-sm text-amber-300">{loadError} <button onClick={() => setReloadKey(k => k + 1)} className="underline">Retry</button></p>}
            {hasPerformanceConnection ? <div className="flex items-center justify-end gap-2">
                    <span className="text-[11px] text-text-secondary">Last successful sync {timeAgo(data?.lastSyncedAt ?? null)}</span>
                    {auth.isManagerOrAdmin ? (
                        <button
                            type="button"
                            onClick={syncNow}
                            disabled={syncing}
                            className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card disabled:opacity-60"
                        >
                            {syncing ? 'Syncing…' : 'Sync now'}
                        </button>
                    ) : null}
                </div> : null}
            {message ? <p className="text-[11px] text-amber-400">{message}</p> : null}

            {data && data.changes.length ? (
                <ul className="rounded-md border border-border px-3 py-2 space-y-0.5">
                    {data.changes.map((c) => (
                        <li key={c} className="text-xs">
                            {c}
                        </li>
                    ))}
                </ul>
            ) : null}

            <ServiceDataPanel period={period} companyId={companyId} onEnabled={setServiceBusiness} />
            {METRIC_GROUPS.map((group) => {
                if (serviceBusiness && group.title === 'Audience') return null;
                const slots = group.title === 'Revenue' ? group.metrics.filter(slot => revenueMetricVisible(slot.key, connections) && (!serviceBusiness || !['subscriber_revenue', 'mrr', 'yrr'].includes(slot.key))) : group.metrics;
                return slots.length ? <MetricGroup key={group.title} title={group.title} slots={slots} metrics={metrics} /> : null;
            })}
            <MetricGroup title="Social" slots={[...SOCIAL_PLATFORMS, { id: 'other', label: 'Other social' }].map(({ id, label }) => ({ key: `social_sessions_${id}`, label: `${label} visits`, unit: 'count', kind: 'daily' }))} metrics={metrics} />
            {hasPerformanceConnection && data === null && !loadError ? <p className="text-xs text-text-secondary">Loading connected performance data…</p> : data && data.metrics.length === 0 && hasPerformanceConnection ? <p className="text-xs text-text-secondary">No connected performance history yet. The first sync backfills 90 days{auth.isManagerOrAdmin ? '; use Sync now to start it.' : '.'}</p> : null}

            {has('ahrefs') || (has('mercury') && auth.isManagerOrAdmin) ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {has('ahrefs') ? (
                        <LiveTile title="SEO" source="Ahrefs">
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" onClick={() => runSeo('seo.overview.read')} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card">
                                    Check SEO
                                </button>
                                {auth.isManagerOrAdmin ? (
                                    <button type="button" onClick={() => runSeo('seo.project.create')} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card">
                                        Set up SEO tracking
                                    </button>
                                ) : null}
                            </div>
                            {seo ? <p className="mt-1 text-[11px] text-text-secondary">{seo}</p> : null}
                        </LiveTile>
                    ) : null}
                    {has('mercury') && auth.isManagerOrAdmin ? (
                        <LiveTile title="Cash available" source="Mercury">
                            {cash ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-lg font-semibold tabular-nums">{cash}</span>
                                    <button type="button" onClick={() => setCash(null)} className="text-[11px] text-text-secondary hover:text-text-primary">
                                        Hide
                                    </button>
                                </div>
                            ) : (
                                <button type="button" onClick={revealCash} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card">
                                    Show balance
                                </button>
                            )}
                        </LiveTile>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}
