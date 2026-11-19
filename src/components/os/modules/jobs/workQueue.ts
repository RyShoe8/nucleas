import { PLATFORM_LABEL } from '@/lib/publishing/config';
import { TEAM, teamRoleFor, type TeamRole } from '@/lib/companies/teamRoles';
import type { JobView } from './JobCard';
import { linkNeedsAction } from './linkAttention';

/** One thing a person has to do for a job, in plain words, with when it started waiting. */
export interface QueueItem {
    key: string;
    jobId: string;
    label: string;
    since: string;
    /** Which part of the job's To do list it opens to. */
    target: { kind: 'delivery' | 'run' | 'opportunity' | 'plan'; id?: string };
}

const quoted = (title: string) => (title ? `“${title.length > 60 ? `${title.slice(0, 57)}…` : title}”` : 'a new item');

/** Everything waiting on a person for this job, oldest first. Nothing here means the job needs nothing from you. */
export function queueFor(job: JobView): QueueItem[] {
    const items: QueueItem[] = [];
    const add = (key: string, label: string, since: string, target: QueueItem['target']) => items.push({ key: `${job.id}:${key}`, jobId: job.id, label, since, target });
    if (job.status === 'needs_answers') {
        const count = job.design?.questions.length ?? 0;
        add('answers', count ? `Answer ${count} question${count === 1 ? '' : 's'} so the plan can be finished` : 'Answer the open questions', job.updatedAt, { kind: 'plan' });
    }
    if (job.status === 'proposed') {
        const failed = job.runs.find((run) => run.dryRun && run.status === 'failed');
        add('plan', failed ? 'The trial run failed: retry it or reject the plan' : 'Approve the plan, or reject it', job.updatedAt, { kind: 'plan' });
    }
    for (const run of job.runs) {
        if (run.status !== 'needs_review') continue;
        add(`run:${run.id}`, run.dryRun ? 'Check the trial run before it is switched on' : 'Review a finished result', run.finishedAt ?? run.startedAt, { kind: 'run', id: run.id });
    }
    const latest = job.runs[0];
    if (latest?.status === 'failed' && !latest.dryRun && ['ready', 'active'].includes(job.status)) {
        add(`failed:${latest.id}`, 'The last run failed: see why', latest.finishedAt ?? latest.startedAt, { kind: 'run', id: latest.id });
    }
    for (const delivery of job.publishing?.ready ?? []) {
        if (delivery.status !== 'ready') continue;
        const title = quoted(delivery.itemTitle);
        const following = delivery.following?.map((f) => PLATFORM_LABEL[f.platform]) ?? [];
        const label = delivery.platform === 'admin'
            ? `Check ${title} before it is added`
            : delivery.platform === 'reddit'
                ? `Post ${title} to Reddit${following.length ? `, then ${following.join(' and ')} follow` : ''}`
                : delivery.error ? `Post ${title} to ${PLATFORM_LABEL[delivery.platform]}: posting it automatically failed` : `Post ${title} to ${PLATFORM_LABEL[delivery.platform]}`;
        add(`delivery:${delivery.id}`, label, delivery.createdAt, { kind: 'delivery', id: delivery.id });
    }
    for (const opportunity of job.opportunities) {
        if (!linkNeedsAction(opportunity.status)) continue;
        const what = String(opportunity.values.opportunity_type ?? '').trim();
        const label = opportunity.status === 'recommended' ? `Approve or skip a link opportunity${what ? `: ${what}` : ''}`
            : opportunity.status === 'approved' ? 'Submit an approved link, then mark it submitted'
                : 'Update a link opportunity';
        add(`link:${opportunity.id}`, label, opportunity.updatedAt, { kind: 'opportunity', id: opportunity.id });
    }
    return items.sort((a, b) => a.since.localeCompare(b.since));
}

/** The team member who owns this job. */
export function memberOf(job: JobView): TeamRole {
    return job.teamRole ?? teamRoleFor(job);
}

export function memberName(role: TeamRole): string {
    return TEAM[role]?.name ?? role;
}

/** The job's state in a few words, for its row: what it does next, not what it is. */
export function jobLine(job: JobView, schedule: string): string {
    const running = job.runs.find((run) => run.status === 'running');
    if (running) return `Working now · ${running.progressState.label}`;
    if (job.status === 'designing') return 'Preparing a plan';
    if (job.status === 'needs_answers') return 'Waiting for your answers';
    if (job.status === 'proposed') return 'Waiting for your approval';
    if (job.status === 'testing') return 'Starting a trial run';
    if (job.status === 'paused') return `Paused · ${schedule}`;
    if (job.status === 'done') return 'Finished';
    if (job.status === 'failed') return job.error || 'Failed';
    const last = job.lastRunAt ? `last ${new Date(job.lastRunAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'not run yet';
    return `${schedule} · ${last}`;
}

/** How results reach the world, in a few words: what goes out on its own and what waits for you. */
export function modeLine(job: JobView): string | null {
    const view = job.publishing;
    if (view) {
        const auto = view.channels.filter((c) => c.mode === 'auto').map((c) => PLATFORM_LABEL[c.platform]);
        const manual = view.channels.filter((c) => c.mode === 'manual').map((c) => PLATFORM_LABEL[c.platform]);
        return [auto.length ? `${auto.join(', ')} automatic` : '', manual.length ? `${manual.join(', ')} waits for you` : ''].filter(Boolean).join(' · ') || null;
    }
    if (job.completion === 'automatic') return 'Results count automatically when every check passes';
    if (job.completion === 'review') return 'You review each result';
    return null;
}
