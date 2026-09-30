'use client';

import { useState } from 'react';
import { useOsCompanies } from '../CompaniesModule';
import { accountColor, api, type Account, type Counts, type View } from './types';

interface Selection { view: View; accountId: string | null; companyId: string | null }

const PLACES: { view: View; label: string; icon: string }[] = [
    { view: 'inbox', label: 'Inbox', icon: '📥' },
    { view: 'unread', label: 'Unread', icon: '●' },
    { view: 'starred', label: 'Starred', icon: '★' },
    { view: 'sent', label: 'Sent', icon: '➤' },
    { view: 'all', label: 'All mail', icon: '🗂' },
];
const FILTERED: { view: View; label: string; icon: string; hint: string }[] = [
    { view: 'updates', label: 'Updates', icon: '🔔', hint: 'Receipts, notifications, automated mail' },
    { view: 'promotions', label: 'Promotions', icon: '🏷', hint: 'Newsletters, marketing, cold outreach' },
    { view: 'suspicious', label: 'Suspicious', icon: '⚠', hint: 'Likely spam or phishing: check before trusting' },
];

function Badge({ n, tone = 'normal' }: { n: number; tone?: 'normal' | 'warn' }) {
    if (!n) return null;
    return <span className={`text-[10px] px-1.5 rounded-full ${tone === 'warn' ? 'bg-amber-500/20 text-amber-300' : 'bg-primary/20 text-primary'}`}>{n > 99 ? '99+' : n}</span>;
}

export default function Sidebar({
    accounts,
    counts,
    selection,
    onSelect,
    onCompose,
    onSync,
    syncing,
    googleConfigured,
    onChanged,
}: {
    accounts: Account[];
    counts: Counts | null;
    selection: Selection;
    onSelect: (next: Partial<Selection>) => void;
    onCompose: () => void;
    onSync: () => void;
    syncing: boolean;
    googleConfigured: boolean;
    onChanged: () => void;
}) {
    const [editing, setEditing] = useState<string | null>(null);
    const row = (active: boolean) => `w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[13px] ${active ? 'bg-primary/15 text-text-primary' : 'text-text-secondary hover:bg-background-card'}`;
    const lastSync = accounts.map((a) => a.lastSyncAt).filter((x): x is string => Boolean(x)).sort().at(-1);

    return (
        <nav className="w-52 shrink-0 border-r border-border flex flex-col min-h-0" aria-label="Mail places">
            <div className="p-2 flex gap-1">
                <button type="button" onClick={onCompose} disabled={!accounts.length} className="flex-1 h-8 rounded bg-primary text-white text-[13px] disabled:opacity-50">
                    Compose
                </button>
                <button type="button" onClick={onSync} disabled={syncing || !accounts.length} title={lastSync ? `Last synced ${new Date(lastSync).toLocaleTimeString()}` : 'Sync now'} aria-label="Sync now" className="h-8 w-8 rounded border border-border text-sm hover:bg-background-card disabled:opacity-50">
                    <span className={syncing ? 'inline-block animate-spin' : ''}>⟳</span>
                </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-3">
                <div className="space-y-0.5">
                    {PLACES.map((p) => (
                        <button key={p.view} type="button" onClick={() => onSelect({ view: p.view })} className={row(selection.view === p.view)}>
                            <span className="w-4 text-center text-xs">{p.icon}</span>
                            <span className="flex-1">{p.label}</span>
                            {p.view === 'inbox' ? <Badge n={counts?.inbox ?? 0} /> : null}
                        </button>
                    ))}
                </div>
                <div>
                    <p className="px-2 text-[10px] uppercase tracking-wider text-text-secondary mb-1">Filtered out of your inbox</p>
                    <div className="space-y-0.5">
                        {FILTERED.map((p) => (
                            <button key={p.view} type="button" title={p.hint} onClick={() => onSelect({ view: p.view })} className={row(selection.view === p.view)}>
                                <span className="w-4 text-center text-xs">{p.icon}</span>
                                <span className="flex-1">{p.label}</span>
                                <Badge n={counts?.[p.view as 'updates' | 'promotions' | 'suspicious'] ?? 0} tone={p.view === 'suspicious' ? 'warn' : 'normal'} />
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <p className="px-2 text-[10px] uppercase tracking-wider text-text-secondary mb-1">Mailboxes</p>
                    <div className="space-y-0.5">
                        <button type="button" onClick={() => onSelect({ accountId: null, companyId: null })} className={row(!selection.accountId && !selection.companyId)}>
                            <span className="w-4 text-center text-xs">∗</span>
                            <span className="flex-1">All mailboxes</span>
                        </button>
                        {accounts.map((a) => (
                            <div key={a.id}>
                                <div className="flex items-center">
                                    <button type="button" onClick={() => onSelect({ accountId: a.id, companyId: null })} className={`${row(selection.accountId === a.id)} flex-1 min-w-0`} title={a.emailAddress}>
                                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: accountColor(a, accounts) }} />
                                        <span className="flex-1 truncate">{a.label || a.emailAddress}</span>
                                        {a.needsReauth ? <span className="text-[10px] text-amber-300">reconnect</span> : <Badge n={a.unread} />}
                                    </button>
                                    <button type="button" onClick={() => setEditing(editing === a.id ? null : a.id)} aria-label={`Settings for ${a.emailAddress}`} className="px-1 text-text-secondary hover:text-text-primary text-xs">
                                        ⋯
                                    </button>
                                </div>
                                {editing === a.id ? <AccountEditor account={a} onDone={() => { setEditing(null); onChanged(); }} /> : null}
                            </div>
                        ))}
                    </div>
                    {googleConfigured ? (
                        <a href="/api/os/mail/google/start" className="mt-1 block px-2 py-1 text-[12px] text-primary hover:underline">
                            + Connect a Gmail mailbox
                        </a>
                    ) : (
                        <p className="px-2 mt-1 text-[11px] text-amber-400">Google sign-in is not configured on the server.</p>
                    )}
                </div>
            </div>
        </nav>
    );
}

function AccountEditor({ account, onDone }: { account: Account; onDone: () => void }) {
    const { companies } = useOsCompanies();
    const [label, setLabel] = useState(account.label);
    const [companyId, setCompanyId] = useState(account.companyId ?? '');
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        const res = await api<unknown>(`/api/os/mail/accounts/${account.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label, companyId: companyId || null }) });
        if (!res.ok) return setError(res.error);
        onDone();
    };
    const remove = async () => {
        if (!window.confirm(`Disconnect ${account.emailAddress}? Its copy in Nucleas is deleted; Gmail itself is not changed.`)) return;
        const res = await api<unknown>(`/api/os/mail/accounts/${account.id}`, { method: 'DELETE' });
        if (!res.ok) return setError(res.error);
        onDone();
    };

    return (
        <div className="mx-1 my-1 p-2 rounded border border-border space-y-1.5 bg-background-elevated">
            <input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Name" placeholder="Name, e.g. Playbound support" className="h-7 w-full px-2 rounded border border-border bg-background text-xs" />
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Company" className="h-7 w-full px-1 rounded border border-border bg-background text-xs">
                <option value="">No company (platform mailbox)</option>
                {(companies ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                        {c.name}
                    </option>
                ))}
            </select>
            {account.lastSyncError ? <p className="text-[11px] text-amber-400">{account.lastSyncError}</p> : null}
            {account.needsReauth ? (
                <a href={`/api/os/mail/google/start${account.companyId ? `?companyId=${account.companyId}` : ''}`} className="block text-[11px] text-primary underline">
                    Reconnect this mailbox
                </a>
            ) : null}
            {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
            <div className="flex gap-1">
                <button type="button" onClick={() => void save()} className="text-[11px] px-2 py-0.5 rounded bg-primary text-white">
                    Save
                </button>
                <button type="button" onClick={() => void remove()} className="text-[11px] px-2 py-0.5 rounded border border-border text-red-300 ml-auto">
                    Disconnect
                </button>
            </div>
        </div>
    );
}
