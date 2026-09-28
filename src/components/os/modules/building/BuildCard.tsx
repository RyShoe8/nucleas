'use client';

import { useState } from 'react';
import IdeChatMarkdown from '@/components/ide/IdeChatMarkdown';

export type BuildStatus = 'proposed' | 'rejected' | 'queued' | 'building' | 'ready' | 'failed' | 'pr_opened' | 'discarded';

export interface BuildView {
    id: string;
    companyId: string;
    companyName: string;
    status: BuildStatus;
    request: string;
    title: string;
    summary: string;
    steps: string[];
    planMarkdown: string;
    repository: { owner: string; repo: string; defaultBranch: string; fullName: string };
    level: 'low' | 'medium' | 'high' | null;
    createdAt: string;
    updatedAt: string;
    approvedAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    attempts: number;
    result: {
        outcome: 'completed' | 'blocked' | 'failed' | null;
        summary: string | null;
        changedFiles: string[];
        checks: { command: string; exitCode: number | null; timedOut: boolean }[];
        limitations: string[];
        model: string | null;
    } | null;
    error: string | null;
    pullRequest: { url: string; number: number; branch: string } | null;
    canManage: boolean;
}

export const STATUS_LABEL: Record<BuildStatus, string> = {
    proposed: 'Awaiting approval',
    rejected: 'Rejected',
    queued: 'Queued',
    building: 'Building',
    ready: 'Ready for review',
    failed: 'Failed',
    pr_opened: 'Pull request open',
    discarded: 'Discarded',
};

export const STATUS_TONE: Record<BuildStatus, string> = {
    proposed: 'text-amber-400 border-amber-400/40',
    rejected: 'text-text-secondary border-border',
    queued: 'text-sky-400 border-sky-400/40',
    building: 'text-sky-400 border-sky-400/40',
    ready: 'text-emerald-400 border-emerald-400/40',
    failed: 'text-red-400 border-red-400/40',
    pr_opened: 'text-emerald-400 border-emerald-400/40',
    discarded: 'text-text-secondary border-border',
};

export function StatusBadge({ status }: { status: BuildStatus }) {
    return <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export type BuildAction = 'approve' | 'edit' | 'reject' | 'retry' | 'discard' | 'open_pr';

export async function postBuildAction(id: string, action: BuildAction, extra: Record<string, unknown> = {}): Promise<{ build?: BuildView; error?: string }> {
    const res = await fetch(`/api/os/builds/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
    });
    const body = (await res.json().catch(() => ({}))) as { build?: BuildView; error?: string };
    return res.ok ? body : { error: body.error ?? `Failed (${res.status})` };
}

const BUTTON = 'text-[11px] px-2 py-1 rounded border border-border hover:bg-background-card disabled:opacity-50';
const PRIMARY = 'text-[11px] px-2 py-1 rounded bg-primary text-white hover:opacity-90 disabled:opacity-50';

/**
 * One build: its plan, and the actions its state allows. `compact` (Ask) shows the plan collapsed
 * with approve / edit / reject; the Building window shows everything.
 */
export default function BuildCard({
    build,
    onChange,
    compact = false,
    onOpenBuilding,
}: {
    build: BuildView;
    onChange: (next: BuildView) => void;
    compact?: boolean;
    onOpenBuilding?: () => void;
}) {
    const [busy, setBusy] = useState<BuildAction | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(build.planMarkdown);
    const [showPlan, setShowPlan] = useState(!compact);

    const act = async (action: BuildAction, extra: Record<string, unknown> = {}) => {
        if (action === 'reject' && !window.confirm('Reject this plan? It will not be built.')) return;
        if (action === 'discard' && !window.confirm('Discard this build?')) return;
        setBusy(action);
        setError(null);
        const res = await postBuildAction(build.id, action, extra);
        setBusy(null);
        if (res.error || !res.build) return setError(res.error ?? 'Failed');
        setEditing(false);
        onChange(res.build);
    };

    const r = build.result;
    return (
        <div className="rounded-md border border-border bg-background-card/40 p-3 space-y-2 text-sm">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="font-medium leading-snug">{build.title}</p>
                    <p className="text-[11px] text-text-secondary truncate">
                        {build.companyName} · {build.repository.fullName}
                    </p>
                </div>
                <StatusBadge status={build.status} />
            </div>

            {build.summary && !editing ? <p className="text-xs text-text-secondary">{build.summary}</p> : null}

            {editing ? (
                <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="w-full h-64 rounded border border-border bg-background p-2 font-mono text-xs"
                    aria-label="Plan"
                />
            ) : showPlan ? (
                <div className="max-h-80 overflow-y-auto rounded border border-border bg-background p-2 text-xs">
                    <IdeChatMarkdown text={build.planMarkdown} />
                </div>
            ) : null}
            {!editing ? (
                <button type="button" className="text-[11px] text-text-secondary underline" onClick={() => setShowPlan((v) => !v)}>
                    {showPlan ? 'Hide plan' : `Show plan${build.steps.length ? ` (${build.steps.length} steps)` : ''}`}
                </button>
            ) : null}

            {r && !compact ? (
                <div className="space-y-1 text-xs">
                    {r.summary ? <p>{r.summary}</p> : null}
                    {r.changedFiles.length ? (
                        <p className="text-text-secondary">
                            Changed: {r.changedFiles.slice(0, 12).join(', ')}
                            {r.changedFiles.length > 12 ? ` +${r.changedFiles.length - 12} more` : ''}
                        </p>
                    ) : null}
                    {r.checks.length ? (
                        <ul className="text-text-secondary">
                            {r.checks.map((c, i) => (
                                <li key={i} className={c.exitCode === 0 && !c.timedOut ? '' : 'text-amber-400'}>
                                    <code>{c.command}</code> → {c.timedOut ? 'timed out' : `exit ${c.exitCode}`}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    {r.limitations.length ? <p className="text-text-secondary">Limitations: {r.limitations.join('; ')}</p> : null}
                    {r.model ? <p className="text-[10px] text-text-secondary">Built with {r.model}</p> : null}
                </div>
            ) : null}
            {build.error ? <p className="text-xs text-red-400">{build.error}</p> : null}
            {build.pullRequest ? (
                <a href={build.pullRequest.url} target="_blank" rel="noreferrer" className="text-xs underline text-emerald-400">
                    Pull request #{build.pullRequest.number} ↗
                </a>
            ) : null}
            {error ? <p className="text-xs text-red-400">{error}</p> : null}

            <div className="flex flex-wrap items-center gap-2">
                {build.canManage && build.status === 'proposed' ? (
                    editing ? (
                        <>
                            <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void act('approve', { planMarkdown: draft })}>
                                {busy === 'approve' ? 'Approving…' : 'Approve edited plan'}
                            </button>
                            <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void act('edit', { planMarkdown: draft })}>
                                {busy === 'edit' ? 'Saving…' : 'Save'}
                            </button>
                            <button
                                type="button"
                                className={BUTTON}
                                disabled={busy !== null}
                                onClick={() => {
                                    setDraft(build.planMarkdown);
                                    setEditing(false);
                                }}
                            >
                                Cancel
                            </button>
                        </>
                    ) : (
                        <>
                            <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void act('approve')}>
                                {busy === 'approve' ? 'Approving…' : 'Approve'}
                            </button>
                            <button
                                type="button"
                                className={BUTTON}
                                disabled={busy !== null}
                                onClick={() => {
                                    setDraft(build.planMarkdown);
                                    setEditing(true);
                                }}
                            >
                                Edit
                            </button>
                            <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void act('reject')}>
                                {busy === 'reject' ? 'Rejecting…' : 'Reject'}
                            </button>
                        </>
                    )
                ) : null}
                {build.canManage && build.status === 'ready' && !compact ? (
                    <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => void act('open_pr')}>
                        {busy === 'open_pr' ? 'Opening…' : 'Open pull request'}
                    </button>
                ) : null}
                {build.canManage && (build.status === 'failed' || build.status === 'ready') && !compact ? (
                    <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void act('retry')}>
                        {busy === 'retry' ? 'Queuing…' : 'Rebuild'}
                    </button>
                ) : null}
                {build.canManage && (build.status === 'queued' || build.status === 'failed' || build.status === 'ready') && !compact ? (
                    <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void act('discard')}>
                        Discard
                    </button>
                ) : null}
                {!build.canManage && build.status === 'proposed' ? (
                    <span className="text-[11px] text-text-secondary">A manager or administrator approves plans.</span>
                ) : null}
                {compact && build.status !== 'proposed' && onOpenBuilding ? (
                    <button type="button" className={BUTTON} onClick={onOpenBuilding}>
                        Open Building
                    </button>
                ) : null}
            </div>
        </div>
    );
}
