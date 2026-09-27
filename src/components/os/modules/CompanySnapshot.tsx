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

/** Display order; metrics without data are skipped. */
const ORDER = ['sessions', 'new_visitors', 'search_clicks', 'search_impressions', 'leads_new', 'contacts_total', 'customers_new', 'payments', 'revenue_net', 'subscribers_active', 'mrr'];

function MetricCard({ m }: { m: OsMetric }) {
    return (
        <div className="rounded-md border border-border p-2.5 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-text-secondary truncate">{m.label}</span>
                <ChangeBadge change={m.change} />
            </div>
            <div className="text-lg font-semibold tabular-nums leading-tight">{formatMetric(m.unit, m.current)}</div>
            <div className="text-[10px] text-text-secondary">
                {m.kind === 'daily' ? `last 7 days${m.lastDay ? ` · ${formatMetric(m.unit, m.lastDay.value)} on ${m.lastDay.date.slice(5)}` : ''}` : 'current'}
            </div>
            {m.kind === 'daily' ? <Sparkline series={m.series} label={m.label} /> : null}
        </div>
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
    onActivity,
}: {
    companyId: string;
    connections: OsConnection[];
    onActivity: () => void;
}) {
    const auth = useOsAuth();
    const has = (provider: string) => connections.some((c) => c.provider === provider);
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

    if (!['ga4', 'gsc', 'brevo', 'stripe', 'ahrefs', 'mercury'].some(has)) return null;

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

    const metrics = (data?.metrics ?? []).filter((m) => ORDER.includes(m.key)).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

    return (
        <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] uppercase tracking-wider text-text-secondary">Performance</h3>
                <div className="flex items-center gap-2">
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
                </div>
            </div>
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

            {data === null ? (
                <p className="text-xs text-text-secondary">Loading…</p>
            ) : metrics.length === 0 ? (
                <p className="text-xs text-text-secondary">
                    No history yet. The first sync backfills 90 days{auth.isManagerOrAdmin ? '; use Sync now to start it.' : '.'}
                </p>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {metrics.map((m) => (
                        <MetricCard key={m.key} m={m} />
                    ))}
                </div>
            )}

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
