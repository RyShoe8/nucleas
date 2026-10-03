'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOsCompanies } from './CompaniesModule';
import JobCard, { JobStatusBadge, jobIsBusy, jobListProgress, scheduleLabel, type JobView } from './jobs/JobCard';

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

function NewJob({ onCreated, placeholder, marketing, initialCompanyId, initialKind, companyLocked = false }: { onCreated: (j: JobView) => void; placeholder: string; marketing?: boolean; initialCompanyId?: string; initialKind?: string; companyLocked?: boolean }) {
    const { companies } = useOsCompanies();
    const [companyId, setCompanyId] = useState(initialCompanyId ?? '');
    const [request, setRequest] = useState('');
    const [kind, setKind] = useState<'custom' | 'link_building' | 'seo_brief'>(initialKind === 'seo_brief' ? 'seo_brief' : marketing ? 'link_building' : 'custom');
    const [projects, setProjects] = useState<{ projectId: string; projectName: string }[]>([]);
    const [projectId, setProjectId] = useState('');
    const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
    const [time, setTime] = useState('09:00');
    const [weekday, setWeekday] = useState(1);
    const [dayOfMonth, setDayOfMonth] = useState(1);
    const [recordsPerRun, setRecordsPerRun] = useState(1);
    const [country, setCountry] = useState('United States');
    const [language, setLanguage] = useState('English');
    const [exclusions, setExclusions] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!companyId || kind === 'custom') return;
        let cancelled = false;
        void fetch(`/api/os/companies/${companyId}/code`, { cache: 'no-store' }).then(async (res) => {
            const body = (await res.json().catch(() => ({}))) as { projects?: { projectId: string; projectName: string }[] };
            if (!cancelled) {
                const next = body.projects ?? [];
                setProjects(next);
                if (next.length === 1) setProjectId(next[0].projectId);
            }
        });
        return () => { cancelled = true; };
    }, [companyId, kind]);
    const create = async () => {
        setBusy(true);
        setError(null);
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const payload = kind === 'link_building'
            ? {
                  companyId,
                  template: 'link_building',
                  config: {
                      projectId,
                      schedule: {
                          kind: frequency,
                          time,
                          timezone,
                          ...(frequency === 'weekly' ? { weekday } : {}),
                          ...(frequency === 'monthly' ? { dayOfMonth } : {}),
                      },
                      recordsPerRun,
                      country,
                      language,
                      exclusions,
                  },
              }
            : kind === 'seo_brief'
              ? { companyId, template: 'seo_brief', config: { projectId, projectName: projects.find((p) => p.projectId === projectId)?.projectName } }
            : { companyId, request };
        const res = await fetch('/api/os/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        const body = (await res.json().catch(() => ({}))) as { job?: JobView; error?: string };
        setBusy(false);
        if (!res.ok || !body.job) return setError(body.error ?? `Failed (${res.status})`);
        setRequest('');
        onCreated(body.job);
        window.dispatchEvent(new Event('nucleas:jobs-changed'));
    };
    return (
        <div className="ui-card p-4 space-y-4">
            {marketing ? (
                <div className="flex gap-1">
                    <button type="button" onClick={() => { setKind('link_building'); setProjectId(''); }} className={kind === 'link_building' ? 'ui-button-primary' : 'ui-button'}>Link building</button>
                    <button type="button" onClick={() => { setKind('seo_brief'); setProjectId(''); }} className={kind === 'seo_brief' ? 'ui-button-primary' : 'ui-button'}>Marketing plan</button>
                    <button type="button" onClick={() => { setKind('custom'); setProjectId(''); setProjects([]); }} className={kind === 'custom' ? 'ui-button-primary' : 'ui-button'}>Custom job</button>
                </div>
            ) : null}
            <div className="flex gap-2">
                {!companyLocked ? <select
                    value={companyId}
                    onChange={(e) => { setCompanyId(e.target.value); setProjectId(''); setProjects([]); }}
                    className="ui-control"
                    aria-label="Company"
                >
                    <option value="">Company…</option>
                    {(companies ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select> : null}
                <span className="text-[11px] text-text-secondary self-center">
                    {kind === 'link_building' ? 'Uses the project’s approved SEO brief to reject irrelevant opportunities.' : kind === 'seo_brief' ? 'Nucleas researches a project and creates an editable strategy draft for approval.' : 'Describe the work; Nucleas investigates, asks what it must, and designs it for your approval.'}
                </span>
            </div>
            {kind !== 'custom' && projects.length > 1 ? <label className="block space-y-1"><span className="ui-kicker">Website or project</span><select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="ui-control w-full" aria-label="Website or project"><option value="">Choose a website or project…</option>{projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}</select></label> : null}
            {kind === 'link_building' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                    <label className="space-y-1"><span className="text-text-secondary">Frequency</span><select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} className="ui-control block w-full"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                    {frequency === 'weekly' ? <label className="space-y-1"><span className="text-text-secondary">Day</span><select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className="block w-full h-7 rounded border border-border bg-background-elevated px-1">{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label> : null}
                    {frequency === 'monthly' ? <label className="space-y-1"><span className="text-text-secondary">Day of month</span><input type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} className="block w-full h-7 rounded border border-border bg-background-elevated px-1" /></label> : null}
                    <label className="space-y-1"><span className="text-text-secondary">Local time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="ui-control block w-full" /></label>
                    <label className="space-y-1"><span className="text-text-secondary">Recommendations</span><input type="number" min={1} max={10} value={recordsPerRun} onChange={(e) => setRecordsPerRun(Number(e.target.value))} className="ui-control block w-full" /></label>
                    <label className="space-y-1"><span className="text-text-secondary">Country</span><input value={country} onChange={(e) => setCountry(e.target.value)} className="ui-control block w-full" /></label>
                    <label className="space-y-1"><span className="text-text-secondary">Language</span><input value={language} onChange={(e) => setLanguage(e.target.value)} className="ui-control block w-full" /></label>
                    <label className="space-y-1 col-span-2 sm:col-span-3"><span className="text-text-secondary">Optional exclusions</span><input value={exclusions} onChange={(e) => setExclusions(e.target.value)} placeholder="Sites, categories, or tactics to exclude" className="ui-control block w-full" /></label>
                </div>
            ) : kind === 'custom' ? (
                <textarea value={request} onChange={(e) => setRequest(e.target.value)} placeholder={placeholder} className="ui-control w-full h-24 resize-y" aria-label="Job request" />
            ) : <p className="text-xs text-text-secondary">The first run produces a sourced draft. Accept the result, then edit and approve the brief from the job card.</p>}
            {error ? <p className="text-xs text-red-400">{error}</p> : null}
            <button
                type="button"
                disabled={busy || !companyId || (kind !== 'custom' && !projectId) || (kind === 'custom' && request.trim().length < 10)}
                onClick={() => void create()}
                className="ui-button-primary"
            >
                {busy ? 'Starting…' : kind === 'link_building' ? 'Configure link building' : kind === 'seo_brief' ? 'Generate marketing plan' : 'Design this job'}
            </button>
        </div>
    );
}

/**
 * Jobs: non-code work Nucleas designs and runs for each company. The Marketing and Content windows
 * are this view filtered to their categories.
 */
export default function JobsModule({ categories, title = 'Jobs', initialCompanyId, initialKind }: { categories?: string[]; title?: string; initialCompanyId?: string; initialKind?: string }) {
    const { companies: osCompanies } = useOsCompanies();
    const [jobs, setJobs] = useState<JobView[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [company, setCompany] = useState(initialCompanyId ?? 'all');
    const [showClosed, setShowClosed] = useState(false);
    const [open, setOpen] = useState<string | null>(null);
    const [creating, setCreating] = useState(Boolean(initialCompanyId && initialKind));
    const [reloadKey, setReloadKey] = useState(0);
    const reload = useCallback(() => setReloadKey((k) => k + 1), []);

    useEffect(() => {
        window.addEventListener('nucleas:jobs-changed', reload);
        return () => window.removeEventListener('nucleas:jobs-changed', reload);
    }, [reload]);

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
    const companies = useMemo(() => {
        const all = new Map((jobs ?? []).map((j) => [j.companyId, j.companyName]));
        for (const item of osCompanies ?? []) all.set(item.id, item.name);
        return [...all.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    }, [jobs, osCompanies]);
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
                <select value={company} onChange={(e) => setCompany(e.target.value)} className="ui-control" aria-label="Company">
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
                <button type="button" onClick={() => setCreating((v) => !v)} className="ui-button-primary">
                    {creating ? 'Close' : 'New job'}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {creating ? (
                    <NewJob
                        key={`${company}-${initialKind ?? ''}`}
                        placeholder={placeholder}
                        marketing={title === 'Marketing'}
                        initialCompanyId={company === 'all' ? initialCompanyId : company}
                        initialKind={initialKind}
                        companyLocked={company !== 'all'}
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
                            <h3 className="ui-kicker mb-2">
                                {g.label} · {items.length}
                            </h3>
                            <ul className="space-y-2">
                                {items.map((j) => {
                                    const progress = jobListProgress(j);
                                    const progressTone = progress.tone === 'active' ? 'bg-primary' : progress.tone === 'waiting' ? 'bg-amber-400' : progress.tone === 'complete' ? 'bg-emerald-400' : progress.tone === 'failed' ? 'bg-red-400' : 'bg-text-secondary';
                                    return open === j.id ? (
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
                                                className="ui-card-interactive w-full px-3 py-2.5 text-left"
                                            >
                                                <span className="flex items-center gap-2">
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-sm truncate">{j.design?.title ?? j.request}</span>
                                                        <span className="block text-[11px] text-text-secondary truncate">
                                                            {j.companyName}
                                                            {j.design ? ` · ${j.design.category} · ${scheduleLabel(j.design.schedule)}` : ''}
                                                        </span>
                                                    </span>
                                                    <JobStatusBadge status={j.status} />
                                                </span>
                                                <span className="mt-2 block">
                                                    <span className="mb-1 flex items-center justify-between gap-3 text-[10px] text-text-secondary">
                                                        <span className="truncate">{progress.label}</span>
                                                        <span className="tabular-nums">{progress.percent}%</span>
                                                    </span>
                                                    <span className="block h-1.5 overflow-hidden rounded-full bg-background-elevated" role="progressbar" aria-label={`${j.design?.title ?? j.request} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
                                                        <span className={`block h-full rounded-full transition-[width] duration-700 ease-out ${progressTone}`} style={{ width: `${progress.percent}%` }} />
                                                    </span>
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    );
                })}
            </div>
        </div>
    );
}
