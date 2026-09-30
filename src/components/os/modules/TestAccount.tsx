'use client';

import { useCallback, useEffect, useState } from 'react';

interface TestAccountView {
    configured: boolean;
    canManage: boolean;
    browserWorker: boolean;
    baseUrl: string | null;
    username: string | null;
    passwordHint: string | null;
    lastCheckedAt: string | null;
    lastCheckOk: boolean | null;
    lastCheckNote: string | null;
}

/**
 * A low-privilege login on the company's own site. When Ask plans a change to a page on that site,
 * Nucleas opens the page read-only with this account to see what it shows right now.
 */
export default function TestAccount({ companyId, defaultDomain }: { companyId: string; defaultDomain?: string }) {
    const [view, setView] = useState<TestAccountView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [baseUrl, setBaseUrl] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState<'save' | 'check' | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const reload = useCallback(() => setReloadKey((k) => k + 1), []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/companies/${companyId}/test-account`, { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as TestAccountView & { error?: string };
            if (cancelled) return;
            if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
            else {
                setView(body);
                setError(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId, reloadKey]);

    if (!view) return error ? <p className="text-xs text-red-400">{error}</p> : null;

    const startEditing = () => {
        setBaseUrl(view.baseUrl ?? (defaultDomain ? `https://${defaultDomain}` : ''));
        setUsername(view.username ?? '');
        setPassword('');
        setEditing(true);
    };

    const save = async () => {
        setBusy('save');
        setError(null);
        const res = await fetch(`/api/os/companies/${companyId}/test-account`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ baseUrl, username, ...(password ? { password } : {}) }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setBusy(null);
        if (!res.ok) return setError(body.error ?? `Failed (${res.status})`);
        setPassword('');
        setEditing(false);
        reload();
    };

    const check = async () => {
        setBusy('check');
        setError(null);
        const res = await fetch(`/api/os/companies/${companyId}/test-account`, { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setBusy(null);
        if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
        reload();
    };

    const remove = async () => {
        if (!window.confirm('Remove the test account? Plans will no longer look at the live page.')) return;
        const res = await fetch(`/api/os/companies/${companyId}/test-account`, { method: 'DELETE' });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return setError(body.error ?? `Failed (${res.status})`);
        reload();
    };

    return (
        <section>
            <h3 className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">Test account (live page)</h3>
            {!view.browserWorker ? <p className="text-xs text-amber-400 mb-1">The browser worker is not configured on the server, so the account cannot be used yet.</p> : null}
            <div className="rounded-md border border-border px-3 py-2 space-y-2">
                {view.configured && !editing ? (
                    <div className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 text-sm truncate">
                            {view.username} <span className="text-[11px] text-text-secondary">on {view.baseUrl} · password {view.passwordHint}</span>
                        </span>
                        {view.lastCheckedAt ? (
                            <span
                                title={view.lastCheckNote ?? undefined}
                                className={`text-[10px] px-1.5 py-0.5 rounded border ${view.lastCheckOk ? 'text-emerald-400 border-emerald-400/40' : 'text-amber-400 border-amber-400/40'}`}
                            >
                                {view.lastCheckOk ? 'Works' : 'Login failed'}
                            </span>
                        ) : null}
                        {view.canManage ? (
                            <>
                                <button type="button" disabled={busy !== null || !view.browserWorker} onClick={() => void check()} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card disabled:opacity-50">
                                    {busy === 'check' ? 'Testing…' : 'Test login'}
                                </button>
                                <button type="button" onClick={startEditing} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card">
                                    Change
                                </button>
                                <button type="button" onClick={() => void remove()} className="text-[11px] px-1.5 py-0.5 rounded border border-border hover:bg-background-card" aria-label="Remove test account" title="Remove">
                                    ✕
                                </button>
                            </>
                        ) : null}
                    </div>
                ) : null}
                {view.configured && view.lastCheckedAt && view.lastCheckNote && !editing ? <p className="text-[11px] text-text-secondary">{view.lastCheckNote}</p> : null}
                {!view.configured && !editing ? (
                    <div className="flex items-center gap-2">
                        <span className="flex-1 text-sm text-text-secondary">Not set up</span>
                        {view.canManage ? (
                            <button type="button" onClick={startEditing} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card">
                                Set up
                            </button>
                        ) : null}
                    </div>
                ) : null}
                {editing ? (
                    <div className="space-y-1">
                        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://example.com" aria-label="Site address" className="h-7 w-full px-2 rounded border border-border bg-background-elevated text-xs" />
                        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username or email" aria-label="Username" autoComplete="off" className="h-7 w-full px-2 rounded border border-border bg-background-elevated text-xs" />
                        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={view.configured ? 'New password (leave blank to keep)' : 'Password'} aria-label="Password" autoComplete="new-password" className="h-7 w-full px-2 rounded border border-border bg-background-elevated text-xs" />
                        <p className="text-[10px] text-text-secondary">
                            Use an account with the least access that can open the pages you ask about (read-only if the site has such a role). Nucleas signs in, only reads pages and never clicks or submits anything else. The password is stored encrypted and is never shown or sent to an AI model. Text near the names in your request from the page (with emails and long numbers masked) is shown to the planning models and saved in the plan.
                        </p>
                        <div className="flex gap-2">
                            <button type="button" disabled={busy !== null || !baseUrl || !username || (!view.configured && !password)} onClick={() => void save()} className="text-[11px] px-2 py-1 rounded bg-primary text-white disabled:opacity-50">
                                {busy === 'save' ? 'Saving…' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setEditing(false)} className="text-[11px] px-2 py-1 rounded border border-border">
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>
            {error ? <p className="text-xs text-red-400 mt-1">{error}</p> : null}
        </section>
    );
}
