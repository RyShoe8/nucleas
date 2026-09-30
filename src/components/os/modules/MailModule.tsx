'use client';

import { useCallback, useEffect, useState } from 'react';
import Composer from './mail/Composer';
import Reader from './mail/Reader';
import Sidebar from './mail/Sidebar';
import ThreadList from './mail/ThreadList';
import { api, post, type Account, type Counts, type ThreadSummary, type View } from './mail/types';
import MailAiTools from './mail/MailAiTools';

const EMPTY: Record<View, string> = {
    inbox: 'Your inbox is clear. Filtered mail is under Updates, Promotions and Suspicious.',
    unread: 'Nothing unread in your inbox.',
    starred: 'No starred conversations.',
    sent: 'No sent mail yet.',
    all: 'No mail yet. Connect a mailbox to get started.',
    updates: 'No automated mail filed away.',
    promotions: 'No promotions or cold outreach filed away.',
    suspicious: 'Nothing suspicious. The filter will show its reasons for anything it files here.',
};
const PAGE = 40;

/** All connected Gmail mailboxes in one inbox, with the spam filter's work made visible. */
export default function MailModule() {
    const [accounts, setAccounts] = useState<Account[] | null>(null);
    const [counts, setCounts] = useState<Counts | null>(null);
    const [googleConfigured, setGoogleConfigured] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [selection, setSelection] = useState<{ view: View; accountId: string | null; companyId: string | null }>({ view: 'inbox', accountId: null, companyId: null });
    const [query, setQuery] = useState('');
    const [search, setSearch] = useState('');
    const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [selected, setSelected] = useState<ThreadSummary | null>(null);
    const [composing, setComposing] = useState(false);
    const [syncing, setSyncing] = useState(false);

    const [tick, setTick] = useState(0);
    const refresh = useCallback(() => setTick((t) => t + 1), []);

    const threadUrl = useCallback((before?: string) => {
        const p = new URLSearchParams({ view: selection.view, limit: String(PAGE) });
        if (selection.accountId) p.set('accountId', selection.accountId);
        if (selection.companyId) p.set('companyId', selection.companyId);
        if (search) p.set('q', search);
        if (before) p.set('before', before);
        return `/api/os/mail/threads?${p.toString()}`;
    }, [selection, search]);

    const loadMore = async () => {
        const last = threads?.at(-1);
        if (!last) return;
        setLoadingMore(true);
        const res = await api<{ threads: ThreadSummary[] }>(threadUrl(last.date));
        setLoadingMore(false);
        if (!res.ok) return setError(res.error);
        setThreads((cur) => [...(cur ?? []), ...res.data.threads]);
        setHasMore(res.data.threads.length >= PAGE);
    };

    // Accounts and counts, and the conversation list: fetched inside the effects, refetched when `tick` changes.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await api<{ accounts: Account[]; counts: Counts; googleConfigured: boolean }>('/api/os/mail/accounts');
            if (cancelled) return;
            if (!res.ok) {
                if (/managers/i.test(res.error)) setForbidden(true);
                else setError(res.error);
                return;
            }
            setAccounts(res.data.accounts);
            setCounts(res.data.counts);
            setGoogleConfigured(res.data.googleConfigured);
        })();
        return () => { cancelled = true; };
    }, [tick]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await api<{ threads: ThreadSummary[] }>(threadUrl());
            if (cancelled) return;
            if (!res.ok) return setError(res.error);
            setThreads(res.data.threads);
            setHasMore(res.data.threads.length >= PAGE);
            setError(null);
        })();
        return () => { cancelled = true; };
    }, [threadUrl, tick]);

    useEffect(() => {
        const t = window.setTimeout(() => { setSearch(query.trim()); setThreads(null); }, 350);
        return () => window.clearTimeout(t);
    }, [query]);
    // New mail arrives through the 5-minute background sync; look again every minute while the window is open.
    useEffect(() => {
        const id = window.setInterval(refresh, 60_000);
        return () => window.clearInterval(id);
    }, [refresh]);

    const syncNow = async () => {
        setSyncing(true);
        const res = await post<{ synced: number; failed: string[] }>('/api/os/mail/sync', {});
        setSyncing(false);
        if (!res.ok) setError(res.error);
        else if (res.data.failed.length) setError(res.data.failed[0]);
        refresh();
    };

    const star = async (t: ThreadSummary) => {
        setThreads((cur) => cur?.map((x) => (x.id === t.id ? { ...x, starred: !x.starred } : x)) ?? cur);
        const res = await post('/api/os/mail/actions', { accountId: t.accountId, threadId: t.threadId, action: t.starred ? 'unstar' : 'star' });
        if (!res.ok) { setError(res.error); refresh(); }
    };

    if (forbidden) return <div className="p-4 text-sm text-text-secondary">Mail is available to managers and administrators.</div>;
    if (!accounts) return <div className="p-4 text-sm text-text-secondary">{error ?? 'Loading…'}</div>;

    return (
        <div className="h-full flex min-h-0 text-text-primary">
            <Sidebar
                accounts={accounts}
                counts={counts}
                selection={selection}
                onSelect={(next) => { setSelection((s) => ({ ...s, ...next })); setThreads(null); setSelected(null); }}
                onCompose={() => { setComposing(true); setSelected(null); }}
                onSync={() => void syncNow()}
                syncing={syncing}
                googleConfigured={googleConfigured}
                onChanged={refresh}
            />
            <div className={`${selected || composing ? 'w-80 hidden md:flex' : 'flex-1'} shrink-0 border-r border-border flex-col min-h-0 flex`}>
                <div className="p-2 border-b border-border">
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all mail…" aria-label="Search mail" className="h-8 w-full px-2 rounded border border-border bg-background-elevated text-[13px]" />
                </div>
                {error ? <p className="px-3 py-1.5 text-xs text-amber-400 border-b border-border">{error}</p> : null}
                {!accounts.length ? (
                    <div className="p-4 text-sm text-text-secondary space-y-2">
                        <p>No mailboxes are connected yet.</p>
                        {googleConfigured ? <a href="/api/os/mail/google/start" className="inline-block h-8 leading-8 px-3 rounded bg-primary text-white text-[13px]">Connect a Gmail mailbox</a> : <p className="text-amber-400">Google sign-in is not configured on the server.</p>}
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto">
                        <ThreadList
                            threads={threads}
                            accounts={accounts}
                            selectedId={selected?.id ?? null}
                            onSelect={(t) => { setSelected(t); setComposing(false); }}
                            onStar={(t) => void star(t)}
                            loading={loadingMore}
                            onMore={() => void loadMore()}
                            hasMore={hasMore}
                            empty={search ? 'No conversations match that search.' : EMPTY[selection.view]}
                        />
                    </div>
                )}
            </div>
            {selected ? (
                <Reader
                    key={`${selected.accountId}:${selected.threadId}`}
                    thread={selected}
                    accounts={accounts}
                    onChanged={() => refresh()}
                    onClose={() => setSelected(null)}
                    aiTools={(ctx) => <MailAiTools {...ctx} />}
                />
            ) : composing ? (
                <section className="flex-1 min-w-0 p-4 overflow-y-auto" aria-label="New message">
                    <h2 className="text-base font-semibold mb-2">New message</h2>
                    <Composer accounts={accounts} init={{ accountId: selection.accountId ?? accounts.find((a) => !a.needsReauth)?.id ?? accounts[0].id, to: '', subject: '', text: '' }} onCancel={() => setComposing(false)} onSent={() => { setComposing(false); refresh(); }} />
                </section>
            ) : (
                <div className="flex-1 hidden md:flex items-center justify-center text-sm text-text-secondary">Select a conversation</div>
            )}
        </div>
    );
}
