'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';

// ---------- Types (mirror the server's JobView) ----------

export type JobStatus = 'designing' | 'needs_answers' | 'proposed' | 'testing' | 'ready' | 'active' | 'paused' | 'done' | 'rejected' | 'archived' | 'failed';

interface JobField {
    key: string;
    label: string;
    type: string;
    required: boolean;
    description: string;
}

interface JobQuestion {
    id: string;
    question: string;
    why: string;
    options: { id: string; label: string; detail: string }[];
    recommended?: string;
}

interface JobDesign {
    skill?: 'link_building' | 'seo_brief' | 'property_overview';
    title: string;
    category: string;
    instructions: string;
    fields: JobField[];
    sourcePolicy: string;
    delivery: { method: string; detail: string; setupSteps: string[] };
    schedule: { kind: 'once' | 'daily' | 'weekly' | 'monthly'; time?: string; timezone?: string; weekday?: number; dayOfMonth?: number };
    recordsPerRun: number;
    safeguards: string[];
    recommendedCompletion: 'review' | 'automatic';
    findings: string[];
    questions: JobQuestion[];
}

type LinkOpportunityStatus = 'recommended' | 'saved' | 'approved' | 'rejected' | 'submitted' | 'live' | 'submission_rejected' | 'removed' | 'expired';
interface LinkOpportunityView {
    id: string;
    runId: string;
    status: LinkOpportunityStatus;
    opportunityUrl: string;
    targetUrl: string | null;
    liveLinkUrl: string | null;
    values: Record<string, unknown>;
    sources: string[];
    note: string | null;
    submittedAt: string | null;
    lastVerifiedAt: string | null;
    nextVerificationAt: string | null;
    verificationMessage: string | null;
    updatedAt: string;
}

export interface JobRunView {
    id: string;
    dryRun: boolean;
    status: 'running' | 'needs_review' | 'completed' | 'rejected' | 'failed';
    attempt: number;
    startedAt: string;
    finishedAt: string | null;
    heartbeatAt: string | null;
    progress: string[];
    progressState: { stage: 'preparing' | 'researching' | 'validating' | 'reviewing' | 'saving' | 'complete'; label: string; percent: number; updatedAt: string };
    output: { records: { values: Record<string, unknown>; sources: string[] }[]; summary: string; gaps: string[] } | null;
    issues: { record: number; field?: string; problem: string }[];
    review: { verdict: 'pass' | 'fail'; notes: string; model: string } | null;
    costMicros: number;
    error: string | null;
}

export interface JobView {
    id: string;
    companyId: string;
    projectId: string | null;
    companyName: string;
    status: JobStatus;
    request: string;
    design: JobDesign | null;
    answers: Record<string, { option?: string; text?: string }>;
    completion: 'review' | 'automatic' | null;
    level: 'free' | 'low' | 'medium' | 'high' | null;
    monthlyBudgetMicros: number;
    spentThisMonthMicros: number;
    deliveryLabel: string | null;
    deliveryRunnable: boolean;
    createdAt: string;
    updatedAt: string;
    lastRunAt: string | null;
    nextRunAt: string | null;
    error: string | null;
    runs: JobRunView[];
    canManage: boolean;
    opportunities: LinkOpportunityView[];
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
    designing: 'Designing',
    needs_answers: 'Needs your answers',
    proposed: 'Awaiting approval',
    testing: 'Dry run',
    ready: 'Ready',
    active: 'Active',
    paused: 'Paused',
    done: 'Done',
    rejected: 'Rejected',
    archived: 'Archived',
    failed: 'Failed',
};

const STATUS_TONE: Partial<Record<JobStatus, string>> = {
    needs_answers: 'text-amber-400 border-amber-400/40',
    proposed: 'text-amber-400 border-amber-400/40',
    designing: 'text-sky-400 border-sky-400/40',
    testing: 'text-sky-400 border-sky-400/40',
    ready: 'text-emerald-400 border-emerald-400/40',
    active: 'text-emerald-400 border-emerald-400/40',
    done: 'text-emerald-400 border-emerald-400/40',
    failed: 'text-red-400 border-red-400/40',
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
    return <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${STATUS_TONE[status] ?? 'text-text-secondary border-border'}`}>{JOB_STATUS_LABEL[status]}</span>;
}

/** Whether the card should keep refreshing (something is being worked on). */
export function jobIsBusy(job: JobView): boolean {
    return job.status === 'designing' || job.runs.some((r) => r.status === 'running');
}

export interface JobListProgress {
    label: string;
    percent: number;
    tone: 'active' | 'waiting' | 'complete' | 'failed' | 'muted';
}

/** Compact, deterministic status for collapsed rows in the Jobs window. */
export function jobListProgress(job: JobView): JobListProgress {
    const running = job.runs.find((run) => run.status === 'running');
    if (running) return { label: running.progressState.label, percent: running.progressState.percent, tone: 'active' };

    const review = job.runs.find((run) => run.status === 'needs_review');
    if (review) return { label: review.progressState.label || 'Ready for review', percent: 100, tone: 'waiting' };

    if (job.status === 'designing') return { label: 'Designing job', percent: 10, tone: 'active' };
    if (job.status === 'needs_answers') return { label: 'Waiting for your answers', percent: 20, tone: 'waiting' };
    if (job.status === 'proposed') return { label: 'Waiting for approval', percent: 25, tone: 'waiting' };
    if (job.status === 'testing') return { label: 'Preparing dry run', percent: 5, tone: 'active' };
    if (job.status === 'ready') return { label: 'Ready to run', percent: 0, tone: 'complete' };
    if (job.status === 'active') return { label: job.nextRunAt ? `Next run ${new Date(job.nextRunAt).toLocaleString()}` : 'Waiting for next run', percent: 0, tone: 'complete' };
    if (job.status === 'paused') return { label: 'Paused', percent: 0, tone: 'muted' };
    if (job.status === 'done') return { label: 'Complete', percent: 100, tone: 'complete' };
    if (job.status === 'failed') return { label: job.error || job.runs[0]?.error || 'Failed', percent: 100, tone: 'failed' };
    if (job.status === 'rejected') return { label: 'Rejected', percent: 100, tone: 'muted' };
    return { label: 'Archived', percent: 100, tone: 'muted' };
}

export function scheduleLabel(s: JobDesign['schedule'] | undefined): string {
    if (!s || s.kind === 'once') return 'Once';
    const at = s.time ? ` at ${s.time}` : '';
    if (s.kind === 'daily') return `Every day${at}`;
    if (s.kind === 'weekly') return `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][s.weekday ?? 1]}${at}`;
    return `Monthly on day ${s.dayOfMonth ?? 1}${at}`;
}

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 100_000 ? 3 : 2)}`;
const BUTTON = 'ui-button';
const PRIMARY = 'ui-button-primary';

async function post(id: string, body: Record<string, unknown>): Promise<{ job?: JobView; error?: string }> {
    const res = await fetch(`/api/os/jobs/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { job?: JobView; error?: string };
    return res.ok ? data : { error: data.error ?? `Failed (${res.status})` };
}

function csv(fields: JobField[], runs: JobRunView[]): string {
    const esc = (v: unknown) => `"${String(Array.isArray(v) ? v.join('; ') : v ?? '').replace(/"/g, '""')}"`;
    const rows = runs.flatMap((r) => (r.output?.records ?? []).map((rec) => [...fields.map((f) => esc(rec.values[f.key])), esc(rec.sources.join(' '))].join(',')));
    return [[...fields.map((f) => esc(f.label)), esc('Sources')].join(','), ...rows].join('\n');
}

// ---------- Pieces ----------

function Questions({ job, onChange }: { job: JobView; onChange: (j: JobView) => void }) {
    const questions = job.design?.questions ?? [];
    const [answers, setAnswers] = useState<Record<string, { option?: string; text?: string }>>(() =>
        Object.fromEntries(questions.map((q) => [q.id, { option: q.recommended }]))
    );
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const submit = async () => {
        setBusy(true);
        setError(null);
        const res = await post(job.id, { action: 'answer', answers });
        setBusy(false);
        if (res.error || !res.job) return setError(res.error ?? 'Failed');
        onChange(res.job);
    };
    return (
        <div className="space-y-3">
            {questions.map((q) => (
                <fieldset key={q.id} className="space-y-1">
                    <legend className="text-sm font-medium">{q.question}</legend>
                    {q.why ? <p className="text-[11px] text-text-secondary">{q.why}</p> : null}
                    {q.options.map((o) => (
                        <label key={o.id} className="flex items-start gap-2 text-xs cursor-pointer">
                            <input
                                type="radio"
                                name={`${job.id}-${q.id}`}
                                checked={answers[q.id]?.option === o.id}
                                onChange={() => setAnswers((a) => ({ ...a, [q.id]: { ...a[q.id], option: o.id } }))}
                                className="mt-0.5"
                            />
                            <span>
                                {o.label}
                                {q.recommended === o.id ? <span className="ml-1 text-[10px] text-emerald-400">recommended</span> : null}
                                {o.detail ? <span className="block text-[11px] text-text-secondary">{o.detail}</span> : null}
                            </span>
                        </label>
                    ))}
                    <input
                        value={answers[q.id]?.text ?? ''}
                        onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: { ...a[q.id], text: e.target.value } }))}
                        placeholder={q.options.length ? 'Anything to add (optional)' : 'Your answer'}
                        className="h-7 w-full px-2 rounded border border-border bg-background-elevated text-xs"
                        aria-label={`Answer: ${q.question}`}
                    />
                </fieldset>
            ))}
            {error ? <p className="text-xs text-red-400">{error}</p> : null}
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => void submit()}>
                {busy ? 'Sending…' : 'Answer and finish the design'}
            </button>
        </div>
    );
}

function DesignSummary({ job }: { job: JobView }) {
    const d = job.design;
    if (!d) return null;
    return (
        <div className="space-y-2 text-xs">
            <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1">
                <dt className="text-text-secondary">Category</dt>
                <dd className="capitalize">{d.category}</dd>
                <dt className="text-text-secondary">Schedule</dt>
                <dd>
                    {scheduleLabel(d.schedule)} · {d.recordsPerRun} record{d.recordsPerRun === 1 ? '' : 's'} per run
                </dd>
                <dt className="text-text-secondary">Results go</dt>
                <dd>
                    {job.deliveryLabel}
                    {d.delivery.detail ? <span className="block text-text-secondary">{d.delivery.detail}</span> : null}
                </dd>
                <dt className="text-text-secondary">Collects</dt>
                <dd>{d.fields.map((f) => `${f.label}${f.required ? '*' : ''}`).join(', ')}</dd>
                <dt className="text-text-secondary">Sources</dt>
                <dd>{d.sourcePolicy}</dd>
            </dl>
            {d.delivery.setupSteps.length ? (
                <div className={`rounded border p-2 ${job.deliveryRunnable ? 'border-border' : 'border-amber-400/40'}`}>
                    <p className="font-medium">One-time setup{job.deliveryRunnable ? '' : ' (needed before real runs)'}</p>
                    <ol className="list-decimal pl-4">
                        {d.delivery.setupSteps.map((s, i) => (
                            <li key={i}>{s}</li>
                        ))}
                    </ol>
                </div>
            ) : null}
            {d.safeguards.length ? (
                <div>
                    <p className="font-medium">Safeguards</p>
                    <ul className="list-disc pl-4 text-text-secondary">
                        {d.safeguards.map((s, i) => (
                            <li key={i}>{s}</li>
                        ))}
                    </ul>
                </div>
            ) : null}
            {d.findings.length ? (
                <details>
                    <summary className="cursor-pointer text-text-secondary">What Nucleas found ({d.findings.length})</summary>
                    <ul className="list-disc pl-4 text-text-secondary">
                        {d.findings.map((s, i) => (
                            <li key={i}>{s}</li>
                        ))}
                    </ul>
                </details>
            ) : null}
            <details>
                <summary className="cursor-pointer text-text-secondary">Instructions each run follows</summary>
                <p className="whitespace-pre-wrap text-text-secondary">{d.instructions}</p>
            </details>
        </div>
    );
}

function Approve({ job, onChange }: { job: JobView; onChange: (j: JobView) => void }) {
    const [completion, setCompletion] = useState<'review' | 'automatic'>(job.design?.recommendedCompletion ?? 'review');
    const [budget, setBudget] = useState(String((job.monthlyBudgetMicros || 2_000_000) / 1_000_000));
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const act = async (body: Record<string, unknown>, label: string) => {
        setBusy(label);
        setError(null);
        const res = await post(job.id, body);
        setBusy(null);
        if (res.error || !res.job) return setError(res.error ?? 'Failed');
        onChange(res.job);
    };
    return (
        <div className="space-y-2 rounded border border-border p-2">
            <p className="text-xs font-medium">When a run finishes</p>
            {(['review', 'automatic'] as const).map((c) => (
                <label key={c} className="flex items-start gap-2 text-xs cursor-pointer">
                    <input type="radio" name={`${job.id}-completion`} checked={completion === c} onChange={() => setCompletion(c)} className="mt-0.5" />
                    <span>
                        {c === 'review' ? 'I review each result before it counts' : 'Complete automatically when every check passes'}
                        {job.design?.recommendedCompletion === c ? <span className="ml-1 text-[10px] text-emerald-400">recommended</span> : null}
                        <span className="block text-[11px] text-text-secondary">
                            {c === 'review' ? 'Every run waits for you.' : 'Runs that fail any check (missing fields, no sources, reviewer concerns) still wait for you.'}
                        </span>
                    </span>
                </label>
            ))}
            <label className="flex items-center gap-2 text-xs">
                Monthly budget $
                <input
                    type="number"
                    min="0.1"
                    step="0.5"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    className="h-6 w-20 px-1 rounded border border-border bg-background-elevated text-xs"
                    aria-label="Monthly budget in dollars"
                />
                <span className="text-text-secondary">the job pauses when it is reached</span>
            </label>
            {error ? <p className="text-xs text-red-400">{error}</p> : null}
            <div className="flex gap-2">
                <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void act({ action: 'approve', completion, monthlyBudgetUsd: Number(budget) }, 'approve')}>
                    {busy === 'approve' ? 'Starting…' : 'Approve and run a dry run'}
                </button>
                <button
                    type="button"
                    className={BUTTON}
                    disabled={busy !== null}
                    onClick={() => window.confirm('Reject this job?') && void act({ action: 'reject' }, 'reject')}
                >
                    Reject
                </button>
            </div>
            <p className="text-[11px] text-text-secondary">A dry run does the work once without delivering anything, so you can check a sample first.</p>
        </div>
    );
}

function Results({ job, run }: { job: JobView; run: JobRunView }) {
    const fields = job.design?.fields ?? [];
    const records = run.output?.records ?? [];
    return (
        <div className="space-y-5 text-sm">
            {run.output?.summary ? <section className="rounded-lg border border-border bg-background-elevated/40 p-4"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">Summary</h3><p className="whitespace-pre-wrap leading-6">{run.output.summary}</p></section> : null}
            {records.map((r, i) => (
                <article key={i} className="overflow-hidden rounded-lg border border-border">
                    <header className="border-b border-border bg-background-elevated px-4 py-3"><h3 className="text-base font-semibold">{records.length === 1 ? 'Opportunity details' : `Opportunity ${i + 1}`}</h3></header>
                    <dl className="divide-y divide-border">
                        {fields.map((f) => {
                                        const v = r.values[f.key];
                                        const text = Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v);
                                        const problem = run.issues.find((x) => x.record === i && x.field === f.key);
                                        return (
                                            <div key={f.key} className={`grid gap-1 px-4 py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-5 ${problem ? 'bg-amber-400/5' : ''}`} title={problem?.problem}>
                                                <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{f.label}</dt>
                                                <dd className={`min-w-0 text-sm leading-6 ${problem ? 'text-amber-300' : 'text-text-primary'}`}>
                                                {f.type === 'url' && text ? (
                                                    <a href={text} target="_blank" rel="noreferrer" className="text-primary underline break-all">
                                                        {text}
                                                    </a>
                                                ) : (
                                                    <span className="whitespace-pre-wrap break-words leading-relaxed">{text || '—'}</span>
                                                )}
                                                {problem ? <span className="mt-1 block text-xs">Check: {problem.problem}</span> : null}
                                                </dd>
                                            </div>
                                        );
                        })}
                        <div className="grid gap-2 bg-background-elevated/30 px-4 py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-5"><dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Sources</dt><dd><ul className="space-y-1.5">{r.sources.map((s, j) => <li key={j}><a href={s} target="_blank" rel="noreferrer" className="text-sm text-primary underline break-all">{s}</a></li>)}</ul></dd></div>
                    </dl>
                </article>
            ))}
            {run.issues.length ? (
                <div className="rounded-lg border border-amber-400/40 bg-amber-400/5 p-4 text-amber-300">
                    <p className="font-medium">Checks that did not pass</p>
                    <ul className="list-disc pl-4">
                        {run.issues.slice(0, 10).map((x, i) => (
                            <li key={i}>
                                {x.record >= 0 ? `Record ${x.record + 1}: ` : ''}
                                {x.problem}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
            {run.review ? (
                <section className={`rounded-lg border p-4 ${run.review.verdict === 'pass' ? 'border-emerald-400/40 bg-emerald-400/5 text-emerald-300' : 'border-amber-400/40 bg-amber-400/5 text-amber-300'}`}><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider">Reviewer · {run.review.model.split('/').pop()}</h3><p className="leading-6">{run.review.notes}</p></section>
            ) : null}
            {run.output?.gaps.length ? <p className="text-text-secondary">Could not find: {run.output.gaps.join('; ')}</p> : null}
            <p className="text-[10px] text-text-secondary">Cost {usd(run.costMicros)}</p>
        </div>
    );
}

function RunBlock({ job, run, onChange, onView }: { job: JobView; run: JobRunView; onChange: (j: JobView) => void; onView: (run: JobRunView) => void }) {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const decide = async (action: 'accept_run' | 'reject_run') => {
        setBusy(action);
        setError(null);
        const res = await post(job.id, { action, runId: run.id });
        setBusy(null);
        if (res.error || !res.job) return setError(res.error ?? 'Failed');
        onChange(res.job);
    };
    return (
        <div className="rounded border border-border p-2 space-y-2">
            <p className="text-xs font-medium">
                {run.dryRun ? 'Dry run' : 'Run'} · {new Date(run.startedAt).toLocaleString()} ·{' '}
                <span className={run.status === 'failed' ? 'text-red-400' : run.status === 'needs_review' ? 'text-amber-400' : 'text-text-secondary'}>
                    {run.status === 'needs_review' ? 'waiting for your review' : run.status}
                </span>
            </p>
            {run.status === 'running' ? (
                <div className="rounded-lg border border-primary/25 bg-primary/5 p-3" role="status" aria-live="polite">
                    <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-text-primary">{run.progressState.label}</span>
                        <span className="tabular-nums text-text-secondary">{run.progressState.percent}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-background-elevated" aria-label={`Job progress: ${run.progressState.percent}%`}>
                        <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${run.progressState.percent}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-text-secondary">
                        <span className="capitalize">{run.progressState.stage} · milestone progress</span>
                        <span>Worker active {new Date(run.heartbeatAt ?? run.progressState.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{run.attempt > 1 ? ` · recovery attempt ${run.attempt}` : ''}</span>
                    </div>
                    {run.progress.length > 1 ? <details className="mt-2"><summary className="cursor-pointer text-[10px] text-text-secondary hover:text-text-primary">Activity log</summary><ul className="mt-1 space-y-0.5 text-[11px] text-text-secondary">{run.progress.slice(-8).map((p, i, list) => <li key={`${p}-${i}`} className={i === list.length - 1 ? 'text-text-primary' : ''}>{i === list.length - 1 ? '● ' : '✓ '}{p}</li>)}</ul></details> : null}
                    <p className="mt-2 text-[10px] text-text-secondary">Research time varies with the number of sources and tools needed.</p>
                </div>
            ) : null}
            {run.error ? <p className="text-xs text-red-400">{run.error}</p> : null}
            {run.output ? (
                <div className="flex items-center justify-between gap-3 rounded border border-border bg-background-elevated/40 p-2">
                    <div className="min-w-0"><p className="text-xs line-clamp-2">{run.output.summary || `${run.output.records.length} result${run.output.records.length === 1 ? '' : 's'}`}</p><p className="text-[10px] text-text-secondary">{run.output.records.length} detailed result{run.output.records.length === 1 ? '' : 's'} · {run.issues.length} flagged check{run.issues.length === 1 ? '' : 's'}</p></div>
                    <button type="button" className={PRIMARY} onClick={() => onView(run)}>View full results</button>
                </div>
            ) : null}
            {error ? <p className="text-xs text-red-400">{error}</p> : null}
            {run.status === 'needs_review' && job.canManage ? (
                <div className="flex gap-2">
                    <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void decide('accept_run')}>
                        {run.dryRun ? 'Looks right — accept the sample' : 'Accept'}
                    </button>
                    <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void decide('reject_run')}>
                        {run.dryRun ? 'Not right — back to the design' : 'Reject'}
                    </button>
                </div>
            ) : null}
        </div>
    );
}

const OPPORTUNITY_LABEL: Record<LinkOpportunityStatus, string> = {
    recommended: 'Recommended', saved: 'Saved for later', approved: 'Approved', rejected: 'Rejected', submitted: 'Submitted', live: 'Live', submission_rejected: 'Submission rejected', removed: 'Link removed', expired: 'Expired',
};

function OpportunityTracker({ job, onChange }: { job: JobView; onChange: (j: JobView) => void }) {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const update = async (opportunity: LinkOpportunityView, status: LinkOpportunityStatus) => {
        let liveLinkUrl: string | undefined;
        if ((status === 'submitted' || status === 'live') && !opportunity.liveLinkUrl) {
            const entered = window.prompt('Paste the submitted or live page URL so Nucleas can verify the link:');
            if (!entered) return;
            liveLinkUrl = entered;
        }
        const note = status === 'rejected' || status === 'saved' || status === 'submission_rejected'
            ? window.prompt('Optional note — Nucleas will use this feedback in future recommendations:') ?? undefined
            : undefined;
        setBusy(opportunity.id);
        setError(null);
        const res = await post(job.id, { action: 'opportunity_status', opportunityId: opportunity.id, status, liveLinkUrl, note });
        setBusy(null);
        if (res.error || !res.job) return setError(res.error ?? 'Failed');
        onChange(res.job);
    };
    const verify = async (opportunity: LinkOpportunityView) => {
        setBusy(opportunity.id);
        setError(null);
        const res = await post(job.id, { action: 'verify_opportunity', opportunityId: opportunity.id });
        setBusy(null);
        if (res.error || !res.job) return setError(res.error ?? 'Verification failed');
        onChange(res.job);
    };
    if (!job.opportunities.length) return null;
    return (
        <details open className="rounded border border-border p-2">
            <summary className="cursor-pointer text-xs font-medium">Opportunity tracker ({job.opportunities.length})</summary>
            <div className="mt-2 space-y-2">
                {job.opportunities.map((opportunity) => (
                    <div key={opportunity.id} className="rounded border border-border/70 p-2 text-[11px] space-y-1">
                        <div className="flex items-start gap-2">
                            <a href={opportunity.opportunityUrl} target="_blank" rel="noreferrer" className="underline break-all flex-1">{String(opportunity.values.opportunity_type ?? opportunity.opportunityUrl)}</a>
                            <span className="rounded border border-border px-1.5 py-0.5 whitespace-nowrap">{OPPORTUNITY_LABEL[opportunity.status]}</span>
                        </div>
                        {opportunity.targetUrl ? <p className="text-text-secondary truncate">Target: {opportunity.targetUrl}</p> : null}
                        {opportunity.note ? <p>Feedback: {opportunity.note}</p> : null}
                        {opportunity.verificationMessage ? <p className={opportunity.status === 'live' ? 'text-emerald-400' : 'text-amber-400'}>{opportunity.verificationMessage}</p> : null}
                        {opportunity.lastVerifiedAt ? <p className="text-text-secondary">Checked {new Date(opportunity.lastVerifiedAt).toLocaleString()}</p> : null}
                        {job.canManage ? (
                            <div className="flex flex-wrap gap-1 pt-1">
                                {['recommended', 'saved', 'rejected'].includes(opportunity.status) ? <button type="button" className={PRIMARY} disabled={busy === opportunity.id} onClick={() => void update(opportunity, 'approved')}>Approve</button> : null}
                                {['recommended', 'approved', 'rejected', 'submission_rejected', 'expired'].includes(opportunity.status) ? <button type="button" className={BUTTON} disabled={busy === opportunity.id} onClick={() => void update(opportunity, 'saved')}>Save for later</button> : null}
                                {['recommended', 'saved', 'approved'].includes(opportunity.status) ? <button type="button" className={BUTTON} disabled={busy === opportunity.id} onClick={() => void update(opportunity, 'rejected')}>Reject</button> : null}
                                {['approved', 'submission_rejected'].includes(opportunity.status) ? <button type="button" className={PRIMARY} disabled={busy === opportunity.id} onClick={() => void update(opportunity, 'submitted')}>Mark submitted</button> : null}
                                {opportunity.status === 'submitted' ? <button type="button" className={BUTTON} disabled={busy === opportunity.id} onClick={() => void update(opportunity, 'submission_rejected')}>Submission rejected</button> : null}
                                {['submitted', 'live', 'removed'].includes(opportunity.status) ? <button type="button" className={BUTTON} disabled={busy === opportunity.id} onClick={() => void verify(opportunity)}>Verify link</button> : null}
                                {opportunity.status === 'live' ? <button type="button" className={BUTTON} disabled={busy === opportunity.id} onClick={() => void update(opportunity, 'removed')}>Mark removed</button> : null}
                                {['removed', 'submission_rejected'].includes(opportunity.status) ? <button type="button" className={BUTTON} disabled={busy === opportunity.id} onClick={() => void update(opportunity, 'expired')}>Expire</button> : null}
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>
            {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
        </details>
    );
}

type SeoBriefView = { projectId: string; projectName: string; status: 'draft' | 'approved'; summary: string; audience: string; goals: string[]; primaryTopics: string[]; competitors: string[]; excludedTopics: string[]; geographicTargets: string[]; positioning: string; priorityPages: { url: string; purpose: string; keywords: string[] }[]; notes: string; revision: number; approvedAt: string | null };

function SeoBriefEditor({ job }: { job: JobView }) {
    const [brief, setBrief] = useState<SeoBriefView | null>(null);
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (!job.projectId) return;
        let cancelled = false;
        void fetch(`/api/os/seo-briefs/${job.projectId}?companyId=${job.companyId}`, { cache: 'no-store' }).then(async (res) => {
            const body = (await res.json().catch(() => ({}))) as { brief?: SeoBriefView | null };
            if (!cancelled) setBrief(body.brief ?? null);
        });
        return () => { cancelled = true; };
    }, [job.companyId, job.projectId, job.updatedAt]);
    const open = () => {
        if (!brief) return;
        setForm({ summary: brief.summary, audience: brief.audience, goals: brief.goals.join('\n'), primaryTopics: brief.primaryTopics.join('\n'), competitors: brief.competitors.join('\n'), excludedTopics: brief.excludedTopics.join('\n'), geographicTargets: brief.geographicTargets.join('\n'), positioning: brief.positioning, priorityPages: JSON.stringify(brief.priorityPages, null, 2), notes: brief.notes });
        setEditing(true);
    };
    const save = async (status: 'draft' | 'approved') => {
        if (!job.projectId) return;
        setBusy(true); setError(null);
        const list = (key: string) => (form[key] ?? '').split('\n').map((v) => v.trim()).filter(Boolean);
        let priorityPages: unknown = [];
        try { priorityPages = JSON.parse(form.priorityPages || '[]'); } catch { setBusy(false); setError('Priority pages must be valid JSON.'); return; }
        const res = await fetch(`/api/os/seo-briefs/${job.projectId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId: job.companyId, status, summary: form.summary, audience: form.audience, goals: list('goals'), primaryTopics: list('primaryTopics'), competitors: list('competitors'), excludedTopics: list('excludedTopics'), geographicTargets: list('geographicTargets'), positioning: form.positioning, priorityPages, notes: form.notes }) });
        const body = (await res.json().catch(() => ({}))) as { brief?: SeoBriefView; error?: string };
        setBusy(false);
        if (!res.ok || !body.brief) return setError(body.error ?? 'Could not save the brief.');
        setBrief(body.brief); setEditing(false);
    };
    if (!brief) return <p className="text-xs text-text-secondary">Accept the generated result to create the editable SEO brief.</p>;
    const textarea = (key: string, label: string, rows = 3) => <label className="block space-y-1"><span className="text-xs font-medium">{label}</span><textarea value={form[key] ?? ''} onChange={(e) => setForm((v) => ({ ...v, [key]: e.target.value }))} rows={rows} className="w-full rounded border border-border bg-background-elevated px-2 py-1.5 text-sm" /></label>;
    return <>
        <div className="rounded border border-border p-2 flex items-center gap-2"><div className="min-w-0 flex-1"><p className="text-xs font-medium">SEO brief · {brief.projectName}</p><p className="text-[11px] text-text-secondary">{brief.status === 'approved' ? `Approved · revision ${brief.revision}` : `Draft · revision ${brief.revision}`}</p></div><button type="button" className={PRIMARY} onClick={open}>{brief.status === 'approved' ? 'View or edit brief' : 'Edit and approve'}</button></div>
            <Modal isOpen={editing} onClose={() => setEditing(false)} title={`SEO brief · ${brief.projectName}`} maxWidth="4xl" appearance="theme">
            <div className="space-y-4">
                <p className="text-xs text-text-secondary">Edits return the brief to draft unless you approve it. Approved content becomes hard context for this project’s SEO marketing work.</p>
                {textarea('summary', 'Property and offering', 4)}{textarea('audience', 'Target audience', 4)}
                <div className="grid sm:grid-cols-2 gap-4">{textarea('goals', 'SEO goals (one per line)')}{textarea('primaryTopics', 'Primary topics (one per line)')}{textarea('competitors', 'Search competitors (one per line)')}{textarea('excludedTopics', 'Excluded topics and audiences (one per line)')}{textarea('geographicTargets', 'Geographic targets (one per line)')}{textarea('positioning', 'Search positioning')}</div>
                {textarea('priorityPages', 'Priority pages (JSON: url, purpose, keywords[])', 8)}{textarea('notes', 'Strategy notes', 3)}
                {error ? <p className="text-xs text-red-400">{error}</p> : null}
                <div className="flex gap-2"><button type="button" className={BUTTON} disabled={busy} onClick={() => void save('draft')}>Save draft</button><button type="button" className={PRIMARY} disabled={busy} onClick={() => void save('approved')}>{busy ? 'Saving…' : 'Approve brief'}</button></div>
            </div>
        </Modal>
    </>;
}

// ---------- The card ----------

/**
 * One job in whatever state it is: questions to answer, a design to approve, a dry run to check,
 * results to review. Refreshes itself while Nucleas is working on it.
 */
export default function JobCard({ job: initial, compact = false, onChange, onOpenJobs }: { job: JobView; compact?: boolean; onChange?: (j: JobView) => void; onOpenJobs?: () => void }) {
    const [job, setJob] = useState(initial);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [resultRun, setResultRun] = useState<JobRunView | null>(null);
    const update = (next: JobView) => {
        setJob(next);
        onChange?.(next);
    };

    useEffect(() => setJob(initial), [initial]);

    const busyNow = jobIsBusy(job);
    useEffect(() => {
        if (!busyNow) return;
        const timer = window.setInterval(async () => {
            const res = await fetch(`/api/os/jobs/${job.id}`, { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as { job?: JobView };
            if (body.job) update(body.job);
        }, 4000);
        return () => window.clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- poll while busy
    }, [busyNow, job.id]);

    const act = async (action: string) => {
        setBusy(action);
        setError(null);
        const res = await post(job.id, { action });
        setBusy(null);
        if (res.error || !res.job) return setError(res.error ?? 'Failed');
        update(res.job);
    };

    const d = job.design;
    const reviewRun = job.runs.find((r) => r.status === 'needs_review' || r.status === 'running')
        ?? (job.status === 'testing' || job.status === 'proposed' ? job.runs.find((r) => r.status === 'failed') : undefined);
    const doneRuns = job.runs.filter((r) => r.status === 'completed');
    const failedAttempt = job.runs.some((r) => r.status === 'failed');
    const canArchive = ['proposed', 'ready', 'active', 'paused', 'done', 'failed', 'needs_answers'].includes(job.status)
        || (job.status === 'testing' && !job.runs.some((r) => r.status === 'running'));

    return (
        <div className="ui-card p-4 space-y-4 text-sm">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="font-medium leading-snug">{d?.title ?? 'New job'}</p>
                    <p className="text-[11px] text-text-secondary truncate">
                        {job.companyName}
                        {d ? ` · ${scheduleLabel(d.schedule)}` : ''}
                        {job.completion ? ` · ${job.completion === 'automatic' ? 'automatic' : 'reviewed'}` : ''}
                        {job.monthlyBudgetMicros ? ` · ${usd(job.spentThisMonthMicros)} of ${usd(job.monthlyBudgetMicros)} this month` : ''}
                    </p>
                </div>
                <JobStatusBadge status={job.status} />
            </div>

            {job.status === 'designing' ? <p className="text-xs text-sky-400">Nucleas is investigating {job.companyName} and designing this job…</p> : null}
            {job.status === 'failed' || job.error ? <p className="text-xs text-red-400">{job.error}</p> : null}

            {job.status === 'needs_answers' ? (
                <>
                    {d?.findings.length ? (
                        <ul className="list-disc pl-4 text-[11px] text-text-secondary">
                            {d.findings.slice(0, compact ? 3 : 12).map((f, i) => (
                                <li key={i}>{f}</li>
                            ))}
                        </ul>
                    ) : null}
                    <Questions job={job} onChange={update} />
                </>
            ) : null}

            {d && job.status !== 'needs_answers' && job.status !== 'designing' && (!compact || job.status === 'proposed') ? <DesignSummary job={job} /> : null}
            {job.status === 'proposed' && job.canManage ? <Approve job={job} onChange={update} /> : null}
            {job.status === 'proposed' && !job.canManage ? <p className="text-[11px] text-text-secondary">A manager or administrator approves jobs.</p> : null}

            {reviewRun ? <RunBlock job={job} run={reviewRun} onChange={update} onView={setResultRun} /> : null}
            {!compact && d?.skill === 'link_building' ? <OpportunityTracker job={job} onChange={update} /> : null}
            {!compact && d?.skill === 'seo_brief' ? <SeoBriefEditor job={job} /> : null}
            {!compact && doneRuns.length ? (
                <details open={doneRuns.length === 1}>
                    <summary className="cursor-pointer text-xs text-text-secondary">Results ({doneRuns.length} run{doneRuns.length === 1 ? '' : 's'})</summary>
                    <div className="mt-2 space-y-2">
                        {doneRuns.slice(0, 5).map((r) => (
                            <RunBlock key={r.id} job={job} run={r} onChange={update} onView={setResultRun} />
                        ))}
                    </div>
                </details>
            ) : null}

            {error ? <p className="text-xs text-red-400">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
                {!compact && job.canManage && (job.status === 'ready' || job.status === 'active') && job.deliveryRunnable ? (
                    <button type="button" className={PRIMARY} disabled={busy !== null || busyNow} onClick={() => void act('run_now')}>
                        {busy === 'run_now' ? 'Starting…' : 'Run now'}
                    </button>
                ) : null}
                {!compact && job.canManage && (job.status === 'ready' || job.status === 'active') ? (
                    <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void act('pause')}>
                        Pause
                    </button>
                ) : null}
                {!compact && job.canManage && job.status === 'paused' ? (
                    <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void act('resume')}>
                        Resume
                    </button>
                ) : null}
                {!compact && doneRuns.length && d ? (
                    <a
                        className={BUTTON}
                        href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv(d.fields, doneRuns))}`}
                        download={`${d.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`}
                    >
                        Download CSV
                    </a>
                ) : null}
                {!compact && job.canManage && canArchive ? (
                    <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void act('archive')}>
                        {failedAttempt ? 'Clear failed job' : 'Archive'}
                    </button>
                ) : null}
                {compact && onOpenJobs ? (
                    <button type="button" className={BUTTON} onClick={onOpenJobs}>
                        Open in Jobs
                    </button>
                ) : null}
            </div>
            {!compact && (job.status === 'ready' || job.status === 'active') && d && d.schedule.kind !== 'once' ? (
                <p className="text-[11px] text-text-secondary">
                    {job.nextRunAt ? `Next scheduled run: ${new Date(job.nextRunAt).toLocaleString()}` : 'Scheduling resumes when this job is active.'}
                </p>
            ) : null}
            <Modal isOpen={Boolean(resultRun)} onClose={() => setResultRun(null)} title={`${d?.title ?? 'Job'} results`} maxWidth="5xl" appearance="theme">
                {resultRun ? <Results job={job} run={resultRun} /> : null}
            </Modal>
        </div>
    );
}
