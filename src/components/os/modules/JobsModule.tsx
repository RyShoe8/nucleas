'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOsCompanies } from './CompaniesModule';
import JobCard, { JobStatusBadge, jobIsBusy, scheduleLabel, type JobView } from './jobs/JobCard';

type Group = { key: string; label: string; test: (j: JobView) => boolean };

/** In order: what needs you, what is being worked on, what is set up, then history. */
const GROUPS: Group[] = [
    {
        key: 'you',
        label: 'Needs you',
        test: (j) => j.status === 'needs_answers' || j.status === 'proposed' || j.runs.some((r) => r.status === 'needs_review'),
    },
    { key: 'working', label: 'Working', test: (j) => jobIsBusy(j) || j.status === 'testing' },
    { key: 'set', label: 'Ready and active', test: (j) => ['ready', 'active', 'paused'].includes(j.status) },
    { key: 'done', label: 'Done', test: (j) => j.status === 'done' },
    { key: 'failed', label: 'Failed', test: (j) => j.status === 'failed' },
    { key: 'closed', label: 'Rejected and archived', test: (j) => j.status === 'rejected' || j.status === 'archived' },
];

function NewJob({ onCreated, placeholder }: { onCreated: (j: JobView) => void; placeholder: string }) {
    const { companies } = useOsCompanies();
    const [companyId, setCompanyId] = useState('');
    const [request, setRequest] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const create = async () => {
        setBusy(true);
        setError(null);
        const res = await fetch('/api/os/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId, request }) });
        const body = (await res.json().catch(() => ({}))) as { job?: JobView; error?: string };
        setBusy(false);
        if (!res.ok || !body.job) return setError(body.error ?? `Failed (${res.status})`);
        setRequest('');
        onCreated(body.job);
    };
    return (
        <div className="rounded-md border border-border p-3 space-y-2">
            <div className="flex gap-2">
                <select
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                    className="h-7 px-1 rounded border border-border bg-background-elevated text-xs"
                    aria-label="Company"
                >
                    <option value="">Company…</option>
                    {(companies ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
                <span className="text-[11px] text-text-secondary self-center">Describe the work; Nucleas investigates, asks what it must, and designs it for your approval.</span>
            </div>
            <textarea
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder={placeholder}
                className="w-full h-20 px-2 py-1.5 rounded border border-border bg-background-elevated text-sm resize-y"
                aria-label="Job request"
            />
            {error ? <p className="text-xs text-red-400">{error}</p> : null}
            <button
                type="button"
                disabled={busy || !companyId || request.trim().length < 10}
                onClick={() => void create()}
                className="text-[11px] px-2 py-1 rounded bg-primary text-white disabled:opacity-50"
            >
                {busy ? 'Starting…' : 'Design this job'}
            </button>
        </div>
    );
}

/**
 * Jobs: non-code work Nucleas designs and runs for each company. The Marketing and Content windows
 * are this view filtered to their categories.
 */
export default function JobsModule({ categories, title = 'Jobs' }: { categories?: string[]; title?: string }) {
    const [jobs, setJobs] = useState<JobView[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [company, setCompany] = useState('all');
    const [showClosed, setShowClosed] = useState(false);
    const [open, setOpen] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const reload = useCallback(() => setReloadKey((k) => k + 1), []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/jobs${showClosed ? '?all=1' : ''}`, { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as { jobs?: JobView[]; error?: string };
            if (cancelled) return;
            if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
            else {
                setJobs(body.jobs ?? []);
                setError(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [showClosed, reloadKey]);

    // Refresh while anything is being designed or run.
    const busy = jobs?.some(jobIsBusy) ?? false;
    useEffect(() => {
        if (!busy) return;
        const timer = window.setInterval(reload, 5000);
        return () => window.clearInterval(timer);
    }, [busy, reload]);

    const inView = useMemo(
        () => (jobs ?? []).filter((j) => (!categories || (j.design ? categories.includes(j.design.category) : true)) && (company === 'all' || j.companyId === company)),
        [jobs, categories, company]
    );
    const companies = useMemo(() => [...new Map((jobs ?? []).map((j) => [j.companyId, j.companyName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [jobs]);
    const replace = (next: JobView) => setJobs((list) => (list ?? []).map((j) => (j.id === next.id ? next : j)));

    if (error && !jobs) return <div className="p-4 text-sm text-red-400">{error}</div>;
    if (!jobs) return <div className="p-4 text-sm text-text-secondary">Loading…</div>;

    const placeholder =
        title === 'Marketing'
            ? 'e.g. Every day, earn one dofollow backlink to a PlayBound game page from a relevant site.'
            : title === 'Content'
              ? 'e.g. Each week, draft two articles for Frugal Gambler on the casino news that matters most.'
              : 'e.g. Research Deadlock in detail — developer, release date, platforms, server requirements — and add it to the PlayBound catalog.';

    return (
        <div className="h-full flex flex-col text-text-primary">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <select value={company} onChange={(e) => setCompany(e.target.value)} className="h-7 px-1 rounded border border-border bg-background-elevated text-xs" aria-label="Company">
                    <option value="all">All companies</option>
                    {companies.map(([id, name]) => (
                        <option key={id} value={id}>
                            {name}
                        </option>
                    ))}
                </select>
                <label className="flex items-center gap-1 text-[11px] text-text-secondary">
                    <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
                    Show rejected and archived
                </label>
                <span className="flex-1" />
                {busy ? <span className="text-[11px] text-sky-400">Working…</span> : null}
                <button type="button" onClick={() => setCreating((v) => !v)} className="text-[11px] px-2 py-0.5 rounded bg-primary text-white">
                    {creating ? 'Close' : 'New job'}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {creating ? (
                    <NewJob
                        placeholder={placeholder}
                        onCreated={(j) => {
                            setCreating(false);
                            setJobs((list) => [j, ...(list ?? [])]);
                            setOpen(j.id);
                        }}
                    />
                ) : null}
                {inView.length === 0 && !creating ? (
                    <p className="text-sm text-text-secondary">
                        No {title === 'Jobs' ? '' : `${title.toLowerCase()} `}jobs yet. Describe work with New job, or ask Nucleas (&ldquo;every day, …&rdquo;, &ldquo;research … and add it to …&rdquo;).
                    </p>
                ) : null}
                {GROUPS.map((g) => {
                    const items = inView.filter((j) => g.test(j) && !GROUPS.slice(0, GROUPS.indexOf(g)).some((earlier) => earlier.test(j)));
                    if (!items.length) return null;
                    return (
                        <section key={g.key}>
                            <h3 className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">
                                {g.label} · {items.length}
                            </h3>
                            <ul className="space-y-2">
                                {items.map((j) =>
                                    open === j.id ? (
                                        <li key={j.id}>
                                            <JobCard job={j} onChange={replace} />
                                            <button type="button" className="mt-1 text-[11px] text-text-secondary underline" onClick={() => setOpen(null)}>
                                                Collapse
                                            </button>
                                        </li>
                                    ) : (
                                        <li key={j.id}>
                                            <button
                                                type="button"
                                                onClick={() => setOpen(j.id)}
                                                className="w-full rounded-md border border-border px-3 py-2 flex items-center gap-2 text-left hover:bg-background-card"
                                            >
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm truncate">{j.design?.title ?? j.request}</span>
                                                    <span className="block text-[11px] text-text-secondary truncate">
                                                        {j.companyName}
                                                        {j.design ? ` · ${j.design.category} · ${scheduleLabel(j.design.schedule)}` : ''}
                                                    </span>
                                                </span>
                                                <JobStatusBadge status={j.status} />
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
