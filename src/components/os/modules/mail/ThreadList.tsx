'use client';

import { accountColor, displayName, shortDate, type Account, type ThreadSummary } from './types';

export default function ThreadList({
    threads,
    accounts,
    selectedId,
    onSelect,
    onStar,
    loading,
    onMore,
    hasMore,
    empty,
}: {
    threads: ThreadSummary[] | null;
    accounts: Account[];
    selectedId: string | null;
    onSelect: (t: ThreadSummary) => void;
    onStar: (t: ThreadSummary) => void;
    loading: boolean;
    onMore: () => void;
    hasMore: boolean;
    empty: string;
}) {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    if (!threads) return <p className="p-4 text-sm text-text-secondary">Loading…</p>;
    if (!threads.length) return <p className="p-4 text-sm text-text-secondary">{empty}</p>;
    return (
        <ul className="divide-y divide-border" role="list">
            {threads.map((t) => {
                const account = byId.get(t.accountId);
                const active = t.id === selectedId;
                return (
                    <li key={`${t.accountId}:${t.threadId}`}>
                        <div className={`flex gap-2 px-3 py-2 cursor-pointer ${active ? 'bg-primary/10' : 'hover:bg-background-card'}`} onClick={() => onSelect(t)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(t); }}>
                            <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: t.unread ? 'var(--color-primary, #3b82f6)' : 'transparent' }} aria-label={t.unread ? 'Unread' : undefined} />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                    <span className={`truncate text-[13px] ${t.unread ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>{displayName(t.from)}{t.count > 1 ? <span className="ml-1 text-[11px] text-text-secondary">({t.count})</span> : null}</span>
                                    <span className="ml-auto shrink-0 text-[11px] text-text-secondary">{shortDate(t.date)}</span>
                                </div>
                                <div className={`truncate text-[13px] ${t.unread ? 'text-text-primary' : 'text-text-secondary'}`}>{t.subject}</div>
                                <div className="truncate text-[12px] text-text-secondary">{t.aiSummary ?? t.snippet}</div>
                                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-secondary">
                                    {account ? (
                                        <span className="inline-flex items-center gap-1 px-1.5 rounded border border-border">
                                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: accountColor(account, accounts) }} />
                                            {account.label || account.emailAddress}
                                        </span>
                                    ) : null}
                                    {account?.companyName ? <span>{account.companyName}</span> : null}
                                    {t.hasAttachments ? <span title="Has attachments">📎</span> : null}
                                    {t.triage && !['important', 'normal'].includes(t.triage.bucket) ? <span className={t.triage.bucket === 'suspicious' ? 'text-amber-300' : ''}>{t.triage.reasons[0]}</span> : null}
                                </div>
                            </div>
                            <button type="button" onClick={(e) => { e.stopPropagation(); onStar(t); }} aria-label={t.starred ? 'Unstar' : 'Star'} className={`self-start text-sm ${t.starred ? 'text-amber-300' : 'text-text-secondary hover:text-amber-300'}`}>
                                {t.starred ? '★' : '☆'}
                            </button>
                        </div>
                    </li>
                );
            })}
            {hasMore ? (
                <li className="p-2 text-center">
                    <button type="button" disabled={loading} onClick={onMore} className="text-xs text-primary hover:underline disabled:opacity-50">
                        {loading ? 'Loading…' : 'Load older'}
                    </button>
                </li>
            ) : null}
        </ul>
    );
}
