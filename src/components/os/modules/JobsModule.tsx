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

function NewJob({ onCreated, placeholder, marketing }: { onCreated: (j: JobView) => void; placeholder: string; marketing?: boolean }) {
    const { companies } = useOsCompanies();
    const [companyId, setCompanyId] = useState('');
    const [request, setRequest] = useState('');
    const [kind, setKind] = useState<'custom' | 'link_building' | 'seo_brief'>(marketing ? 'link_building' : 'custom');
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
        setProjectId('');
        if (!companyId || kind === 'custom') { setProjects([]); return; }
        let cancelled = false;
        void fetch(`/api/os/companies/${companyId}/code`, { cache: 'no-store' }).then(async (res) => {
            const body = (await res.json().catch(() => ({}))) as { projects?: { projectId: string; projectName: string }[] };
            if (!cancelled) setProjects(body.projects ?? []);
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
    };
    return (
        <div className="rounded-md border border-border p-3 space-y-2">
            {marketing ? (
                <div className="flex gap-1">
                    <button type="button" onClick={() => setKind('link_building')} className={`text-[11px] px-2 py-1 rounded border ${kind === 'link_building' ? 'border-primary text-primary' : 'border-border text-text-secondary'}`}>Link building</button>
                    <button type="button" onClick={() => setKind('seo_brief')} className={`text-[11px] px-2 py-1 rounded border ${kind === 'seo_brief' ? 'border-primary text-primary' : 'border-border text-text-secondary'}`}>SEO brief</button>
                    <button type="button" onClick={() => setKind('custom')} className={`text-[11px] px-2 py-1 rounded border ${kind === 'custom' ? 'border-primary text-primary' : 'border-border text-text-secondary'}`}>Custom job</button>
                </div>
            ) : null}
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
                <span className="text-[11px] text-text-secondary self-center">
                    {kind === 'link_building' ? 'Uses the project’s approved SEO brief to reject irrelevant opportunities.' : kind === 'seo_brief' ? 'Nucleas researches a project and creates an editable strategy draft for approval.' : 'Describe the work; Nucleas investigates, asks what it must, and designs it for your approval.'}
                </span>
            </div>
            {kind !== 'custom' ? <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-7 w-full px-1 rounded border border-border bg-background-elevated text-xs" aria-label="Project"><option value="">Project…</option>{projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}</select> : null}
            {kind === 'link_building' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                    <label className="space-y-1"><span className="text-text-secondary">Frequency</span><select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} className="block w-full h-7 rounded border border-border bg-background-elevated px-1"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                    {frequency === 'weekly' ? <label className="space-y-1"><span className="text-text-secondary">Day</span><select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className="block w-full h-7 rounded border border-border bg-background-elevated px-1">{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label> : null}
                    {frequency === 'monthly' ? <label className="space-y-1"><span className="text-text-secondary">Day of month</span><input type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} className="block w-full h-7 rounded border border-border bg-background-elevated px-1" /></label> : null}
                    <label className="space-y-1"><span className="text-text-secondary">Local time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="block w-full h-7 rounded border border-border bg-background-elevated px-1" /></label>
                    <label className="space-y-1"><span className="text-text-secondary">Recommendations</span><input type="number" min={1} max={10} value={recordsPerRun} onChange={(e) => setRecordsPerRun(Number(e.target.value))} className="block w-full h-7 rounded border border-border bg-background-elevated px-1" /></label>
                    <label className="space-y-1"><span className="text-text-secondary">Country</span><input value={country} onChange={(e) => setCountry(e.target.value)} className="block w-full h-7 rounded border border-border bg-background-elevated px-1" /></label>
                    <label className="space-y-1"><span className="text-text-secondary">Language</span><input value={language} onChange={(e) => setLanguage(e.target.value)} className="block w-full h-7 rounded border border-border bg-background-elevated px-1" /></label>
                    <label className="space-y-1 col-span-2 sm:col-span-3"><span className="text-text-secondary">Optional exclusions</span><input value={exclusions} onChange={(e) => setExclusions(e.target.value)} placeholder="Sites, categories, or tactics to exclude" className="block w-full h-7 rounded border border-border bg-background-elevated px-1" /></label>
                </div>
            ) : kind === 'custom' ? (
                <textarea value={request} onChange={(e) => setRequest(e.target.value)} placeholder={placeholder} className="w-full h-20 px-2 py-1.5 rounded border border-border bg-background-elevated text-sm resize-y" aria-label="Job request" />
            ) : <p className="text-xs text-text-secondary">The first run produces a sourced draft. Accept the result, then edit and approve the brief from the job card.</p>}
            {error ? <p className="text-xs text-red-400">{error}</p> : null}
            <button
                type="button"
                disabled={busy || !companyId || (kind !== 'custom' && !projectId) || (kind === 'custom' && request.trim().length < 10)}
                onClick={() => void create()}
                className="text-[11px] px-2 py-1 rounded bg-primary text-white disabled:opacity-50"
            >
                {busy ? 'Starting…' : kind === 'link_building' ? 'Configure link building' : kind === 'seo_brief' ? 'Create SEO brief' : 'Design this job'}
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
                        marketing={title === 'Marketing'}
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
