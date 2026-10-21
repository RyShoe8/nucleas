'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MailboxView, WatchView } from '@/lib/watches/types-client';
import WatchForm from './WatchForm';
import WatchFeed from './WatchFeed';

const ago = (iso: string | null) => {
    if (!iso) return 'never scanned';
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    return minutes < 60 ? `scanned ${minutes} min ago` : minutes < 1440 ? `scanned ${Math.round(minutes / 60)} h ago` : `scanned ${Math.round(minutes / 1440)} d ago`;
};

/** Watches: pick a mailbox, say what to flag, and see the emails that qualify. */
export default function WatchesPanel({ initialWatchId }: { initialWatchId?: string } = {}) {
    const [watches, setWatches] = useState<WatchView[] | null>(null);
    const [mailboxes, setMailboxes] = useState<MailboxView[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<WatchView | 'new' | null>(null);
    const [selected, setSelected] = useState<string | null>(initialWatchId ?? null);
    const openedInitial = useRef(false);
    const [reload, setReload] = useState(0);
    const refresh = useCallback(() => setReload((n) => n + 1), []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch('/api/os/content/watches', { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as { watches?: WatchView[]; mailboxes?: MailboxView[]; error?: string };
            if (cancelled) return;
            if (!res.ok) return setError(body.error ?? `Failed (${res.status})`);
            setError(null);
            setWatches(body.watches ?? []);
            setMailboxes(body.mailboxes ?? []);
            if (initialWatchId && !openedInitial.current) {
                const watch = body.watches?.find((entry) => entry.id === initialWatchId);
                if (watch) {
                    setSelected(watch.id);
                    setEditing(watch);
                }
                openedInitial.current = true;
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [reload, initialWatchId]);

    const act = async (url: string, init: RequestInit) => {
        const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
        else setError(null);
        refresh();
    };

    if (error && !watches) return <p className="p-4 text-sm text-red-400">{error}</p>;
    if (!watches) return <p className="p-4 text-sm text-text-secondary">Loading…</p>;

    const current = watches.find((w) => w.id === selected) ?? null;
    return (
        <div className="space-y-4 p-3">
            <section className="space-y-2">
                <div className="flex items-center gap-2">
                    <h3 className="ui-kicker flex-1">Mailboxes</h3>
                    <a href="/api/os/content/gmail/start" className="ui-button">Connect Gmail</a>
                </div>
                {mailboxes.length === 0 ? (
                    <p className="text-sm text-text-secondary">Connect a Gmail address to watch. Nucleas only gets read access, and the sign-in is separate from your Mail window.</p>
                ) : (
                    <ul className="space-y-1">
                        {mailboxes.map((m) => (
                            <li key={m.id} className="flex flex-wrap items-center gap-x-2 text-sm">
                                <span className={`h-2 w-2 rounded-full ${m.status === 'connected' ? 'bg-emerald-400' : 'bg-red-400'}`} aria-hidden />
                                <span className="min-w-0 flex-1 break-all">{m.emailAddress}</span>
                                {m.status === 'needs_reauth' ? <a className="touch-link text-xs text-primary" href={`/api/os/content/gmail/start?email=${encodeURIComponent(m.emailAddress)}`}>Reconnect</a> : null}
                                <span className="text-[11px] text-text-secondary">{m.watchCount} watch{m.watchCount === 1 ? '' : 'es'}</span>
                                <button type="button" className="touch-link text-[11px] text-text-secondary disabled:no-underline disabled:opacity-40" disabled={m.watchCount > 0} title={m.watchCount > 0 ? 'Remove its watches first' : 'Remove this mailbox'} onClick={() => window.confirm(`Remove ${m.emailAddress} and the emails stored from it?`) && void act(`/api/os/content/mailboxes/${m.id}`, { method: 'DELETE' })}>Remove</button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}

            <section className="space-y-2">
                <div className="flex items-center gap-2">
                    <h3 className="ui-kicker flex-1">Watches</h3>
                    {editing === null ? <button type="button" className="ui-button-primary" disabled={mailboxes.length === 0} title={mailboxes.length === 0 ? 'Connect a mailbox first' : undefined} onClick={() => setEditing('new')}>New watch</button> : null}
                </div>
                {editing ? (
                    <WatchForm
                        key={editing === 'new' ? 'new' : editing.id}
                        watch={editing === 'new' ? undefined : editing}
                        mailboxes={mailboxes}
                        onCancel={() => setEditing(null)}
                        onSaved={(w) => {
                            setEditing(null);
                            setSelected(w.id);
                            refresh();
                            window.dispatchEvent(new Event('nucleas:jobs-changed'));
                        }}
                    />
                ) : null}
                {watches.length === 0 && !editing ? <p className="text-sm text-text-secondary">No watches yet. A watch looks through a mailbox for the emails you care about and flags the ones that qualify.</p> : null}
                <ul className="space-y-2">
                    {watches.map((w) => (
                        <li key={w.id} className={`ui-card p-3 ${selected === w.id ? 'border-primary' : ''}`}>
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
                                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(selected === w.id ? null : w.id)}>
                                    <span className="block break-words text-sm font-medium">{w.name}{!w.active ? <span className="ml-2 text-[11px] text-text-secondary">paused</span> : null}</span>
                                    <span className="block break-words text-[11px] text-text-secondary">{w.mailboxEmail} · {w.rank === 'discount' ? `offers ≥ ${w.minDiscountPct}%` : `fit ≥ ${w.threshold}`}{w.fields.length ? ` · ${w.fields.length} field${w.fields.length === 1 ? '' : 's'}` : ''}{w.companyName ? ` · for ${w.companyName}` : ''}{w.digest.enabled ? ` · ${w.digest.cadence} digest` : ''}</span>
                                    <span className="block text-[11px] text-text-secondary">{ago(w.lastScanAt)} · {w.flaggedCount} flagged of {w.scannedCount}</span>
                                </button>
                                <div className="flex shrink-0 gap-1 text-[11px]">
                                    <button type="button" className="touch-link" onClick={() => { setEditing(w); setSelected(w.id); }}>Change</button>
                                    <button type="button" className="touch-link" onClick={() => void act(`/api/os/content/watches/${w.id}`, { method: 'PATCH', body: JSON.stringify({ active: !w.active }) })}>{w.active ? 'Pause' : 'Resume'}</button>
                                    <button type="button" className="touch-link text-red-300" onClick={() => window.confirm(`Delete “${w.name}” and everything it collected?`) && void act(`/api/os/content/watches/${w.id}`, { method: 'DELETE' }).then(() => setSelected((s) => (s === w.id ? null : s)))}>Delete</button>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            </section>

            {current && !editing ? (
                <section className="space-y-2">
                    <h3 className="ui-kicker">{current.name}</h3>
                    <WatchFeed key={current.id} watch={current} onScanned={refresh} />
                </section>
            ) : null}
        </div>
    );
}
