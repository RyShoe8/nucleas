'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOsCompanies } from './CompaniesModule';
import JobCard, { JobLastChecked, JobStatusBadge, jobIsBusy, jobListProgress, scheduleLabel, type JobView } from './jobs/JobCard';
import ArtifactHistory from './jobs/ArtifactHistory';
import MarketingPlanEditor from './jobs/MarketingPlanEditor';
import BrandAssetsPanel from './jobs/BrandAssetsPanel';
import WatchesPanel from './content/WatchesPanel';
import MarketingComposer from './jobs/MarketingComposer';
import ReadyPostCard from './jobs/publishing/ReadyPostCard';
import { ActivityRows, activityFor, useActivity } from './jobs/ActivityList';

type Group = { key: string; label: string; test: (j: JobView) => boolean };

/** In order: what needs you, what is being worked on, what is set up, then history. */
const GROUPS: Group[] = [
    {
        key: 'you',
        label: 'Needs you',
        test: (j) => j.status === 'needs_answers' || j.status === 'proposed' || j.runs.some((r) => r.status === 'needs_review') || Boolean(j.publishing?.ready.length),
    },
    { key: 'working', label: 'Working', test: (j) => jobIsBusy(j) || j.status === 'testing' },
    { key: 'set', label: 'Ready and active', test: (j) => ['ready', 'active', 'paused'].includes(j.status) },
    { key: 'done', label: 'Done', test: (j) => j.status === 'done' },
    { key: 'failed', label: 'Failed', test: (j) => j.status === 'failed' },
];

function NewJob({ onCreated, onCancel, placeholder, initialCompanyId, initialKind, companyLocked = false }: { onCreated: (j: JobView) => void; onCancel?: () => void; placeholder: string; initialCompanyId?: string; initialKind?: string; companyLocked?: boolean }) {
    const { companies } = useOsCompanies();
    const [companyId, setCompanyId] = useState(initialCompanyId ?? '');
    const [request, setRequest] = useState('');
    const kind: 'custom' | 'link_building' = initialKind === 'link_building' ? 'link_building' : 'custom';
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
        if (!companyId || kind !== 'link_building') return;
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
                    {kind === 'link_building' ? 'Link building: uses the company’s approved Marketing Plan to reject irrelevant opportunities.' : 'Describe the work; Nucleas investigates, asks what it must, and designs it for your approval.'}
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
            ) : (
                <textarea value={request} onChange={(e) => setRequest(e.target.value)} placeholder={placeholder} className="ui-control w-full h-24 resize-y" aria-label="Job request" />
            )}
            {error ? <p className="text-xs text-red-400">{error}</p> : null}
            <button
                type="button"
                disabled={busy || !companyId || (kind === 'link_building' && !projectId) || (kind === 'custom' && request.trim().length < 10)}
                onClick={() => void create()}
                className="ui-button-primary"
            >
                {busy ? 'Starting…' : kind === 'link_building' ? 'Configure link building' : 'Design this job'}
            </button>
            {onCancel ? <button type="button" onClick={onCancel} className="ui-button ml-2">Cancel</button> : null}
        </div>
    );
}

/** Overview: the company's Marketing plan to read or edit, its earlier versions, and a button to generate a new one. */
function MarketingOverview({ companyId, busy, error, onGenerate }: { companyId: string; busy: boolean; error: string | null; onGenerate: () => void }) {
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-sm font-medium">Marketing plan</span>
                <button type="button" className="ui-button" disabled={busy} onClick={onGenerate} title="A one-time overview, updated only when you ask. Earlier versions are kept.">{busy ? 'Starting…' : 'Generate new version'}</button>
            </div>
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            <MarketingPlanEditor companyId={companyId} />
            <ArtifactHistory companyId={companyId} kind="marketing_plan" />
        </div>
    );
}

/**
 * Jobs: non-code work Nucleas designs and runs for each company. The Marketing and Content windows
 * are this view filtered to their categories.
 */
export default function JobsModule({ categories, title = 'Jobs', initialCompanyId, initialKind, initialView }: { categories?: string[]; title?: string; initialCompanyId?: string; initialKind?: string; initialView?: string }) {
    const { companies: osCompanies } = useOsCompanies();
    const [jobs, setJobs] = useState<JobView[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [company, setCompany] = useState(initialCompanyId ?? 'all');
    // Marketing only: the company's Marketing plan, shown instead of the jobs.
    const [showOverview, setShowOverview] = useState(initialKind === 'marketing_plan');
    const [showAssets, setShowAssets] = useState(false);
    // Marketing only: the mailboxes and watches that feed its inbox jobs.
    const [showInboxes, setShowInboxes] = useState(initialView === 'inboxes');
    const [open, setOpen] = useState<string | null>(null);
    const marketing = title === 'Marketing';
    const [creating, setCreating] = useState(!marketing && Boolean(initialCompanyId && initialKind));
    const [linkBuilding, setLinkBuilding] = useState(marketing && initialKind === 'link_building');
    const [planBusy, setPlanBusy] = useState(false);
    const [planError, setPlanError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const reload = useCallback(() => setReloadKey((k) => k + 1), []);

    useEffect(() => {
        const refreshVisible = () => {
            if (document.visibilityState === 'visible') reload();
        };
        window.addEventListener('nucleas:jobs-changed', reload);
        window.addEventListener('focus', refreshVisible);
        document.addEventListener('visibilitychange', refreshVisible);
        return () => {
            window.removeEventListener('nucleas:jobs-changed', reload);
            window.removeEventListener('focus', refreshVisible);
            document.removeEventListener('visibilitychange', refreshVisible);
        };
    }, [reload]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch('/api/os/jobs', { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as { jobs?: JobView[]; error?: string };
            if (cancelled) return;
            if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
            else {
                setJobs(body.jobs ?? []);
                setError(null);
            }
        })().catch(() => {
            if (!cancelled) setError('Could not refresh jobs. Retrying shortly.');
        });
        return () => {
            cancelled = true;
        };
    }, [reloadKey]);

    // Watches and articles run outside of jobs; they are shown here too, so this is one live view of everything.
    const activity = useActivity(reloadKey);

    // Other teammates can handle review cards even when no worker is running.
    // Keep the shared list fresh while idle too, and refresh immediately on return.
    const busy = (jobs?.some(jobIsBusy) ?? false) || Boolean(activity?.busy);
    useEffect(() => {
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') reload();
        }, busy ? 5000 : 15_000);
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
    const created = useCallback((j: JobView) => {
        setJobs((list) => [j, ...(list ?? []).filter((x) => x.id !== j.id)]);
        setOpen(j.id);
    }, []);
    const companyName = companies.find(([id]) => id === company)?.[1] ?? 'this company';
    const generatePlan = async () => {
        setPlanBusy(true);
        setPlanError(null);
        const res = await fetch('/api/os/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId: company, template: 'marketing_plan', config: { companyName } }) });
        const body = (await res.json().catch(() => ({}))) as { job?: JobView; error?: string };
        setPlanBusy(false);
        if (!res.ok || !body.job) return setPlanError(body.error ?? `Failed (${res.status})`);
        created(body.job);
        window.dispatchEvent(new Event('nucleas:jobs-changed'));
    };
    // Posts waiting for a person, across every job in view: the first thing to see in Marketing.
    const readyPosts = inView.flatMap((job) => (job.publishing?.ready ?? []).filter((d) => d.status === 'ready').map((delivery) => ({ job, delivery })));

    if (error && !jobs) return <div className="p-4 text-sm text-red-400">{error}</div>;
    if (!jobs) return <div className="p-4 text-sm text-text-secondary">Loading…</div>;

    const placeholder =
        title === 'Marketing'
            ? 'e.g. Every day, earn one dofollow backlink to a PlayBound game page from a relevant site.'
            : title === 'Content'
              ? 'e.g. Each week, draft two articles for Frugal Gambler on the casino news that matters most.'
              : 'e.g. Research Deadlock in detail — developer, release date, platforms, server requirements — and add it to the PlayBound catalog.';

    return (
        <div className="touch-comfort h-full flex flex-col text-text-primary">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
                <select value={company} onChange={(e) => setCompany(e.target.value)} className="ui-control" aria-label="Company">
                    <option value="all">All companies</option>
                    {companies.map(([id, name]) => (
                        <option key={id} value={id}>
                            {name}
                        </option>
                    ))}
                </select>
                <span className="flex-1" />
                {busy ? <span className="text-[11px] text-sky-400">Working…</span> : null}
                {title === 'Marketing' ? <button type="button" onClick={() => { setShowOverview((v) => !v); setShowInboxes(false); setShowAssets(false); }} disabled={company === 'all'} title={company === 'all' ? 'Choose a company first' : 'The company’s Marketing plan'} className={showOverview && company !== 'all' ? 'ui-button-primary' : 'ui-button'} aria-pressed={showOverview && company !== 'all'}>Overview</button> : null}
                {title === 'Marketing' ? <button type="button" onClick={() => { setShowInboxes((v) => !v); setShowAssets(false); setShowOverview(false); }} className={showInboxes ? 'ui-button-primary' : 'ui-button'} aria-pressed={showInboxes} title="Mailboxes Nucleas watches for deals and other emails">Inboxes</button> : null}
                {title === 'Marketing' ? <button type="button" onClick={() => { setShowAssets((v) => !v); setShowInboxes(false); setShowOverview(false); }} disabled={company === 'all'} title={company === 'all' ? 'Choose a company first' : undefined} className={showAssets && company !== 'all' ? 'ui-button-primary' : 'ui-button'} aria-pressed={showAssets && company !== 'all'}>Assets</button> : null}
                {title !== 'Marketing' ? <button type="button" onClick={() => setCreating((v) => !v)} className="ui-button-primary">
                    {creating ? 'Close' : 'New job'}
                </button> : null}
            </div>

            {showOverview && title === 'Marketing' && company !== 'all' ? (
                <div className="flex-1 overflow-y-auto p-3">
                    <MarketingOverview key={company} companyId={company} busy={planBusy} error={planError} onGenerate={() => void generatePlan()} />
                </div>
            ) : null}

            {showInboxes && title === 'Marketing' ? (
                <div className="flex-1 overflow-y-auto">
                    <WatchesPanel />
                </div>
            ) : null}

            {showAssets && title === 'Marketing' && company !== 'all' ? (
                <div className="flex-1 overflow-y-auto p-3">
                    <BrandAssetsPanel key={company} companyId={company} companyName={companies.find(([id]) => id === company)?.[1] ?? 'Company'} />
                </div>
            ) : null}

            <div className={`flex-1 overflow-y-auto p-3 space-y-4 ${(showAssets && title === 'Marketing' && company !== 'all') || (showOverview && title === 'Marketing' && company !== 'all') || (showInboxes && title === 'Marketing') ? 'hidden' : ''}`}>
                {readyPosts.length ? (
                    <section className="space-y-2">
                        <h3 className="ui-kicker">Waiting for you · {readyPosts.length}</h3>
                        {readyPosts.map(({ job: j, delivery }) => (
                            <ReadyPostCard key={delivery.id} jobId={j.id} companyName={company === 'all' ? j.companyName : undefined} delivery={delivery} subreddit={j.companySubreddit ?? null} formUrl={j.publishing?.admin?.formUrl ?? null} onChange={replace} />
                        ))}
                    </section>
                ) : null}
                {marketing && company !== 'all' ? (
                    <div className="space-y-3" key={company}>
                        {linkBuilding ? (
                            <NewJob placeholder={placeholder} initialCompanyId={company} initialKind="link_building" companyLocked onCancel={() => setLinkBuilding(false)} onCreated={(j) => { setLinkBuilding(false); created(j); }} />
                        ) : (
                            <MarketingComposer companyId={company} companyName={companyName} onCreated={created} onMarketingPlan={() => void generatePlan()} renderLinkBuilding={(done) => <NewJob placeholder={placeholder} initialCompanyId={company} initialKind="link_building" companyLocked onCancel={done} onCreated={(j) => { done(); created(j); }} />} />
                        )}
                    </div>
                ) : null}
                {marketing && company === 'all' ? <p className="text-xs text-text-secondary">Choose a company to start a marketing job.</p> : null}
                {!marketing && creating ? (
                    <NewJob
                        key={`${company}-${initialKind ?? ''}`}
                        placeholder={placeholder}
                        initialCompanyId={company === 'all' ? initialCompanyId : company}
                        initialKind={initialKind}
                        companyLocked={company !== 'all'}
                        onCreated={(j) => {
                            setCreating(false);
                            created(j);
                        }}
                    />
                ) : null}
                {inView.length === 0 && !creating && !marketing && !(['you', 'working', 'set', 'failed'] as const).some((g) => activityFor(activity, g, company, categories).length) ? (
                    <p className="text-sm text-text-secondary">
                        No {title === 'Jobs' ? '' : `${title.toLowerCase()} `}jobs yet. Describe work with New job, or ask Nucleas (&ldquo;every day, …&rdquo;, &ldquo;research … and add it to …&rdquo;).
                    </p>
                ) : null}
                {GROUPS.map((g) => {
                    const items = inView.filter((j) => g.test(j) && !GROUPS.slice(0, GROUPS.indexOf(g)).some((earlier) => earlier.test(j)));
                    const activityGroup = g.key === 'you' || g.key === 'working' || g.key === 'set' || g.key === 'failed' ? g.key : null;
                    const others = activityGroup ? activityFor(activity, activityGroup, company, categories) : [];
                    const extra = others.length;
                    if (!items.length && !extra) return null;
                    return (
                        <section key={g.key}>
                            <h3 className="ui-kicker mb-2">
                                {g.label} · {items.length + extra}
                            </h3>
                            <ul className="space-y-2">
                                {extra ? <ActivityRows items={others} showCompany={company === 'all'} /> : null}
                                {items.map((j) => {
                                    const progress = jobListProgress(j);
                                    const progressTone = progress.tone === 'active' ? 'bg-primary' : progress.tone === 'waiting' ? 'bg-amber-400' : progress.tone === 'complete' ? 'bg-emerald-400' : progress.tone === 'failed' ? 'bg-red-400' : 'bg-text-secondary';
                                    return open === j.id ? (
                                        <li key={j.id}>
                                            <JobCard job={j} onChange={replace} readyShownAbove />
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
                                                            <JobLastChecked job={j} />
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
