'use client';

import PublishingImagePicker, { type SocialImage } from './PublishingImagePicker';
import { charCount } from '@/lib/publishing/compose';
import { useEffect, useMemo, useState } from 'react';
import { MANUAL_ONLY, PLATFORM_LABEL, platformsFor, sourceLabel, type PublishPlatform } from '@/lib/publishing/config';
import type { JobRunView, JobView } from '../JobCard';
import ReadyPostCard from './ReadyPostCard';
import RotationEditor from './RotationEditor';
import { manualPostText } from '@/lib/publishing/compose';
import { ChannelPicker, NotifyPicker, type ChannelChoice } from './Pickers';

async function post(jobId: string, body: Record<string, unknown>): Promise<{ job?: JobView; error?: string }> {
    const res = await fetch(`/api/os/jobs/${jobId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { job?: JobView; error?: string };
    return res.ok ? data : { error: data.error ?? `Failed (${res.status})` };
}

let peopleCache: Promise<{ userId: string; name: string }[]> | null = null;
function loadPeople() {
    peopleCache ??= fetch('/api/os/people', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : { people: [] }))
        .then((body: { people?: { userId: string; name: string }[] }) => body.people ?? [])
        .catch(() => {
            peopleCache = null;
            return [];
        });
    return peopleCache;
}

const ago = (iso: string | null) => {
    if (!iso) return 'not yet';
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleDateString();
};

/** The sample posts from a dry run, shown the way they will read, with one decision. */
function SampleReview({ job, run, onChange }: { job: JobView; run: JobRunView; onChange: (j: JobView) => void }) {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const decide = async (action: 'accept_run' | 'reject_run') => {
        setBusy(action);
        setError(null);
        const res = await post(job.id, { action, runId: run.id });
        setBusy(null);
        window.dispatchEvent(new Event('nucleas:jobs-changed'));
        if (res.error || !res.job) return setError(res.error ?? 'Failed');
        onChange(res.job);
    };
    const [copied, setCopied] = useState<number | null>(null);
    const copySample = async (index: number, platform: string, body: string, link: string | null) => {
        try { await navigator.clipboard.writeText(manualPostText(platform, body, link)); setCopied(index); }
        catch { setError('Could not copy the post. Copy the text and game link below manually.'); }
    };
    const records = run.output?.records ?? [];
    return (
        <section className="space-y-2">
            <p className="text-xs text-text-secondary">{run.output?.summary}</p>
            {job.publishing?.source.type === 'site' && job.publishing.source.rotation ? <p className="text-xs text-text-secondary">This sample is only an example of the format, written before any changes to the list above. What posts is the list as it stands now: if you removed or moved an article, the sample may still show the old first one, and it will not be posted.</p> : null}
            {job.publishing?.admin ? <p className="rounded border border-amber-400/40 p-2 text-xs text-amber-300">Preview only — no admin record has been saved. Accepting starts monitoring future emails; use “Prepare admin card” on an existing email to add that item separately.</p> : null}
            {run.output?.gaps.length ? <p className="text-xs text-amber-300">{run.output.gaps.join(' ')}</p> : null}
            <div className={`grid gap-2 ${records.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                {records.map((r, i) => (
                    <article key={i} className="rounded border border-border p-3 text-sm">
                        <p className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide">
                            {String(r.values.platform ?? '')}
                            <span className="font-normal normal-case text-text-secondary">{String(r.values.mode ?? '')}</span>
                        </p>
                        {r.values.post_title && !r.values.screenshot ? <p className="font-semibold leading-snug">{String(r.values.post_title)}</p> : null}
                        <p className="whitespace-pre-wrap break-words leading-relaxed">{String(r.values.post_copy ?? '')}</p>
                        <p className="mt-1 text-xs text-text-secondary">{charCount(String(r.values.post_copy ?? ''))} characters{String(r.values.platform).toLowerCase() === 'bluesky' ? ' / 300' : ''}</p>
                        {typeof r.values.image_url === 'string' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.values.image_url} alt={job.publishing?.image?.alt ?? 'Social post image'} className="mt-2 max-h-64 w-full rounded object-contain" />
                        ) : null}
                        {typeof r.values.target_url === 'string' && !r.values.screenshot ? <a href={r.values.target_url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-primary underline">{r.values.target_url}</a> : null}
                        {!r.values.screenshot ? <button type="button" className="ui-button mt-2" onClick={() => void copySample(i, String(r.values.platform ?? ''), String(r.values.post_copy ?? ''), typeof r.values.target_url === 'string' ? r.values.target_url : null)}>{copied === i ? 'Copied' : 'Copy post with link'}</button> : null}
                        {typeof r.values.screenshot === 'string' ? (
                            // eslint-disable-next-line @next/next/no-img-element -- a screenshot taken by the browser worker
                            <img src={`data:image/jpeg;base64,${r.values.screenshot}`} alt="The admin form filled in, not saved" className="mt-2 max-h-[520px] w-full rounded border border-border object-contain object-top" />
                        ) : null}
                    </article>
                ))}
            </div>
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            {job.canManage ? (
                <div className="flex flex-wrap gap-2">
                    <button type="button" className="ui-button-primary" disabled={busy !== null} onClick={() => void decide('accept_run')}>{busy === 'accept_run' ? 'Switching on…' : 'Looks right — switch it on'}</button>
                    <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void decide('reject_run')}>Not right</button>
                </div>
            ) : null}
            <p className="text-[11px] text-text-secondary">{job.publishing?.source.type === 'site' && job.publishing.source.roundup ? 'Switching on schedules one roundup each week, using that week’s scheduled events.' : <>Switching on records what exists now; only {job.publishing?.source.noun ?? 'item'}s that appear later are {job.publishing?.admin ? 'added' : 'posted'}.</>}</p>
        </section>
    );
}

/** Platforms and notify list, editable in place by managers; saved only when changed. */
function Settings({ job, onChange }: { job: JobView; onChange: (j: JobView) => void }) {
    const view = job.publishing!;
    // The parent remounts this (by key) when the saved settings change, so local edits start from them.
    const initial = useMemo<ChannelChoice[]>(
        () =>
            platformsFor(view).map((platform) => {
                const current = view.channels.find((c) => c.platform === platform);
                const manualOnly = MANUAL_ONLY.includes(platform);
                return { platform, selected: Boolean(current), mode: manualOnly ? 'manual' : current?.mode ?? 'auto', canAuto: !manualOnly, note: view.notes[platform] ?? (manualOnly ? 'Reddit has no posting API: the team gets a ready-to-post card.' : null) };
            }),
        [view]
    );
    const [channels, setChannels] = useState(initial);
    const [image, setImage] = useState<SocialImage | null>(view.image ?? null);
    const [uploading, setUploading] = useState(false);
    const [minimumValue, setMinimumValue] = useState(view.minimumSocialValuePct?.toString() ?? '');
    const [notify, setNotify] = useState(view.notifyUserIds);
    const [people, setPeople] = useState<{ userId: string; name: string }[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        void loadPeople().then((list) => !cancelled && setPeople(list));
        return () => { cancelled = true; };
    }, []);
    const dirty = image?.id !== view.image?.id || minimumValue !== (view.minimumSocialValuePct?.toString() ?? '') || JSON.stringify(channels.map((c) => [c.platform, c.selected, c.mode])) !== JSON.stringify(initial.map((c) => [c.platform, c.selected, c.mode])) || [...notify].sort().join() !== [...view.notifyUserIds].sort().join();
    const save = async () => {
        setBusy(true);
        setError(null);
        const res = await post(job.id, { action: 'publishing_settings', settings: { imageId: image?.id ?? null, minimumSocialValuePct: minimumValue !== '' ? Number(minimumValue) : null, channels: channels.filter((c) => c.selected).map((c) => ({ platform: c.platform, mode: c.mode })), notifyUserIds: notify } });
        setBusy(false);
        if (res.error || !res.job) return setError(res.error ?? 'Failed');
        onChange(res.job);
    };
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            <section className="space-y-2">
                <h4 className="ui-kicker">{view.admin ? 'Adding' : 'Post to'}</h4>
                <ChannelPicker channels={channels} onChange={setChannels} disabled={!job.canManage} />
                {view.source.type === 'mailbox' && !view.admin ? <label className="block text-xs">Only social deals strictly over this value (%)<input type="number" min="0" max="1000" step="any" className="ui-control w-full" disabled={!job.canManage} value={minimumValue} onChange={(e) => setMinimumValue(e.target.value)} placeholder="No additional destination filter" /></label> : null}
            </section>
            <section className="space-y-2">
                <h4 className="ui-kicker">Notify</h4>
                <NotifyPicker people={people.length ? people : view.notifyUserIds.map((userId) => ({ userId, name: '…' }))} value={notify} onChange={setNotify} disabled={!job.canManage} />
            </section>
            {!view.admin && job.canManage ? <PublishingImagePicker companyId={job.companyId} image={image} onChange={setImage} onBusy={setUploading} /> : null}
            {dirty ? (
                <div className="flex items-center gap-2 sm:col-span-2">
                    <button type="button" className="ui-button-primary" disabled={busy || uploading || !channels.some((c) => c.selected)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
                    <button type="button" className="ui-button" onClick={() => { setChannels(initial); setNotify(view.notifyUserIds); setImage(view.image ?? null); }}>Undo</button>
                </div>
            ) : null}
            {error ? <p role="alert" className="text-xs text-red-400 sm:col-span-2">{error}</p> : null}
        </div>
    );
}

/**
 * A publishing job as people use it: what it watches, where posts go, what is waiting to be posted by
 * hand, and what went out. Runs, examples and history stay under Details.
 */
export default function PublishingJobBody({ job, onChange, readyShownAbove = false }: { job: JobView; onChange: (j: JobView) => void; readyShownAbove?: boolean }) {
    const view = job.publishing;
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    if (!view) return <p className="text-xs text-red-400">This job&rsquo;s publishing settings are missing.</p>;

    const act = async (action: string) => {
        setBusy(action);
        setError(null);
        try {
            const res = await post(job.id, { action, ...(action === 'approve' ? { completion: 'automatic' } : {}) });
            if (res.error || !res.job) return setError(res.error ?? 'Failed');
            onChange(res.job);
            window.dispatchEvent(new Event('nucleas:jobs-changed'));
        } catch (err) { setError(err instanceof Error ? err.message : 'The request failed. Please try again.'); }
        finally { setBusy(null); }
    };

    const running = job.runs.find((r) => r.status === 'running');
    const sample = job.runs.find((r) => r.dryRun && r.status === 'needs_review');
    const failedSample = job.status === 'proposed' ? job.runs.find((r) => r.dryRun && r.status === 'failed') : undefined;
    const on = ['ready', 'active', 'paused'].includes(job.status);
    const lastRun = job.runs.find((r) => !r.dryRun && r.status !== 'running');

    return (
        <div className="space-y-4">
            <p className="text-xs text-text-secondary">
                {sourceLabel(view.source)}
                {view.admin ? <> · adds to <a href={view.admin.formUrl} target="_blank" rel="noreferrer" className="underline">{new URL(view.admin.formUrl).host}{new URL(view.admin.formUrl).pathname}</a></> : null}
                {view.minimumSocialValuePct !== undefined ? ` · social value must be over ${view.minimumSocialValuePct}%` : ''}
                {on ? ` · last checked ${ago(job.lastRunAt)}` : ''}
                {on && view.source.type === 'site' && view.source.rotation && job.nextRunAt ? ` · next scheduled ${new Date(job.nextRunAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
                {on && view.postedThisWeek ? ` · ${view.postedThisWeek} social posts delivered this week` : ''}
            </p>

            {view.source.type === 'site' && view.source.rotation ? <RotationEditor jobId={job.id} canManage={job.canManage} /> : null}

            {view.adminFieldRules?.length ? <p className="text-xs text-text-secondary">
                {view.adminFieldRules.map((rule) => {
                    const label = view.admin?.fields.find((field) => field.label.toLowerCase().replace(/[^a-z0-9]+/g, '_') === rule.field)?.label ?? rule.field.replaceAll('_', ' ');
                    const value = typeof rule.value === 'boolean' ? (rule.value ? 'on' : 'off') : rule.value;
                    return `${label}: ${value}${rule.whenValueOverPct !== undefined ? ` only over ${rule.whenValueOverPct}% value; otherwise ${rule.otherwise === true ? 'on' : 'off'}` : ''}`;
                }).join(' · ')}
            </p> : null}

            {job.status === 'proposed' && !running && !sample ? (
                <section className="space-y-2">
                    <p className="text-xs text-text-secondary">{view.channels.map((c) => `${PLATFORM_LABEL[c.platform]}: ${c.mode === 'manual' ? 'manual review card' : 'automatic'}`).join(' · ')}</p>
                    {failedSample ? <p role="alert" className="text-xs text-red-400">{failedSample.error}</p> : null}
                    {job.canManage ? <div className="flex flex-wrap gap-2">
                        <button type="button" className="ui-button-primary" disabled={busy !== null} onClick={() => void act('approve')}>{busy === 'approve' ? 'Starting dry run…' : failedSample ? 'Retry dry run' : 'Approve and run a dry run'}</button>
                        <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void act('reject')}>Reject</button>
                    </div> : <p className="text-xs text-text-secondary">A manager or administrator must approve this job.</p>}
                    <p className="text-xs text-text-secondary">The dry run previews existing content without posting or saving anything externally. Review the sample before switching the job on. Manual destinations remain manual.</p>
                </section>
            ) : null}
            {running ? <p className="text-xs text-sky-400" role="status">{running.dryRun ? 'Writing sample posts' : 'Checking for new posts'}: {running.progressState.label}…</p> : null}
            {sample ? <SampleReview job={job} run={sample} onChange={onChange} /> : null}


            {view.redditDealNotice ? <p className="text-xs text-text-secondary">{view.redditDealNotice}</p> : null}
            {view.ready.length && readyShownAbove ? <p className="text-xs text-amber-300">{view.ready.length} {view.ready.length === 1 ? 'is' : 'are'} waiting for you at the top of this window.</p> : null}
            {view.ready.length && !readyShownAbove ? (
                <section className="space-y-2">
                    <h4 className="ui-kicker">Waiting for you · {view.ready.length}</h4>
                    {view.ready.map((d) => (
                        <ReadyPostCard key={d.id} jobId={job.id} delivery={d} subreddit={job.companySubreddit ?? null} formUrl={view.admin?.formUrl ?? null} onChange={onChange} />
                    ))}
                </section>
            ) : null}

            {on ? <Settings key={JSON.stringify([view.channels, view.notes, view.notifyUserIds, view.minimumSocialValuePct])} job={job} onChange={onChange} /> : null}

            {view.recent.length ? (
                <section className="space-y-1">
                    <h4 className="ui-kicker">Recent</h4>
                    <ul className="space-y-1 text-xs">
                        {view.recent.map((d) => (
                            <li key={d.id} className="flex items-center gap-2">
                                <span className="w-16 shrink-0 text-text-secondary">{PLATFORM_LABEL[d.platform as PublishPlatform]}</span>
                                <span className="min-w-0 flex-1 truncate">{d.itemTitle}</span>
                                {d.status === 'posted' ? (d.postedUrl ? <a href={d.postedUrl} target="_blank" rel="noreferrer" className="text-primary underline">View ↗</a> : <span className="text-emerald-400">{d.platform === 'admin' ? 'Added' : 'Posted'}</span>) : <span className="text-text-secondary">{d.status === 'skipped' ? 'Skipped' : 'Failed'}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
                {job.canManage && (job.status === 'ready' || job.status === 'active') ? <button type="button" className="ui-button" disabled={busy !== null || Boolean(running)} onClick={() => void act('run_now')}>{busy === 'run_now' ? 'Checking…' : 'Check now'}</button> : null}
                {job.canManage && (job.status === 'ready' || job.status === 'active') ? <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void act('pause')}>Pause</button> : null}
                {job.canManage && job.status === 'paused' ? <button type="button" className="ui-button-primary" disabled={busy !== null} onClick={() => void act('resume')}>Resume</button> : null}
                <span className="flex-1" />
                <details className="text-xs">
                    <summary className="cursor-pointer text-text-secondary">Details</summary>
                    <div className="mt-2 space-y-2 text-text-secondary">
                        <p>Asked for: {job.request}</p>
                        {Object.entries(view.examples).map(([platform, example]) => (
                            <p key={platform}>{PLATFORM_LABEL[platform as PublishPlatform]} example: {example?.url ? <a href={example.url} target="_blank" rel="noreferrer" className="underline">{example.url}</a> : `“${(example?.text ?? '').slice(0, 80)}…”`}</p>
                        ))}
                        {lastRun?.output ? <p>Last check: {lastRun.output.summary}{lastRun.output.gaps.length ? ` ${lastRun.output.gaps.join(' ')}` : ''}</p> : null}
                        {lastRun?.error ? <p className="text-red-400">Last check failed: {lastRun.error}</p> : null}
                        {job.canManage && !running ? <button type="button" className="ui-button" disabled={busy !== null} onClick={() => window.confirm('Archive this job? It stops checking and posting.') && void act('archive')}>Archive job</button> : null}
                    </div>
                </details>
            </div>
        </div>
    );
}
