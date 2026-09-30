'use client';

import { useCallback, useEffect, useState } from 'react';

interface AdminAccountView {
    configured: boolean;
    canManage: boolean;
    browserWorker: boolean;
    baseUrl: string | null;
    cookieCount: number;
    capturedAt: string | null;
    expiresAt: string | null;
    expired: boolean;
    lastCheckedAt: string | null;
    lastCheckOk: boolean | null;
    lastCheckNote: string | null;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

/**
 * A signed-in session on the company's own site, captured by you logging in (no password is stored).
 * When Ask plans a change to a page on that site, Nucleas opens the page read-only with the session to see
 * what it shows right now.
 */
export default function AdminAccount({ companyId, defaultDomain }: { companyId: string; defaultDomain?: string }) {
    const [view, setView] = useState<AdminAccountView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [baseUrl, setBaseUrl] = useState('');
    const [capture, setCapture] = useState<{ code: string; expiresAt: string; startedAt: number } | null>(null);
    const [pasting, setPasting] = useState(false);
    const [pasted, setPasted] = useState('');
    const [busy, setBusy] = useState<'code' | 'paste' | 'check' | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const reload = useCallback(() => setReloadKey((k) => k + 1), []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/companies/${companyId}/admin-account`, { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as AdminAccountView & { error?: string };
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

    // While a capture code is showing, watch for the script's upload.
    const arrived = Boolean(capture && view?.configured && view.capturedAt && new Date(view.capturedAt).getTime() > capture.startedAt);
    const waiting = Boolean(capture) && !arrived;
    useEffect(() => {
        if (!waiting) return;
        const timer = window.setInterval(reload, 4000);
        return () => window.clearInterval(timer);
    }, [waiting, reload]);

    if (!view) return error ? <p className="text-xs text-red-400">{error}</p> : null;

    const start = () => {
        setBaseUrl(view.baseUrl ?? (defaultDomain ? `https://${defaultDomain}` : ''));
        setCapture(null);
        setPasting(false);
        setPasted('');
        setConnecting(true);
    };

    const put = async (payload: Record<string, unknown>) => {
        const res = await fetch(`/api/os/companies/${companyId}/admin-account`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        return { res, body: (await res.json().catch(() => ({}))) as { error?: string; code?: string; expiresAt?: string } };
    };

    const getCode = async () => {
        setBusy('code');
        setError(null);
        const { res, body } = await put({ baseUrl });
        setBusy(null);
        if (!res.ok || !body.code) return setError(body.error ?? `Failed (${res.status})`);
        setCapture({ code: body.code, expiresAt: body.expiresAt ?? '', startedAt: Date.now() });
    };

    const savePasted = async () => {
        setBusy('paste');
        setError(null);
        const { res, body } = await put({ baseUrl, session: pasted });
        setBusy(null);
        if (!res.ok) return setError(body.error ?? `Failed (${res.status})`);
        setPasted('');
        setConnecting(false);
        reload();
    };

    const check = async () => {
        setBusy('check');
        setError(null);
        const res = await fetch(`/api/os/companies/${companyId}/admin-account`, { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setBusy(null);
        if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
        reload();
    };

    const remove = async () => {
        if (!window.confirm('Remove the admin account session? Plans will no longer look at the live page.')) return;
        const res = await fetch(`/api/os/companies/${companyId}/admin-account`, { method: 'DELETE' });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return setError(body.error ?? `Failed (${res.status})`);
        reload();
    };

    const activeCapture = waiting ? capture : null;
    const isConnecting = connecting && !arrived;
    const command = activeCapture && capture ? `npx tsx scripts/capture-admin-session.ts --site ${baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`} --server ${window.location.origin} --code ${capture.code}` : '';
    const state = !view.configured ? null : view.expired ? { label: 'Expired', ok: false } : view.lastCheckedAt ? { label: view.lastCheckOk ? 'Signed in' : 'Signed out', ok: Boolean(view.lastCheckOk) } : { label: 'Captured', ok: true };

    return (
        <section>
            <h3 className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">Admin account (live page)</h3>
            {!view.browserWorker ? <p className="text-xs text-amber-400 mb-1">The browser worker is not configured on the server, so the session cannot be used yet.</p> : null}
            <div className="rounded-md border border-border px-3 py-2 space-y-2">
                {view.configured && !isConnecting ? (
                    <div className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 text-sm truncate">
                            {view.baseUrl} <span className="text-[11px] text-text-secondary">· captured {when(view.capturedAt)}{view.expiresAt ? ` · expires ${when(view.expiresAt)}` : ''}</span>
                        </span>
                        {state ? (
                            <span title={view.lastCheckNote ?? undefined} className={`text-[10px] px-1.5 py-0.5 rounded border ${state.ok ? 'text-emerald-400 border-emerald-400/40' : 'text-amber-400 border-amber-400/40'}`}>
                                {state.label}
                            </span>
                        ) : null}
                        {view.canManage ? (
                            <>
                                <button type="button" disabled={busy !== null || !view.browserWorker} onClick={() => void check()} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card disabled:opacity-50">
                                    {busy === 'check' ? 'Checking…' : 'Check session'}
                                </button>
                                <button type="button" onClick={start} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card">
                                    Reconnect
                                </button>
                                <button type="button" onClick={() => void remove()} className="text-[11px] px-1.5 py-0.5 rounded border border-border hover:bg-background-card" aria-label="Remove admin account" title="Remove">
                                    ✕
                                </button>
                            </>
                        ) : null}
                    </div>
                ) : null}
                {view.configured && view.lastCheckNote && !isConnecting ? <p className="text-[11px] text-text-secondary">{view.lastCheckNote}</p> : null}
                {!view.configured && !isConnecting ? (
                    <div className="flex items-center gap-2">
                        <span className="flex-1 text-sm text-text-secondary">Not connected</span>
                        {view.canManage ? (
                            <button type="button" onClick={start} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card">
                                Connect
                            </button>
                        ) : null}
                    </div>
                ) : null}
                {isConnecting ? (
                    <div className="space-y-2">
                        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://example.com" aria-label="Site address" className="h-7 w-full px-2 rounded border border-border bg-background-elevated text-xs" />
                        {!activeCapture && !pasting ? (
                            <div className="flex gap-2 items-center">
                                <button type="button" disabled={busy !== null || !baseUrl} onClick={() => void getCode()} className="text-[11px] px-2 py-1 rounded bg-primary text-white disabled:opacity-50">
                                    {busy === 'code' ? 'Working…' : 'Log in and capture'}
                                </button>
                                <button type="button" onClick={() => setPasting(true)} className="text-[11px] underline text-text-secondary">
                                    Paste a session instead
                                </button>
                                <button type="button" onClick={() => setConnecting(false)} className="text-[11px] px-2 py-1 rounded border border-border">
                                    Cancel
                                </button>
                            </div>
                        ) : null}
                        {activeCapture ? (
                            <div className="space-y-1">
                                <p className="text-[11px] text-text-secondary">On your computer, in the Nucleas project folder, run this. A browser opens: log in to the site yourself (2FA and SSO work), return to the terminal and press Enter. This page updates when the session arrives. The code works once, for 15 minutes.</p>
                                <pre className="text-[11px] p-2 rounded border border-border bg-background-elevated whitespace-pre-wrap break-all select-all">{command}</pre>
                                <button type="button" onClick={() => { setCapture(null); setConnecting(false); }} className="text-[11px] px-2 py-1 rounded border border-border">
                                    Cancel
                                </button>
                            </div>
                        ) : null}
                        {pasting ? (
                            <div className="space-y-1">
                                <p className="text-[11px] text-text-secondary">Paste the cookies exported from a browser where you are logged in to this site (a Playwright storageState or a cookie-export extension&apos;s JSON). Cookies for other sites are discarded.</p>
                                <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} aria-label="Session JSON" placeholder='{"cookies":[…]}' className="w-full px-2 py-1 rounded border border-border bg-background-elevated text-[11px] font-mono" />
                                <div className="flex gap-2">
                                    <button type="button" disabled={busy !== null || !baseUrl || !pasted.trim()} onClick={() => void savePasted()} className="text-[11px] px-2 py-1 rounded bg-primary text-white disabled:opacity-50">
                                        {busy === 'paste' ? 'Saving…' : 'Save session'}
                                    </button>
                                    <button type="button" onClick={() => setPasting(false)} className="text-[11px] px-2 py-1 rounded border border-border">
                                        Back
                                    </button>
                                </div>
                            </div>
                        ) : null}
                        <p className="text-[10px] text-text-secondary">
                            No password is stored. The session cookies are encrypted, never shown again and never sent to an AI model; they stop working when the site expires them or you log out. Log in as the least-privileged user that can open the pages you will ask about: Nucleas only reads pages with it and blocks every write. Text near the names in your request from the page (emails and long numbers masked) is shown to the planning models and saved in the plan.
                        </p>
                    </div>
                ) : null}
            </div>
            {error ? <p className="text-xs text-red-400 mt-1">{error}</p> : null}
        </section>
    );
}
