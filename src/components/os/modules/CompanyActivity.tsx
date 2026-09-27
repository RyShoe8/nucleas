'use client';

import { useCallback, useEffect, useState } from 'react';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import type { OsInvocation } from './CompanySnapshot';

const STATUS_STYLE: Record<string, string> = {
    verified: 'text-emerald-400',
    succeeded: 'text-emerald-400',
    pending_approval: 'text-amber-400',
    running: 'text-text-secondary',
    needs_setup: 'text-amber-400',
    plan_limited: 'text-amber-400',
    needs_reauth: 'text-amber-400',
    failed: 'text-red-400',
    denied: 'text-text-secondary',
    cancelled: 'text-text-secondary',
};

const STATUS_LABEL: Record<string, string> = {
    verified: 'Verified',
    succeeded: 'Done',
    pending_approval: 'Needs approval',
    running: 'Running',
    needs_setup: 'Needs setup',
    plan_limited: 'Plan-limited',
    needs_reauth: 'Reconnect',
    failed: 'Failed',
    denied: 'Denied',
    cancelled: 'Cancelled',
};

export default function CompanyActivity({ companyId, refreshKey }: { companyId: string; refreshKey: number }) {
    const auth = useOsAuth();
    const [items, setItems] = useState<OsInvocation[] | null>(null);
    const [includeReads, setIncludeReads] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [reloadKey, setReloadKey] = useState(0);
    const load = useCallback(() => setReloadKey((k) => k + 1), []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/companies/${companyId}/activity${includeReads ? '?includeReads=1' : ''}`);
            const data = (await res.json().catch(() => ({}))) as { items?: OsInvocation[]; error?: string };
            if (cancelled) return;
            if (!res.ok) setError(data.error ?? `Failed (${res.status})`);
            else setItems(data.items ?? []);
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId, includeReads, refreshKey, reloadKey]);

    const decide = async (approvalId: string, decision: 'approve' | 'deny') => {
        const res = await fetch(`/api/os/approvals/${approvalId}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ decision }),
        });
        if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            setError(data.error ?? `Failed (${res.status})`);
        }
        void load();
    };

    return (
        <section>
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] uppercase tracking-wider text-text-secondary">Activity</h3>
                <label className="text-[11px] text-text-secondary flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={includeReads} onChange={(e) => setIncludeReads(e.target.checked)} />
                    Include data reads
                </label>
            </div>
            {error ? <p className="text-xs text-red-400 mb-2">{error}</p> : null}
            {items === null ? (
                <p className="text-sm text-text-secondary">Loading…</p>
            ) : items.length === 0 ? (
                <p className="text-sm text-text-secondary">No actions yet.</p>
            ) : (
                <ul className="rounded-md border border-border divide-y divide-border">
                    {items.map((i) => (
                        <li key={i.id} className="px-3 py-2">
                            <div className="flex items-center gap-2">
                                <span className="text-sm flex-1 min-w-0 truncate">
                                    {i.title}
                                    <span className="ml-2 text-[11px] text-text-secondary">
                                        {i.providerName}
                                        {i.requestedBy === 'ai' ? ' · by AI' : i.requestedBy === 'system' ? ' · scheduled' : ''}
                                    </span>
                                </span>
                                <span className={`text-[11px] ${STATUS_STYLE[i.status] ?? 'text-text-secondary'}`}>{STATUS_LABEL[i.status] ?? i.status}</span>
                                <time className="text-[11px] text-text-secondary flex-shrink-0" dateTime={i.createdAt}>
                                    {new Date(i.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                </time>
                            </div>
                            {i.summary || i.error ? (
                                <p className={`mt-0.5 text-[11px] ${i.error ? 'text-text-secondary' : 'text-text-secondary'} truncate`}>
                                    {i.summary ?? i.error}
                                    {i.resource?.externalUrl ? (
                                        <>
                                            {' · '}
                                            <a href={i.resource.externalUrl} target="_blank" rel="noreferrer" className="underline hover:text-text-primary">
                                                open
                                            </a>
                                        </>
                                    ) : null}
                                </p>
                            ) : null}
                            {i.status === 'pending_approval' && i.approvalId && auth.isManagerOrAdmin ? (
                                <div className="mt-1 flex gap-2">
                                    <button type="button" onClick={() => decide(i.approvalId!, 'approve')} className="text-[11px] px-2 py-0.5 rounded bg-primary text-white">
                                        Approve
                                    </button>
                                    <button type="button" onClick={() => decide(i.approvalId!, 'deny')} className="text-[11px] px-2 py-0.5 rounded border border-border">
                                        Deny
                                    </button>
                                </div>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
