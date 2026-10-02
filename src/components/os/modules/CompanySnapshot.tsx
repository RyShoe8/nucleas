'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import type { OsConnection } from './companyTypes';

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

export function Sparkline({ series, label }: { series: { value: number }[]; label: string }) {
    if (series.length < 2) return null;
    const w = 120;
    const h = 28;
    const max = Math.max(...series.map((p) => p.value), 1);
    const points = series.map((p, i) => `${((i / (series.length - 1)) * w).toFixed(1)},${(h - (p.value / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
    return (
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label={`${label}, last ${series.length} days`} className="text-primary">
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
    );
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
            { key: 'total_visitors', label: 'Total visitors', unit: 'count', kind: 'daily' },
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
            { key: 'ad_revenue', label: 'Ad revenue', unit: 'money', kind: 'daily' },
            { key: 'mrr', label: 'MRR', unit: 'money', kind: 'snapshot' },
            { key: 'yrr', label: 'YRR', unit: 'money', kind: 'snapshot' },
        ],
    },
];

function MetricCard({ m, slot }: { m?: OsMetric; slot: MetricSlot }) {
    return (
        <div className="rounded-md border border-border p-2.5 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-text-secondary truncate">{slot.label}</span>
                <ChangeBadge change={m?.change ?? null} />
            </div>
            <div className="text-lg font-semibold tabular-nums leading-tight">{formatMetric(m?.unit ?? slot.unit, m?.current)}</div>
            <div className="text-[10px] text-text-secondary">
                {!m ? 'Connect a data source' : m.kind === 'daily' ? `last 7 days${m.lastDay ? ` · ${formatMetric(m.unit, m.lastDay.value)} on ${m.lastDay.date.slice(5)}` : ''}` : 'current'}
            </div>
            {m?.kind === 'daily' ? <Sparkline series={m.series} label={slot.label} /> : null}
        </div>
    );
}

function MetricGroup({ title, slots, metrics }: { title: string; slots: MetricSlot[]; metrics: Map<string, OsMetric> }) {
    return (
        <section className="space-y-2" aria-labelledby={`metric-group-${title.toLowerCase()}`}>
            <h3 id={`metric-group-${title.toLowerCase()}`} className="text-[11px] uppercase tracking-wider text-text-secondary">{title}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {slots.map((slot) => <MetricCard key={slot.key} m={metrics.get(slot.key)} slot={slot} />)}
            </div>
        </section>
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
    onActivity,
}: {
    companyId: string;
    connections: OsConnection[];
    aiCitations: number;
    onActivity: () => void;
}) {
    const auth = useOsAuth();
    const has = (provider: string) => connections.some((c) => c.provider === provider);
    const hasPerformanceConnection = ['ga4', 'gsc', 'brevo', 'stripe', 'adsense', 'ahrefs', 'mercury', 'signups'].some(has);
    const [data, setData] = useState<{ lastSyncedAt: string | null; metrics: OsMetric[]; changes: string[] } | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [syncing, setSyncing] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [seo, setSeo] = useState<string | null>(null);
    const [cash, setCash] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/companies/${companyId}/metrics?days=28`);
            const body = (await res.json().catch(() => null)) as { lastSyncedAt: string | null; metrics: OsMetric[]; changes: string[] } | null;
            if (!cancelled && res.ok && body) setData(body);
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId, reloadKey]);

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

    const citationMetric: OsMetric = { key: 'ai_citations', label: 'AI citations', unit: 'count', kind: 'snapshot', series: [], current: aiCitations, previous: null, change: null, lastDay: null };
    const metrics = new Map([...(data?.metrics ?? []), citationMetric].map((metric) => [metric.key, metric]));

    return (
        <section className="space-y-2">
            {hasPerformanceConnection ? <div className="flex items-center justify-end gap-2">
                    <span className="text-[11px] text-text-secondary">Synced {timeAgo(data?.lastSyncedAt ?? null)}</span>
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

            {METRIC_GROUPS.map((group) => <MetricGroup key={group.title} title={group.title} slots={group.metrics} metrics={metrics} />)}
            {hasPerformanceConnection && data === null ? <p className="text-xs text-text-secondary">Loading connected performance data…</p> : data && data.metrics.length === 0 && hasPerformanceConnection ? <p className="text-xs text-text-secondary">No connected performance history yet. The first sync backfills 90 days{auth.isManagerOrAdmin ? '; use Sync now to start it.' : '.'}</p> : null}

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
