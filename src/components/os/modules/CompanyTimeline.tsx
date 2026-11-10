'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import { visibleInterval } from '@/lib/os/visibleInterval';
import type { FeedItem, FeedKind, FeedTone } from '@/lib/companies/activityFeed';
import type { OsInvocation } from './CompanySnapshot';

const FILTERS: { id: string; label: string; kinds: FeedKind[] | null }[] = [
    { id: 'all', label: 'Everything', kinds: null },
    { id: 'work', label: 'Team work', kinds: ['work'] },
    { id: 'post', label: 'Posts', kinds: ['post'] },
    { id: 'decision', label: 'Decisions', kinds: ['decision'] },
    { id: 'code', label: 'Code & builds', kinds: ['code', 'build'] },
    { id: 'setup', label: 'Setup & data', kinds: ['setup', 'sync'] },
];
const KIND_LABEL: Record<FeedKind, string> = { work: 'Work', post: 'Post', decision: 'Decision', build: 'Build', code: 'Code', setup: 'Setup', sync: 'Data' };
const TONE_DOT: Record<FeedTone, string> = { ok: 'bg-emerald-400', attention: 'bg-amber-300', failed: 'bg-red-400', running: 'bg-sky-400 animate-pulse', neutral: 'bg-text-secondary/50' };

export type TimelineRow = FeedItem & { count: number; firstAt: string };

const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function dayLabel(iso: string, now = new Date()): string {
    const d = new Date(iso);
    const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Newest first, split by local day; the same thing repeating back to back (an hourly check) becomes one row. */
export function groupTimeline(items: FeedItem[]): { key: string; label: string; rows: TimelineRow[] }[] {
    const days: { key: string; label: string; rows: TimelineRow[] }[] = [];
    for (const item of [...items].sort((a, b) => b.at.localeCompare(a.at))) {
        const key = dayKey(item.at);
        let day = days.at(-1);
        if (!day || day.key !== key) { day = { key, label: dayLabel(item.at), rows: [] }; days.push(day); }
        const last = day.rows.at(-1);
        if (last && item.repeatKey && last.repeatKey === item.repeatKey) { last.count += 1; last.firstAt = item.at; }
        else day.rows.push({ ...item, count: 1, firstAt: item.at });
    }
    return days;
}

export default function CompanyTimeline({ companyId, refreshKey, onOpenJob }: { companyId: string; refreshKey: number; onOpenJob?: (jobId: string) => void }) {
    const auth = useOsAuth();
    const [items, setItems] = useState<FeedItem[] | null>(null);
    const [approvals, setApprovals] = useState<OsInvocation[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [days, setDays] = useState(14);
    const [filter, setFilter] = useState('all');
    const [attentionOnly, setAttentionOnly] = useState(false);
    const [query, setQuery] = useState('');

    const load = useCallback(async (signal?: AbortSignal) => {
        try {
            const [feed, actions] = await Promise.all([
                fetch(`/api/os/companies/${companyId}/feed?days=${days}`, { signal, cache: 'no-store' }),
                fetch(`/api/os/companies/${companyId}/activity`, { signal, cache: 'no-store' }),
            ]);
            const body = (await feed.json().catch(() => ({}))) as { items?: FeedItem[]; error?: string };
            if (!feed.ok) throw new Error(body.error ?? `Could not load activity (${feed.status}).`);
            const pending = actions.ok ? ((await actions.json().catch(() => ({}))) as { items?: OsInvocation[] }).items ?? [] : [];
            if (signal?.aborted) return;
            setItems(body.items ?? []); setApprovals(pending.filter((i) => i.status === 'pending_approval' && i.approvalId)); setError(null);
        } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Could not load activity.'); }
    }, [companyId, days]);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        const stop = visibleInterval(() => { void load(controller.signal); }, 60_000);
        return () => { controller.abort(); stop(); };
    }, [load, refreshKey]);

    const decide = async (approvalId: string, decision: 'approve' | 'deny') => {
        const res = await fetch(`/api/os/approvals/${approvalId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }) });
        if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Failed (${res.status})`);
        void load();
    };

    const kinds = FILTERS.find((f) => f.id === filter)?.kinds ?? null;
    const shown = useMemo(() => (items ?? []).filter((i) => (!kinds || kinds.includes(i.kind))
        && (!attentionOnly || i.tone === 'attention' || i.tone === 'failed')
        && (!query || `${i.title} ${i.subject ?? ''} ${i.detail ?? ''} ${i.member ?? ''}`.toLowerCase().includes(query.toLowerCase()))), [items, kinds, attentionOnly, query]);
    const grouped = useMemo(() => groupTimeline(shown), [shown]);
    const count = (test: (i: FeedItem) => boolean) => (items ?? []).filter(test).length;

    return (
        <section className="space-y-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
                <div><h3 className="text-lg font-semibold">Activity</h3><p className="text-sm text-text-secondary">Everything your team and you did for this company, newest first.</p></div>
                <label className="text-xs">Show <select aria-label="Activity timeframe" value={days} onChange={(e) => { setItems(null); setDays(Number(e.target.value)); }} className="ml-2 rounded-lg border border-border bg-background-card p-2">{[7, 14, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select></label>
            </header>

            {items && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{([
                ['Runs finished', count((i) => i.kind === 'work' && i.tone === 'ok'), 'text-text-primary'],
                ['Posts published', count((i) => i.kind === 'post' && i.tone === 'ok'), 'text-text-primary'],
                ['Waiting on you', count((i) => i.tone === 'attention') + approvals.length, 'text-amber-300'],
                ['Failures', count((i) => i.tone === 'failed'), 'text-red-400'],
            ] as const).map(([label, value, tone]) => <div key={label} className="rounded-xl border border-border p-3"><p className="text-[11px] uppercase tracking-wider text-text-secondary">{label}</p><strong className={`text-xl tabular-nums ${value ? tone : 'text-text-secondary'}`}>{value}</strong></div>)}</div>}

            {approvals.length > 0 && <div className="rounded-xl border border-amber-300/40 p-3 space-y-2">
                <h4 className="text-sm font-medium text-amber-300">Waiting for your approval</h4>
                {approvals.map((a) => <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1">{a.title}<span className="ml-2 text-xs text-text-secondary">{a.providerName}{a.summary ? ` · ${a.summary}` : ''}</span></span>
                    {auth.isManagerOrAdmin ? <><button type="button" className="ui-button-primary" onClick={() => void decide(a.approvalId!, 'approve')}>Approve</button><button type="button" className="ui-button" onClick={() => void decide(a.approvalId!, 'deny')}>Deny</button></> : <span className="text-xs text-text-secondary">A manager decides.</span>}
                </div>)}
            </div>}

            <div className="flex flex-wrap items-center gap-2">
                {FILTERS.map((f) => <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={`rounded-full border px-3 py-1 text-xs ${filter === f.id ? 'border-primary bg-primary/15 text-primary' : 'border-border text-text-secondary hover:bg-background-card'}`}>{f.label}</button>)}
                <label className="ml-auto flex items-center gap-1 text-xs text-text-secondary"><input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />Only problems and reviews</label>
                <input aria-label="Search activity" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-36 rounded-lg border border-border bg-background px-3 py-1.5 text-xs" />
            </div>

            {error && <p role="alert" className="text-sm text-amber-300">{error} <button type="button" className="underline" onClick={() => void load()}>Retry</button></p>}
            {items === null && !error ? <p className="text-sm text-text-secondary">Loading activity…</p> : null}
            {items && grouped.length === 0 ? <p className="text-sm text-text-secondary">{items.length ? 'Nothing matches these filters.' : `Nothing happened in the last ${days} days.`}</p> : null}

            {grouped.map((day) => <div key={day.key}>
                <h4 className="sticky top-12 z-[1] bg-background py-1 text-[11px] uppercase tracking-wider text-text-secondary">{day.label} <span className="normal-case tracking-normal">· {day.rows.reduce((n, r) => n + r.count, 0)}</span></h4>
                <ul className="rounded-xl border border-border divide-y divide-border">
                    {day.rows.map((row) => <li key={row.id} className="flex gap-3 px-3 py-2">
                        <time dateTime={row.at} className="w-16 shrink-0 pt-0.5 text-xs tabular-nums text-text-secondary">{clock(row.at)}</time>
                        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[row.tone]}`} />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm">
                                <span className={row.tone === 'failed' ? 'text-red-400' : row.tone === 'attention' ? 'text-amber-300' : ''}>{row.title}</span>
                                {row.count > 1 ? <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-text-secondary">{row.count} times since {clock(row.firstAt)}</span> : null}
                            </p>
                            <p className="text-xs text-text-secondary">
                                {[row.subject, row.member, KIND_LABEL[row.kind]].filter(Boolean).join(' · ')}
                            </p>
                            {row.detail && row.detail !== row.url ? <p className="mt-0.5 break-words text-xs text-text-secondary">{row.detail}</p> : null}
                        </div>
                        <div className="flex shrink-0 items-start gap-2 text-xs">
                            {row.url ? <a href={row.url} target="_blank" rel="noreferrer" className="underline text-text-secondary hover:text-text-primary">View</a> : null}
                            {row.jobId && onOpenJob ? <button type="button" className="underline text-primary" onClick={() => onOpenJob(row.jobId!)}>Open</button> : null}
                        </div>
                    </li>)}
                </ul>
            </div>)}
        </section>
    );
}
