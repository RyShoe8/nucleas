'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import BuildCard, { StatusBadge, type BuildStatus, type BuildView } from './building/BuildCard';

/** Groups in queue order: what is running, what needs a person, then history. */
const GROUPS: { key: string; label: string; statuses: BuildStatus[] }[] = [
    { key: 'active', label: 'Building now', statuses: ['building', 'queued'] },
    { key: 'review', label: 'Ready for review', statuses: ['ready'] },
    { key: 'failed', label: 'Failed', statuses: ['failed'] },
    { key: 'approval', label: 'Awaiting approval', statuses: ['proposed'] },
    { key: 'done', label: 'Pull requests', statuses: ['pr_opened'] },
    { key: 'closed', label: 'Rejected and discarded', statuses: ['rejected', 'discarded'] },
];

function ago(iso: string | null): string {
    if (!iso) return '';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** Every company's code changes in one queue: approved plans build here and become pull requests. */
export default function BuildingModule() {
    const [builds, setBuilds] = useState<BuildView[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [company, setCompany] = useState('all');
    const [showClosed, setShowClosed] = useState(false);
    const [open, setOpen] = useState<string | null>(null);

    const [reloadKey, setReloadKey] = useState(0);
    const load = useCallback(() => setReloadKey((k) => k + 1), []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/builds${showClosed ? '?all=1' : ''}`, { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as { builds?: BuildView[]; error?: string };
            if (cancelled) return;
            if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
            else {
                setBuilds(body.builds ?? []);
                setError(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [showClosed, reloadKey]);

    // Poll while anything is running so progress shows without a manual refresh.
    const running = builds?.some((b) => b.status === 'queued' || b.status === 'building') ?? false;
    useEffect(() => {
        if (!running) return;
        const timer = window.setInterval(load, 8000);
        return () => window.clearInterval(timer);
    }, [running, load]);

    const companies = useMemo(() => [...new Map((builds ?? []).map((b) => [b.companyId, b.companyName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [builds]);
    const visible = (builds ?? []).filter((b) => company === 'all' || b.companyId === company);

    const replace = (next: BuildView) => setBuilds((list) => (list ?? []).map((b) => (b.id === next.id ? next : b)));

    if (error && !builds) return <div className="p-4 text-sm text-red-400">{error}</div>;
    if (!builds) return <div className="p-4 text-sm text-text-secondary">Loading…</div>;

    return (
        <div className="h-full flex flex-col text-text-primary">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <select
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="h-7 px-1 rounded border border-border bg-background-elevated text-xs"
                    aria-label="Company"
                >
                    <option value="all">All companies</option>
                    {companies.map(([id, name]) => (
                        <option key={id} value={id}>
                            {name}
                        </option>
                    ))}
                </select>
                <label className="flex items-center gap-1 text-[11px] text-text-secondary">
                    <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
                    Show rejected and discarded
                </label>
                <span className="flex-1" />
                {running ? <span className="text-[11px] text-sky-400">Building…</span> : null}
                <button type="button" onClick={load} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card">
                    Refresh
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {visible.length === 0 ? (
                    <p className="text-sm text-text-secondary">
                        Nothing in the queue. Ask Nucleas for a change to a company&apos;s site or app; approved plans build here.
                    </p>
                ) : null}
                {GROUPS.map((g) => {
                    const items = visible.filter((b) => g.statuses.includes(b.status));
                    if (!items.length) return null;
                    return (
                        <section key={g.key}>
                            <h3 className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">
                                {g.label} · {items.length}
                            </h3>
                            <ul className="space-y-2">
                                {items.map((b) =>
                                    open === b.id ? (
                                        <li key={b.id}>
                                            <BuildCard build={b} onChange={replace} />
                                            <button type="button" className="mt-1 text-[11px] text-text-secondary underline" onClick={() => setOpen(null)}>
                                                Collapse
                                            </button>
                                        </li>
                                    ) : (
                                        <li key={b.id}>
                                            <button
                                                type="button"
                                                onClick={() => setOpen(b.id)}
                                                className="w-full rounded-md border border-border px-3 py-2 flex items-center gap-2 text-left hover:bg-background-card"
                                            >
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm truncate">{b.title}</span>
                                                    <span className="block text-[11px] text-text-secondary truncate">
                                                        {b.companyName} · {b.repository.fullName} · {ago(b.updatedAt)}
                                                    </span>
                                                </span>
                                                <StatusBadge status={b.status} />
                                            </button>
                                        </li>
                                    )
                                )}
                            </ul>
                        </section>
                    );
                })}
            </div>
        </div>
    );
}
