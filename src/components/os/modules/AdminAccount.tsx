'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
 * A signed-in session on the company's own site: you log in inside a browser window shown here (2FA and SSO
 * work) and no password is stored. When Ask plans a change to a page on that site, Nucleas opens the page
 * read-only with the session to see what it shows right now.
 */
export default function AdminAccount({ companyId, defaultDomain }: { companyId: string; defaultDomain?: string }) {
    const [view, setView] = useState<AdminAccountView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [baseUrl, setBaseUrl] = useState('');
    const [login, setLogin] = useState<{ handle: string; width: number; height: number } | null>(null);
    const [pasting, setPasting] = useState(false);
    const [pasted, setPasted] = useState('');
    const [busy, setBusy] = useState<'start' | 'paste' | 'check' | null>(null);
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

    if (!view) return error ? <p className="text-xs text-red-400">{error}</p> : null;

    const start = () => {
        setBaseUrl(view.baseUrl ?? (defaultDomain ? `https://${defaultDomain}` : ''));
        setLogin(null);
        setPasting(false);
        setPasted('');
        setConnecting(true);
    };

    const put = async (payload: Record<string, unknown>) => {
        const res = await fetch(`/api/os/companies/${companyId}/admin-account`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        return { res, body: (await res.json().catch(() => ({}))) as { error?: string } };
    };

    const startLogin = async () => {
        setBusy('start');
        setError(null);
        const res = await fetch(`/api/os/companies/${companyId}/admin-account/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', baseUrl }) });
        const body = (await res.json().catch(() => ({}))) as { error?: string; handle?: string; width?: number; height?: number };
        setBusy(null);
        if (!res.ok || !body.handle) return setError(body.error ?? `Failed (${res.status})`);
        setLogin({ handle: body.handle, width: body.width ?? 1000, height: body.height ?? 640 });
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

    const isConnecting = connecting;
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
                        {!login && !pasting ? (
                            <div className="flex gap-2 items-center">
                                <button type="button" disabled={busy !== null || !baseUrl || !view.browserWorker} onClick={() => void startLogin()} className="text-[11px] px-2 py-1 rounded bg-primary text-white disabled:opacity-50">
                                    {busy === 'start' ? 'Opening…' : 'Log in here'}
                                </button>
                                <button type="button" onClick={() => setPasting(true)} className="text-[11px] underline text-text-secondary">
                                    Paste a session instead
                                </button>
                                <button type="button" onClick={() => setConnecting(false)} className="text-[11px] px-2 py-1 rounded border border-border">
                                    Cancel
                                </button>
                            </div>
                        ) : null}
                        {login ? (
                            <LoginWindow
                                companyId={companyId}
                                login={login}
                                onDone={() => { setLogin(null); setConnecting(false); reload(); }}
                                onCancel={() => setLogin(null)}
                                onError={setError}
                            />
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
                            No password is stored: you type it into the site\u2019s own login form. Only the session cookies are kept, encrypted, never shown again and never sent to an AI model; they stop working when the site expires them or you log out. Log in as the least-privileged user that can open the pages you will ask about: Nucleas only reads pages with it and blocks every write. Text near the names in your request from the page (emails and long numbers masked) is shown to the planning models and saved in the plan.
                        </p>
                    </div>
                ) : null}
            </div>
            {error ? <p className="text-xs text-red-400 mt-1">{error}</p> : null}
        </section>
    );
}

const TYPED_KEYS = new Set(['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

/** A browser running on the server, shown as screenshots; clicks and typing here go to it. */
function LoginWindow({ companyId, login, onDone, onCancel, onError }: { companyId: string; login: { handle: string; width: number; height: number }; onDone: () => void; onCancel: () => void; onError: (message: string | null) => void }) {
    const endpoint = `/api/os/companies/${companyId}/admin-account/login`;
    const [frame, setFrame] = useState<{ image: string; url: string; title: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const chain = useRef<Promise<unknown>>(Promise.resolve());
    const typed = useRef('');
    const flushTimer = useRef<number | null>(null);
    const inflight = useRef(false);
    const alive = useRef(true);

    const call = useCallback(async (payload: Record<string, unknown>) => {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: login.handle, ...payload }) });
        const body = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
        if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
        return body;
    }, [endpoint, login.handle]);

    const refresh = useCallback(async () => {
        if (inflight.current || !alive.current) return;
        inflight.current = true;
        try {
            const body = await call({ action: 'frame' });
            if (alive.current) setFrame(body as unknown as { image: string; url: string; title: string });
        } catch (error) {
            if (alive.current) onError(error instanceof Error ? error.message : 'The login window closed.');
        } finally {
            inflight.current = false;
        }
    }, [call, onError]);

    useEffect(() => {
        alive.current = true;
        let timer: number;
        const tick = async () => {
            await refresh();
            if (alive.current) timer = window.setTimeout(tick, 900);
        };
        void tick();
        return () => {
            alive.current = false;
            window.clearTimeout(timer);
            if (flushTimer.current) window.clearTimeout(flushTimer.current);
        };
    }, [refresh]);

    // Everything sent to the browser goes in order; typed characters are grouped so fast typing is not a request per key.
    const send = useCallback((input: Record<string, unknown>) => {
        chain.current = chain.current.then(() => call({ action: 'input', input })).then(() => refresh()).catch((error) => onError(error instanceof Error ? error.message : 'Could not send that.'));
    }, [call, refresh, onError]);
    const flush = useCallback(() => {
        if (flushTimer.current) window.clearTimeout(flushTimer.current);
        flushTimer.current = null;
        if (typed.current) {
            const text = typed.current;
            typed.current = '';
            send({ type: 'text', text });
        }
    }, [send]);
    const type = (text: string) => {
        typed.current += text;
        if (!flushTimer.current) flushTimer.current = window.setTimeout(flush, 120);
    };

    const finish = async () => {
        flush();
        setSaving(true);
        onError(null);
        try {
            await chain.current;
            await call({ action: 'finish' });
            onDone();
        } catch (error) {
            onError(error instanceof Error ? error.message : 'Could not save the session.');
            setSaving(false);
        }
    };
    const cancel = async () => {
        await call({ action: 'cancel' }).catch(() => undefined);
        onCancel();
    };

    return (
        <div className="space-y-1">
            <p className="text-[11px] text-text-secondary truncate">{frame ? `${frame.title || 'Page'} — ${frame.url}` : 'Opening the site…'}</p>
            <div
                tabIndex={0}
                role="application"
                aria-label="Login window: click a field, then type"
                className="rounded border border-border overflow-hidden outline-none focus:ring-1 focus:ring-primary cursor-pointer bg-background-elevated"
                onKeyDown={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                        if (e.key.toLowerCase() === 'a') { e.preventDefault(); flush(); send({ type: 'key', key: 'Control+a' }); }
                        return; // Ctrl/Cmd+V is handled by onPaste.
                    }
                    if (e.key.length === 1) { e.preventDefault(); type(e.key); return; }
                    if (TYPED_KEYS.has(e.key)) { e.preventDefault(); flush(); send({ type: 'key', key: e.key }); }
                }}
                onPaste={(e) => { e.preventDefault(); type(e.clipboardData.getData('text')); }}
                onWheel={(e) => send({ type: 'scroll', deltaY: e.deltaY })}
            >
                {frame ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={`data:image/jpeg;base64,${frame.image}`}
                        alt="The site's login page"
                        draggable={false}
                        className="w-full block select-none"
                        onClick={(e) => {
                            const box = e.currentTarget.getBoundingClientRect();
                            flush();
                            send({ type: 'click', x: ((e.clientX - box.left) / box.width) * login.width, y: ((e.clientY - box.top) / box.height) * login.height });
                            e.currentTarget.parentElement?.focus();
                        }}
                    />
                ) : (
                    <div className="h-40 flex items-center justify-center text-xs text-text-secondary">Loading…</div>
                )}
            </div>
            <p className="text-[10px] text-text-secondary">Click a field, then type. Log in as you normally would (2FA and SSO work). When you can see the signed-in site, press Save.</p>
            <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => void finish()} className="text-[11px] px-2 py-1 rounded bg-primary text-white disabled:opacity-50">
                    {saving ? 'Saving…' : 'I\u2019m logged in — save session'}
                </button>
                <button type="button" disabled={saving} onClick={() => void cancel()} className="text-[11px] px-2 py-1 rounded border border-border">
                    Cancel
                </button>
            </div>
        </div>
    );
}
