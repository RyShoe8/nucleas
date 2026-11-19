'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ActivityItem } from '@/lib/activity/types-client';
import { TEAM, TEAM_ROLES, type TeamRole } from '@/lib/companies/teamRoles';
import { MANUAL_ONLY, PLATFORM_LABEL, platformsFor, type PublishPlatform } from '@/lib/publishing/config';
import { manualArtifact } from '@/lib/jobs/output';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import Modal from '@/components/ui/Modal';
import { LiveExchange } from '../CompanyTeamPanel';
import MarketingPlanEditor from './MarketingPlanEditor';
import CasinoDiscoveryPanel from './CasinoDiscoveryPanel';
import ReadyPostCard from './publishing/ReadyPostCard';
import RotationEditor from './publishing/RotationEditor';
import PublishingImagePicker from './publishing/PublishingImagePicker';
import PublishingJobBody, { loadPeople } from './publishing/PublishingJobBody';
import { NotifyPicker } from './publishing/Pickers';
import { Approve, DesignSummary, OpportunityTracker, Questions, Results, RunBlock, SeoBriefEditor, csv, jobIsBusy, post, scheduleLabel, usd, type JobRunView, type JobView } from './JobCard';
import { jobLine, memberName, memberOf, modeLine, queueFor, type QueueItem } from './workQueue';

/**
 * The Work window: what needs you first, as one list across every job, then each company's team members
 * and the jobs they own. A job opens to three tabs: what is waiting (one at a time), its settings (each
 * saved as you change it), and how it went (history, then the deeper detail one click further).
 */

const MEMBER_TONE: Partial<Record<TeamRole, string>> = {
    marketing: 'bg-sky-500/15 text-sky-300',
    engineering: 'bg-emerald-500/15 text-emerald-300',
    design: 'bg-violet-500/15 text-violet-300',
    creative: 'bg-amber-500/15 text-amber-300',
    support: 'bg-rose-500/15 text-rose-300',
    operations: 'bg-slate-500/20 text-slate-300',
};

function Member({ role }: { role: TeamRole | null }) {
    const label = role ? memberName(role) : 'Nucleas';
    return <span aria-hidden="true" title={label} className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${role ? MEMBER_TONE[role] ?? 'bg-background-elevated' : 'bg-background-elevated text-text-secondary'}`}>{label.slice(0, 2)}</span>;
}

function Pill({ tone, children }: { tone: 'wait' | 'on' | 'off' | 'busy' | 'bad'; children: React.ReactNode }) {
    const cls = { wait: 'border-amber-400/40 text-amber-300', on: 'border-emerald-400/40 text-emerald-300', off: 'border-border text-text-secondary', busy: 'border-sky-400/40 text-sky-300', bad: 'border-red-400/40 text-red-300' }[tone];
    return <span className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] ${cls}`}>{children}</span>;
}

function statePill(job: JobView) {
    if (jobIsBusy(job) || job.status === 'testing') return <Pill tone="busy">Working</Pill>;
    if (job.status === 'active' || job.status === 'ready') return <Pill tone="on">On</Pill>;
    if (job.status === 'paused') return <Pill tone="off">Paused</Pill>;
    if (job.status === 'failed') return <Pill tone="bad">Failed</Pill>;
    if (job.status === 'done') return <Pill tone="off">Done</Pill>;
    return null;
}

/** Activity that is not a job (code changes, inboxes, articles) still belongs to someone: code to Engineering. */
function activityMember(item: ActivityItem): TeamRole | null {
    return item.kind === 'build' ? 'engineering' : null;
}

/** Choices made by clicking, kept until the person changes them; otherwise sections open when they hold something waiting. */
function useOpen() {
    const [open, setOpen] = useState<Record<string, boolean>>({});
    return {
        is: (key: string, byDefault: boolean) => open[key] ?? byDefault,
        set: (key: string, value: boolean) => setOpen((current) => ({ ...current, [key]: value })),
    };
}

// ---------- One job, opened ----------

type Tab = 'todo' | 'settings' | 'history';

function Segmented<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (value: T) => void; disabled?: boolean; label: string }) {
    return (
        <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded border border-border text-xs">
            {options.map((option) => (
                <button key={option.value} type="button" role="radio" aria-checked={value === option.value} title={option.title} disabled={disabled} onClick={() => value !== option.value && onChange(option.value)}
                    className={`px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-50 ${value === option.value ? 'bg-primary text-white' : 'hover:bg-background-card'}`}>
                    {option.label}
                </button>
            ))}
        </div>
    );
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border py-2.5 last:border-b-0">
            <div className="min-w-[160px] flex-1"><p className="text-sm">{label}</p>{hint ? <p className="text-[11px] text-text-secondary">{hint}</p> : null}</div>
            <div className="flex flex-wrap items-center gap-2">{children}</div>
        </div>
    );
}

/** Waiting posts, one at a time: the one asked for first, then Next and Previous. */
function DeliveryStepper({ job, focusId, onChange }: { job: JobView; focusId?: string; onChange: (job: JobView) => void }) {
    const ready = (job.publishing?.ready ?? []).filter((d) => d.status === 'ready' || d.status === 'publishing');
    const focusAt = focusId ? ready.findIndex((d) => d.id === focusId) : -1;
    // Remounted (by key) when a different waiting post is asked for, so it starts there.
    const [index, setIndex] = useState(Math.max(0, focusAt));
    if (!ready.length) return null;
    const at = Math.min(index, ready.length - 1);
    const delivery = ready[at];
    return (
        <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-text-secondary">
                <span className="min-w-0 flex-1 truncate">{ready.length > 1 ? `${at + 1} of ${ready.length} · ` : ''}{delivery.itemTitle}</span>
                {ready.length > 1 ? <>
                    <button type="button" className="ui-button" disabled={at === 0} onClick={() => setIndex(at - 1)} aria-label="Previous waiting post">Previous</button>
                    <button type="button" className="ui-button" disabled={at === ready.length - 1} onClick={() => setIndex(at + 1)} aria-label="Next waiting post">Next</button>
                </> : null}
            </div>
            <ReadyPostCard key={delivery.id} jobId={job.id} delivery={delivery} subreddit={job.companySubreddit ?? null} formUrl={job.publishing?.admin?.formUrl ?? null} onChange={onChange} />
        </section>
    );
}

function TodoTab({ job, focus, onChange, onViewRun }: { job: JobView; focus?: QueueItem['target']; onChange: (job: JobView) => void; onViewRun: (run: JobRunView) => void }) {
    const d = job.design;
    const publishing = d?.skill === 'social_publish';
    const reviewRun = job.runs.find((r) => r.status === 'needs_review' || r.status === 'running') ?? (job.runs[0]?.status === 'failed' ? job.runs[0] : undefined);
    const refresh = () => { void fetch(`/api/os/jobs/${job.id}`, { cache: 'no-store' }).then((r) => r.json()).then((body: { job?: JobView }) => { if (body.job) onChange(body.job); }); };
    // A publishing job being set up keeps its own step-by-step flow: approve, trial posts, switch on.
    if (publishing && ['proposed', 'testing', 'designing'].includes(job.status)) return <PublishingJobBody job={job} onChange={onChange} />;
    const waiting = queueFor(job).length;
    return (
        <div className="space-y-4">
            {job.status === 'designing' ? <p className="text-sm text-sky-400">{memberName(memberOf(job))} is looking into {job.companyName} and preparing a plan…</p> : null}
            {job.status === 'needs_answers' ? <Questions job={job} onChange={onChange} /> : null}
            {job.status === 'proposed' && d ? <><DesignSummary job={job} />{job.canManage ? <Approve job={job} onChange={onChange} /> : <p className="text-xs text-text-secondary">A manager or administrator approves new jobs.</p>}</> : null}
            {publishing ? <DeliveryStepper key={focus?.kind === 'delivery' ? focus.id : 'first'} job={job} focusId={focus?.kind === 'delivery' ? focus.id : undefined} onChange={onChange} /> : null}
            {!publishing && reviewRun ? <RunBlock job={job} run={reviewRun} onChange={onChange} onView={onViewRun} /> : null}
            {d?.skill === 'link_building' ? <OpportunityTracker job={job} onChange={onChange} /> : null}
            {d?.skill === 'signature_outreach' ? <DeliveryStepper key={focus?.kind === 'delivery' ? focus.id : 'first'} job={job} focusId={focus?.kind === 'delivery' ? focus.id : undefined} onChange={() => refresh()} /> : null}
            {d?.skill === 'casino_discovery' ? <CasinoDiscoveryPanel job={job} onChange={refresh} /> : null}
            {d?.skill === 'seo_brief' ? <SeoBriefEditor job={job} /> : null}
            {d?.skill === 'marketing_plan' ? <MarketingPlanEditor companyId={job.companyId} updatedAt={job.updatedAt} /> : null}
            {!waiting && !reviewRun && !['designing', 'needs_answers', 'proposed'].includes(job.status) ? (
                <p className="text-sm text-text-secondary">Nothing is waiting for you.{job.status === 'active' && job.nextRunAt ? ` Next run ${new Date(job.nextRunAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''}</p>
            ) : null}
        </div>
    );
}

function SettingsTab({ job, onChange }: { job: JobView; onChange: (job: JobView) => void }) {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [name, setName] = useState(job.design?.title ?? '');
    const [people, setPeople] = useState<{ userId: string; name: string }[]>([]);
    const view = job.publishing;
    useEffect(() => {
        if (!view) return;
        let cancelled = false;
        void loadPeople().then((list) => !cancelled && setPeople(list));
        return () => { cancelled = true; };
    }, [view]);
    const save = async (label: string, body: Record<string, unknown>) => {
        setBusy(label);
        setError(null);
        const res = await post(job.id, body).catch(() => ({ error: 'Could not save this change. Check your connection and try again.', job: undefined }));
        setBusy(null);
        if (res.error || !res.job) return setError(res.error ?? 'Could not save this change.');
        onChange(res.job);
        window.dispatchEvent(new Event('nucleas:jobs-changed'));
    };
    const assign = async (role: TeamRole) => {
        setBusy('owner');
        setError(null);
        const res = await fetch(`/api/os/companies/${job.companyId}/team`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'assign', role, jobId: job.id }) }).catch(() => null);
        setBusy(null);
        if (!res?.ok) return setError('Could not change the owner.');
        const fresh = (await fetch(`/api/os/jobs/${job.id}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}))) as { job?: JobView };
        if (fresh.job) onChange(fresh.job);
        window.dispatchEvent(new Event('nucleas:jobs-changed'));
    };
    const d = job.design;
    const can = job.canManage;
    const switchable = ['ready', 'active', 'paused'].includes(job.status);
    const channelMode = (platform: PublishPlatform): 'auto' | 'manual' | 'off' => view?.channels.find((c) => c.platform === platform)?.mode ?? 'off';
    const setChannel = (platform: PublishPlatform, mode: 'auto' | 'manual' | 'off') => {
        if (!view) return;
        const next = platformsFor(view).flatMap((p) => {
            const current = p === platform ? mode : channelMode(p);
            return current === 'off' ? [] : [{ platform: p, mode: current }];
        });
        if (!next.length) return setError('Keep at least one place to post. Pause the job to stop it instead.');
        void save(`channel:${platform}`, { action: 'publishing_settings', settings: { channels: next } });
    };
    return (
        <div className="space-y-3">
            <div className="rounded-lg border border-border px-3">
                {switchable ? (
                    <SettingRow label="This job" hint={job.status === 'paused' ? 'Paused: nothing runs until you switch it on.' : d && d.schedule.kind !== 'once' ? `Runs ${scheduleLabel(d.schedule).toLowerCase()}.` : undefined}>
                        <Segmented label="Job on or paused" value={job.status === 'paused' ? 'paused' : 'on'} disabled={!can || busy !== null} options={[{ value: 'on', label: 'On' }, { value: 'paused', label: 'Paused' }]} onChange={(v) => void save('state', { action: v === 'paused' ? 'pause' : 'resume' })} />
                    </SettingRow>
                ) : null}
                {view ? platformsFor(view).map((platform) => {
                    const manualOnly = MANUAL_ONLY.includes(platform);
                    const note = view.notes[platform];
                    return (
                        <SettingRow key={platform} label={platform === 'admin' ? 'Adding to the admin' : PLATFORM_LABEL[platform]} hint={note ?? (manualOnly ? 'No posting API: it always waits for you to post it.' : undefined)}>
                            <Segmented label={`${PLATFORM_LABEL[platform]} posting`} value={channelMode(platform)} disabled={!can || busy !== null}
                                options={[
                                    ...(manualOnly ? [] : [{ value: 'auto' as const, label: platform === 'admin' ? 'Add automatically' : 'Post automatically' }]),
                                    { value: 'manual' as const, label: 'Ask me first' },
                                    ...(platform === 'admin' ? [] : [{ value: 'off' as const, label: 'Off' }]),
                                ]}
                                onChange={(mode) => setChannel(platform, mode)} />
                        </SettingRow>
                    );
                }) : null}
                {!view && d && !manualArtifact(d.skill) && d.skill !== 'signature_outreach' && switchable ? (
                    <SettingRow label="When a run finishes" hint="Applies to later runs. Runs that fail a check always wait for you.">
                        <Segmented label="How results finish" value={job.completion ?? 'review'} disabled={!can || busy !== null} options={[{ value: 'review', label: 'Wait for my review' }, { value: 'automatic', label: 'Count it automatically' }]} onChange={(v) => void save('completion', { action: 'completion', completion: v })} />
                    </SettingRow>
                ) : null}
                <SettingRow label="Owner" hint={TEAM[memberOf(job)]?.remit}>
                    <select className="ui-control h-8 text-xs" aria-label="Team member who owns this job" value={memberOf(job)} disabled={!can || busy !== null} onChange={(e) => void assign(e.target.value as TeamRole)}>
                        {TEAM_ROLES.filter((r) => TEAM[r].active).map((r) => <option key={r} value={r}>{TEAM[r].name}</option>)}
                    </select>
                </SettingRow>
                {view ? (
                    <SettingRow label="Tell me when something is waiting" hint="An email when a post or record needs a person.">
                        <NotifyPicker people={people.length ? people : view.notifyUserIds.map((userId) => ({ userId, name: '…' }))} value={view.notifyUserIds} disabled={!can || busy !== null} onChange={(next) => void save('notify', { action: 'publishing_settings', settings: { notifyUserIds: next } })} />
                    </SettingRow>
                ) : null}
                {d ? (
                    <SettingRow label="Name">
                        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim() !== d.title) void save('rename', { action: 'rename', title: name }); }}>
                            <input className="ui-control h-8 w-56 text-xs" value={name} maxLength={120} disabled={!can} aria-label="Job name" onChange={(e) => setName(e.target.value)} />
                            {name.trim() !== d.title ? <button type="submit" className="ui-button" disabled={busy !== null}>Save</button> : null}
                        </form>
                    </SettingRow>
                ) : null}
            </div>
            {view?.source.type === 'site' && view.source.rotation ? <RotationEditor jobId={job.id} canManage={can} /> : null}
            {view && !view.admin && can ? (
                <details className="rounded-lg border border-border p-3 text-sm">
                    <summary className="cursor-pointer">Image used when a post has none</summary>
                    <div className="mt-2"><PublishingImagePicker companyId={job.companyId} image={view.image ?? null} onBusy={() => {}} onChange={(image) => void save('image', { action: 'publishing_settings', settings: { imageId: image?.id ?? null } })} /></div>
                </details>
            ) : null}
            {busy ? <p className="text-xs text-text-secondary" role="status">Saving…</p> : null}
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            {can && !job.runs.some((r) => r.status === 'running') ? (
                <button type="button" className="text-xs text-text-secondary underline hover:text-red-300" disabled={busy !== null} onClick={() => window.confirm('Archive this job? It stops running and leaves this list. Its history is kept.') && void save('archive', { action: 'archive' })}>Archive this job</button>
            ) : null}
        </div>
    );
}

function HistoryTab({ job, onViewRun }: { job: JobView; onViewRun: (run: JobRunView) => void }) {
    const d = job.design;
    const runs = job.runs.filter((r) => r.status !== 'running');
    const done = job.runs.filter((r) => r.status === 'completed');
    const recent = job.publishing?.recent ?? [];
    const live = job.runs.some((r) => r.status === 'running');
    return (
        <div className="space-y-3 text-sm">
            <p className="text-xs text-text-secondary">
                {[job.lastRunAt ? `Last run ${new Date(job.lastRunAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not run yet',
                    job.status === 'active' && job.nextRunAt ? `next ${new Date(job.nextRunAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : null,
                    job.publishing?.postedThisWeek ? `${job.publishing.postedThisWeek} posted this week` : null,
                    `${usd(job.spentThisMonthMicros)} spent this month`].filter(Boolean).join(' · ')}
            </p>
            {recent.length ? (
                <ul className="divide-y divide-border rounded-lg border border-border">
                    {recent.map((d2) => (
                        <li key={d2.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                            <span className="w-16 shrink-0 text-text-secondary">{PLATFORM_LABEL[d2.platform]}</span>
                            <span className="min-w-0 flex-1 truncate">{d2.itemTitle}</span>
                            {d2.status === 'posted' ? (d2.postedUrl ? <a href={d2.postedUrl} target="_blank" rel="noreferrer" className="text-primary underline">View ↗</a> : <Pill tone="on">{d2.platform === 'admin' ? 'Added' : 'Posted'}</Pill>) : <Pill tone={d2.status === 'failed' ? 'bad' : 'off'}>{d2.status === 'skipped' ? 'Skipped' : 'Failed'}</Pill>}
                        </li>
                    ))}
                </ul>
            ) : null}
            {runs.length ? (
                <ul className="divide-y divide-border rounded-lg border border-border">
                    {runs.slice(0, 8).map((run) => (
                        <li key={run.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                            <span className="w-28 shrink-0 text-text-secondary">{new Date(run.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                            <span className="min-w-0 flex-1 truncate">{run.dryRun ? 'Trial run · ' : ''}{run.error ?? run.output?.summary ?? `${run.output?.records.length ?? 0} results`}</span>
                            <Pill tone={run.status === 'failed' ? 'bad' : run.status === 'needs_review' ? 'wait' : run.status === 'rejected' ? 'off' : 'on'}>{run.status === 'needs_review' ? 'Waiting' : run.status === 'completed' ? 'Done' : run.status === 'rejected' ? 'Rejected' : 'Failed'}</Pill>
                            <button type="button" className="text-primary underline" onClick={() => onViewRun(run)}>Details</button>
                        </li>
                    ))}
                </ul>
            ) : <p className="text-xs text-text-secondary">No runs yet.</p>}
            <div className="divide-y divide-border rounded-lg border border-border">
                {job.teamLog?.length || live ? <details className="p-3" open={live}><summary className="cursor-pointer">How {memberName(memberOf(job))} worked on it</summary><div className="mt-2"><LiveExchange log={job.teamLog ?? []} live={live} /></div></details> : null}
                {d ? <details className="p-3"><summary className="cursor-pointer">The plan this job follows</summary><div className="mt-2"><DesignSummary job={job} /></div></details> : null}
                <details className="p-3"><summary className="cursor-pointer">What was asked for</summary><p className="mt-2 whitespace-pre-wrap text-text-secondary">{job.request}</p></details>
                {done.length && d ? <div className="p-3"><a className="ui-button" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv(d.fields, done))}`} download={`${d.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`}>Download results as CSV</a></div> : null}
            </div>
        </div>
    );
}

function JobPanel({ job, focus, onChange }: { job: JobView; focus?: QueueItem['target']; onChange: (job: JobView) => void }) {
    const waiting = queueFor(job).length;
    const [tab, setTab] = useState<Tab>('todo');
    const [viewRun, setViewRun] = useState<JobRunView | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const runNow = async () => {
        setBusy(true);
        setError(null);
        const res = await post(job.id, { action: 'run_now' });
        setBusy(false);
        if (res.error || !res.job) return setError(res.error ?? 'Could not start a run.');
        onChange(res.job);
    };
    const canRun = job.canManage && ['ready', 'active'].includes(job.status) && job.deliveryRunnable && !jobIsBusy(job);
    const tabs: { id: Tab; label: string }[] = [{ id: 'todo', label: waiting ? `To do · ${waiting}` : 'To do' }, { id: 'settings', label: 'Settings' }, { id: 'history', label: 'History' }];
    return (
        <div className="space-y-3 pb-3 pl-9 pr-3">
            <div className="flex flex-wrap items-center border-b border-border" role="tablist" aria-label={`${job.design?.title ?? 'Job'} sections`}>
                {tabs.map((t) => (
                    <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`-mb-px border-b-2 px-3 py-2 text-xs ${tab === t.id ? 'border-text-primary text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>{t.label}</button>
                ))}
                <span className="flex-1" />
                {canRun ? <button type="button" className="ui-button my-1" disabled={busy} onClick={() => void runNow()}>{busy ? 'Starting…' : job.publishing ? 'Check now' : 'Run now'}</button> : null}
            </div>
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            {tab === 'todo' ? <TodoTab job={job} focus={focus} onChange={onChange} onViewRun={setViewRun} /> : null}
            {tab === 'settings' ? <SettingsTab key={job.design?.title ?? ''} job={job} onChange={onChange} /> : null}
            {tab === 'history' ? <HistoryTab job={job} onViewRun={setViewRun} /> : null}
            <Modal isOpen={Boolean(viewRun)} onClose={() => setViewRun(null)} title={`${job.design?.title ?? 'Job'} · run details`} maxWidth="5xl" appearance="theme">
                {viewRun ? <Results job={job} run={viewRun} /> : null}
            </Modal>
        </div>
    );
}

// ---------- The board ----------

interface Company { id: string; name: string; jobs: JobView[]; activity: ActivityItem[] }

export default function WorkBoard({ jobs, activity, names, selected, createdId, onChange }: {
    jobs: JobView[];
    /** Work outside jobs that needs a person or failed (code changes, inboxes). */
    activity: ActivityItem[];
    names: Map<string, string>;
    selected: string;
    createdId: string | null;
    onChange: (job: JobView) => void;
}) {
    const wm = useWindowManager();
    const open = useOpen();
    const [focus, setFocus] = useState<{ jobId: string; target: QueueItem['target']; at: number } | null>(null);

    const queue = useMemo(() => jobs.flatMap((job) => queueFor(job).map((item) => ({ item, job }))).sort((a, b) => a.item.since.localeCompare(b.item.since)), [jobs]);
    const waitingActivity = activity.filter((item) => item.group === 'you' || item.group === 'failed');

    const companies = useMemo(() => {
        const map = new Map<string, Company>();
        const get = (id: string, fallback?: string | null) => {
            if (!map.has(id)) map.set(id, { id, name: names.get(id) || fallback || 'Organization', jobs: [], activity: [] });
            return map.get(id)!;
        };
        for (const job of jobs) get(job.companyId, job.companyName).jobs.push(job);
        for (const item of activity) get(item.companyId || 'organization', item.companyName).activity.push(item);
        if (selected !== 'all') get(selected);
        const waiting = (c: Company) => c.jobs.reduce((n, j) => n + queueFor(j).length, 0) + c.activity.filter((a) => a.group === 'you' || a.group === 'failed').length;
        return [...map.values()].map((c) => ({ ...c, waiting: waiting(c) })).sort((a, b) => Number(b.waiting > 0) - Number(a.waiting > 0) || a.name.localeCompare(b.name));
    }, [jobs, activity, names, selected]);

    const openItem = (job: JobView, item: QueueItem) => {
        open.set(`c:${job.companyId}`, true);
        open.set(`m:${job.companyId}:${memberOf(job)}`, true);
        open.set(`j:${job.id}`, true);
        setFocus((current) => ({ jobId: job.id, target: item.target, at: (current?.at ?? 0) + 1 }));
    };
    useEffect(() => {
        if (!focus) return;
        const el = document.getElementById(`work-job-${focus.jobId}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [focus]);

    return (
        <div className="space-y-4">
            {queue.length || waitingActivity.length ? (
                <section className="overflow-hidden rounded-lg border border-amber-400/30" aria-label="Needs you">
                    <h3 className="flex items-center gap-2 border-b border-border bg-amber-400/5 px-3 py-2 text-sm font-medium">
                        <span className="flex-1">Needs you</span>
                        <span className="text-[11px] font-normal text-text-secondary">Oldest first</span>
                        <Pill tone="wait">{queue.length + waitingActivity.length}</Pill>
                    </h3>
                    <ul className="divide-y divide-border">
                        {queue.map(({ item, job }) => (
                            <li key={item.key} className="flex items-center gap-3 px-3 py-2.5">
                                <Member role={memberOf(job)} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm">{item.label}</p>
                                    <p className="truncate text-[11px] text-text-secondary">{job.companyName} · {memberName(memberOf(job))} · {job.design?.title ?? job.request}</p>
                                </div>
                                <button type="button" className="ui-button" onClick={() => openItem(job, item)}>Open</button>
                            </li>
                        ))}
                        {waitingActivity.map((item) => (
                            <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                                <Member role={activityMember(item)} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm">{item.title}</p>
                                    <p className="truncate text-[11px] text-text-secondary">{item.companyName ? `${item.companyName} · ` : ''}{item.detail}</p>
                                </div>
                                <button type="button" className="ui-button" onClick={() => wm.open(item.open.window, item.open.payload ? { payload: item.open.payload } : undefined)}>Open</button>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : <p className="rounded-lg border border-border px-3 py-2.5 text-sm text-text-secondary">Nothing needs you right now.</p>}

            {companies.map((company) => {
                const companyKey = `c:${company.id}`;
                const companyOpen = open.is(companyKey, company.waiting > 0 || selected === company.id || company.jobs.some((j) => j.id === createdId));
                const members = new Map<TeamRole | 'other', { jobs: JobView[]; activity: ActivityItem[] }>();
                for (const job of company.jobs) {
                    const role = memberOf(job);
                    if (!members.has(role)) members.set(role, { jobs: [], activity: [] });
                    members.get(role)!.jobs.push(job);
                }
                for (const item of company.activity) {
                    const role = activityMember(item) ?? 'other';
                    if (!members.has(role)) members.set(role, { jobs: [], activity: [] });
                    members.get(role)!.activity.push(item);
                }
                const order = [...members.entries()].sort((a, b) => (a[0] === 'other' ? 1 : b[0] === 'other' ? -1 : TEAM_ROLES.indexOf(a[0]) - TEAM_ROLES.indexOf(b[0])));
                return (
                    <section key={company.id} className="overflow-hidden rounded-lg border border-border">
                        <button type="button" aria-expanded={companyOpen} onClick={() => open.set(companyKey, !companyOpen)} className="flex w-full items-center gap-3 bg-background-elevated/40 px-3 py-2.5 text-left hover:bg-background-elevated">
                            <span aria-hidden="true" className="w-3 text-text-secondary">{companyOpen ? '▾' : '▸'}</span>
                            <strong className="min-w-0 flex-1 truncate text-sm">{company.name}</strong>
                            <span className="text-[11px] text-text-secondary">{company.jobs.length} job{company.jobs.length === 1 ? '' : 's'}</span>
                            {company.waiting ? <Pill tone="wait">{company.waiting} need{company.waiting === 1 ? 's' : ''} you</Pill> : null}
                        </button>
                        {companyOpen ? (
                            <ul className="divide-y divide-border">
                                {order.map(([role, group]) => {
                                    const memberKey = `m:${company.id}:${role}`;
                                    const waiting = group.jobs.reduce((n, j) => n + queueFor(j).length, 0) + group.activity.filter((a) => a.group === 'you' || a.group === 'failed').length;
                                    const working = group.jobs.some((j) => jobIsBusy(j)) || group.activity.some((a) => a.group === 'working');
                                    const memberOpen = open.is(memberKey, waiting > 0 || group.jobs.some((j) => j.id === createdId));
                                    const title = role === 'other' ? 'Other work' : memberName(role);
                                    return (
                                        <li key={role}>
                                            <button type="button" aria-expanded={memberOpen} onClick={() => open.set(memberKey, !memberOpen)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-background-elevated/40">
                                                <span aria-hidden="true" className="w-3 text-text-secondary">{memberOpen ? '▾' : '▸'}</span>
                                                <Member role={role === 'other' ? null : role} />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm">{title}</span>
                                                    <span className="block truncate text-[11px] text-text-secondary">{role === 'other' ? 'Inboxes, articles and site crawls' : TEAM[role].remit}</span>
                                                </span>
                                                {working ? <Pill tone="busy">Working</Pill> : null}
                                                {waiting ? <Pill tone="wait">{waiting} need{waiting === 1 ? 's' : ''} you</Pill> : <span className="text-[11px] text-text-secondary">{group.jobs.length} job{group.jobs.length === 1 ? '' : 's'}</span>}
                                            </button>
                                            {memberOpen ? (
                                                <ul className="divide-y divide-border border-t border-border bg-background-elevated/10">
                                                    {group.jobs.map((job) => {
                                                        const jobKey = `j:${job.id}`;
                                                        const jobOpen = open.is(jobKey, job.id === createdId);
                                                        const count = queueFor(job).length;
                                                        const mode = modeLine(job);
                                                        return (
                                                            <li key={job.id} id={`work-job-${job.id}`} className="scroll-mt-2">
                                                                <button type="button" aria-expanded={jobOpen} onClick={() => open.set(jobKey, !jobOpen)} className="flex w-full items-center gap-2 py-2.5 pl-9 pr-3 text-left hover:bg-background-elevated/40">
                                                                    <span aria-hidden="true" className="w-3 text-text-secondary">{jobOpen ? '▾' : '▸'}</span>
                                                                    <span className="min-w-0 flex-1">
                                                                        <span className="block truncate text-sm">{job.design?.title ?? job.request}</span>
                                                                        <span className="block truncate text-[11px] text-text-secondary">{jobLine(job, scheduleLabel(job.design?.schedule))}{mode ? ` · ${mode}` : ''}</span>
                                                                    </span>
                                                                    {count ? <Pill tone="wait">{count} waiting</Pill> : null}
                                                                    {statePill(job)}
                                                                </button>
                                                                {jobOpen ? <JobPanel key={focus?.jobId === job.id ? focus.at : 0} job={job} focus={focus?.jobId === job.id ? focus.target : undefined} onChange={onChange} /> : null}
                                                            </li>
                                                        );
                                                    })}
                                                    {group.activity.map((item) => (
                                                        <li key={item.id}>
                                                            <button type="button" onClick={() => wm.open(item.open.window, item.open.payload ? { payload: item.open.payload } : undefined)} className="flex w-full items-center gap-2 py-2.5 pl-9 pr-3 text-left hover:bg-background-elevated/40">
                                                                <span aria-hidden="true" className="w-3" />
                                                                <span className="min-w-0 flex-1">
                                                                    <span className="block truncate text-sm">{item.title}</span>
                                                                    <span className="block truncate text-[11px] text-text-secondary">{item.detail}</span>
                                                                </span>
                                                                <Pill tone={item.group === 'you' ? 'wait' : item.group === 'failed' ? 'bad' : item.group === 'working' ? 'busy' : 'on'}>{item.status}</Pill>
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : null}
                                        </li>
                                    );
                                })}
                                {!order.length ? <li className="px-3 py-2.5 text-sm text-text-secondary">No jobs yet.</li> : null}
                            </ul>
                        ) : null}
                    </section>
                );
            })}
        </div>
    );
}
