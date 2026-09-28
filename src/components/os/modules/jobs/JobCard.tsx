'use client';

import { useEffect, useState } from 'react';

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
    title: string;
    category: string;
    instructions: string;
    fields: JobField[];
    sourcePolicy: string;
    delivery: { method: string; detail: string; setupSteps: string[] };
    schedule: { kind: 'once' | 'daily' | 'weekly' | 'monthly'; time?: string; weekday?: number; dayOfMonth?: number };
    recordsPerRun: number;
    safeguards: string[];
    recommendedCompletion: 'review' | 'automatic';
    findings: string[];
    questions: JobQuestion[];
}

export interface JobRunView {
    id: string;
    dryRun: boolean;
    status: 'running' | 'needs_review' | 'completed' | 'rejected' | 'failed';
    startedAt: string;
    finishedAt: string | null;
    progress: string[];
    output: { records: { values: Record<string, unknown>; sources: string[] }[]; summary: string; gaps: string[] } | null;
    issues: { record: number; field?: string; problem: string }[];
    review: { verdict: 'pass' | 'fail'; notes: string; model: string } | null;
    costMicros: number;
    error: string | null;
}

export interface JobView {
    id: string;
    companyId: string;
    companyName: string;
    status: JobStatus;
    request: string;
    design: JobDesign | null;
    answers: Record<string, { option?: string; text?: string }>;
    completion: 'review' | 'automatic' | null;
    level: 'low' | 'medium' | 'high' | null;
    monthlyBudgetMicros: number;
    spentThisMonthMicros: number;
    deliveryLabel: string | null;
    deliveryRunnable: boolean;
    createdAt: string;
    updatedAt: string;
    lastRunAt: string | null;
    error: string | null;
    runs: JobRunView[];
    canManage: boolean;
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

export function scheduleLabel(s: JobDesign['schedule'] | undefined): string {
    if (!s || s.kind === 'once') return 'Once';
    const at = s.time ? ` at ${s.time}` : '';
    if (s.kind === 'daily') return `Every day${at}`;
    if (s.kind === 'weekly') return `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][s.weekday ?? 1]}${at}`;
    return `Monthly on day ${s.dayOfMonth ?? 1}${at}`;
}

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 100_000 ? 3 : 2)}`;
const BUTTON = 'text-[11px] px-2 py-1 rounded border border-border hover:bg-background-card disabled:opacity-50';
const PRIMARY = 'text-[11px] px-2 py-1 rounded bg-primary text-white hover:opacity-90 disabled:opacity-50';

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
        <div className="space-y-2 text-xs">
            {run.output?.summary ? <p>{run.output.summary}</p> : null}
            {records.length ? (
                <div className="overflow-x-auto rounded border border-border">
                    <table className="w-full text-[11px]">
                        <thead>
                            <tr className="text-left text-text-secondary">
                                {fields.map((f) => (
                                    <th key={f.key} className="px-2 py-1 font-normal whitespace-nowrap">
                                        {f.label}
                                    </th>
                                ))}
                                <th className="px-2 py-1 font-normal">Sources</th>
                            </tr>
                        </thead>
                        <tbody>
                            {records.map((r, i) => (
                                <tr key={i} className="border-t border-border align-top">
                                    {fields.map((f) => {
                                        const v = r.values[f.key];
                                        const text = Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v);
                                        const problem = run.issues.find((x) => x.record === i && x.field === f.key);
                                        return (
                                            <td key={f.key} className={`px-2 py-1 max-w-[260px] ${problem ? 'text-amber-400' : ''}`} title={problem?.problem}>
                                                {f.type === 'url' && text ? (
                                                    <a href={text} target="_blank" rel="noreferrer" className="underline break-all">
                                                        {text}
                                                    </a>
                                                ) : (
                                                    <span className="line-clamp-4">{text || '—'}</span>
                                                )}
                                            </td>
                                        );
                                    })}
                                    <td className="px-2 py-1">
                                        {r.sources.slice(0, 4).map((s, j) => (
                                            <a key={j} href={s} target="_blank" rel="noreferrer" className="block underline truncate max-w-[160px]" title={s}>
                                                {s.replace(/^https?:\/\/(www\.)?/, '')}
                                            </a>
                                        ))}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}
            {run.issues.length ? (
                <div className="text-amber-400">
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
                <p className={run.review.verdict === 'pass' ? 'text-emerald-400' : 'text-amber-400'}>
                    Reviewer ({run.review.model.split('/').pop()}): {run.review.verdict === 'pass' ? 'looks right' : 'has concerns'} — {run.review.notes}
                </p>
            ) : null}
            {run.output?.gaps.length ? <p className="text-text-secondary">Could not find: {run.output.gaps.join('; ')}</p> : null}
            <p className="text-[10px] text-text-secondary">Cost {usd(run.costMicros)}</p>
        </div>
    );
}

function RunBlock({ job, run, onChange }: { job: JobView; run: JobRunView; onChange: (j: JobView) => void }) {
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
                <ul className="text-[11px] text-text-secondary space-y-0.5">
                    {run.progress.slice(-6).map((p, i, list) => (
                        <li key={i} className={i === list.length - 1 ? 'text-text-primary' : ''}>
                            {i === list.length - 1 ? '● ' : '✓ '}
                            {p}
                        </li>
                    ))}
                </ul>
            ) : null}
            {run.error ? <p className="text-xs text-red-400">{run.error}</p> : null}
            {run.output ? <Results job={job} run={run} /> : null}
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

// ---------- The card ----------

/**
 * One job in whatever state it is: questions to answer, a design to approve, a dry run to check,
 * results to review. Refreshes itself while Nucleas is working on it.
 */
export default function JobCard({ job: initial, compact = false, onChange, onOpenJobs }: { job: JobView; compact?: boolean; onChange?: (j: JobView) => void; onOpenJobs?: () => void }) {
    const [job, setJob] = useState(initial);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
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
    const reviewRun = job.runs.find((r) => r.status === 'needs_review' || r.status === 'running');
    const doneRuns = job.runs.filter((r) => r.status === 'completed');

    return (
        <div className="rounded-md border border-border bg-background-card/40 p-3 space-y-3 text-sm">
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

            {reviewRun ? <RunBlock job={job} run={reviewRun} onChange={update} /> : null}
            {!compact && doneRuns.length ? (
                <details open={doneRuns.length === 1}>
                    <summary className="cursor-pointer text-xs text-text-secondary">Results ({doneRuns.length} run{doneRuns.length === 1 ? '' : 's'})</summary>
                    <div className="mt-2 space-y-2">
                        {doneRuns.slice(0, 5).map((r) => (
                            <RunBlock key={r.id} job={job} run={r} onChange={update} />
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
                {!compact && job.canManage && ['proposed', 'ready', 'active', 'paused', 'done', 'failed', 'needs_answers'].includes(job.status) ? (
                    <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => window.confirm('Archive this job?') && void act('archive')}>
                        Archive
                    </button>
                ) : null}
                {compact && onOpenJobs ? (
                    <button type="button" className={BUTTON} onClick={onOpenJobs}>
                        Open in Jobs
                    </button>
                ) : null}
            </div>
            {!compact && (job.status === 'ready' || job.status === 'active') && d && d.schedule.kind !== 'once' ? (
                <p className="text-[11px] text-text-secondary">Scheduled runs start in the next step of Jobs; use Run now meanwhile.</p>
            ) : null}
        </div>
    );
}
