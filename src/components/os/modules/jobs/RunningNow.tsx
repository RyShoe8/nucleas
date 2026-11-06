'use client';

import { useState } from 'react';
import type { ActivityItem } from '@/lib/activity/types-client';
import { ActivityRows } from './ActivityList';
import JobCard, { JobStatusBadge, jobIsBusy, jobListProgress, type JobView } from './JobCard';

const RECENT_LINES = 6;

/** A job doing work right now, including a dry run that has been started but not yet picked up. */
export function isRunningJob(job: JobView): boolean {
    return jobIsBusy(job) || job.status === 'testing';
}

/** What a running job has been doing, oldest first, without repeated lines. */
export function jobActivityLines(job: JobView): string[] {
    const lines = job.runs.find((run) => run.status === 'running')?.progress ?? [];
    return lines.filter((line, index) => line && line !== lines[index - 1]);
}

function RunningJob({ job, onChange }: { job: JobView; onChange: (job: JobView) => void }) {
    const [showAll, setShowAll] = useState(false);
    const [open, setOpen] = useState(false);
    const progress = jobListProgress(job);
    const lines = jobActivityLines(job);
    const shown = showAll ? lines : lines.slice(-RECENT_LINES);
    return (
        <li className="ui-card px-3 py-2.5">
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{job.design?.title ?? job.request}</p>
                    <p className="truncate text-[11px] text-text-secondary">{job.companyName}</p>
                </div>
                <JobStatusBadge status={job.status} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-text-secondary">
                <span className="min-w-0 truncate">{progress.label}</span>
                <span className="shrink-0 tabular-nums">{progress.percent}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background-elevated" role="progressbar" aria-label={`${job.design?.title ?? job.request} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
                <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${progress.percent}%` }} />
            </div>
            {shown.length ? (
                <ol className="mt-2 space-y-0.5 border-l border-border pl-2 text-[11px] text-text-secondary" aria-label={`${job.design?.title ?? job.request} activity`} aria-live="polite">
                    {shown.map((line, index) => (
                        <li key={`${index}-${line}`} className={`break-words ${index === shown.length - 1 ? 'text-text-primary' : ''}`}>{line}</li>
                    ))}
                </ol>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-text-secondary">
                {lines.length > RECENT_LINES ? (
                    <button type="button" className="underline" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show recent' : `Show all ${lines.length}`}</button>
                ) : null}
                <button type="button" className="underline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide job' : 'Open job'}</button>
            </div>
            {open ? <div className="mt-2"><JobCard job={job} onChange={onChange} headerShownAbove /></div> : null}
        </li>
    );
}

/** Everything Nucleas is doing now, pinned to the bottom of the Work window so it stays in view while the list scrolls. */
export default function RunningNow({ jobs, items, onChange }: { jobs: JobView[]; items: ActivityItem[]; onChange: (job: JobView) => void }) {
    const count = jobs.length + items.length;
    if (!count) return null;
    return (
        <section aria-label="Running now" className="sticky bottom-0 z-10 -mx-3 -mb-3 max-h-[50vh] overflow-y-auto border-t border-border bg-background-card px-3 py-2">
            <h3 className="ui-kicker mb-2">Running now · {count}</h3>
            <ul className="space-y-2">
                {jobs.map((job) => <RunningJob key={job.id} job={job} onChange={onChange} />)}
                {items.length ? <ActivityRows items={items} showCompany /> : null}
            </ul>
        </section>
    );
}
