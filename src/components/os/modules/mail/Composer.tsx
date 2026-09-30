'use client';

import { useState } from 'react';
import { accountColor, post, type Account } from './types';

export interface ComposerInit {
    accountId: string;
    to: string;
    cc?: string;
    subject: string;
    text: string;
    replyToMessageId?: string;
}

/** Compose a new message or reply. A reply is sent from the mailbox that received it, in the same conversation. */
export default function Composer({
    accounts,
    init,
    onSent,
    onCancel,
    tools,
}: {
    accounts: Account[];
    init: ComposerInit;
    onSent: () => void;
    onCancel: () => void;
    /** Extra controls for the header (AI help). */
    tools?: (set: (patch: Partial<ComposerInit>) => void, state: ComposerInit) => React.ReactNode;
}) {
    const [state, setState] = useState<ComposerInit>(init);
    const [showCc, setShowCc] = useState(Boolean(init.cc));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const reply = Boolean(init.replyToMessageId);
    const patch = (p: Partial<ComposerInit>) => setState((s) => ({ ...s, ...p }));
    const from = accounts.find((a) => a.id === state.accountId);

    const send = async () => {
        setBusy(true);
        setError(null);
        const res = await post<{ threadId: string }>('/api/os/mail/send', state);
        setBusy(false);
        if (!res.ok) return setError(res.error);
        onSent();
    };

    const field = 'h-7 w-full px-2 rounded border border-border bg-background-elevated text-[13px]';
    return (
        <div className="rounded-md border border-border bg-background p-2 space-y-1.5" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void send(); }}>
            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                <span className="w-10">From</span>
                {reply ? (
                    <span className="text-text-primary">{from?.label ? `${from.label} <${from.emailAddress}>` : from?.emailAddress}</span>
                ) : (
                    <select value={state.accountId} onChange={(e) => patch({ accountId: e.target.value })} aria-label="From" className={`${field} flex-1`} style={{ borderLeft: from ? `3px solid ${accountColor(from, accounts)}` : undefined }}>
                        {accounts.map((a) => (
                            <option key={a.id} value={a.id} disabled={a.needsReauth}>
                                {a.label ? `${a.label} <${a.emailAddress}>` : a.emailAddress}
                            </option>
                        ))}
                    </select>
                )}
                <span className="ml-auto flex gap-2">{tools?.(patch, state)}</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                <span className="w-10">To</span>
                <input value={state.to} onChange={(e) => patch({ to: e.target.value })} aria-label="To" placeholder="name@example.com, …" className={`${field} flex-1`} />
                {!showCc ? (
                    <button type="button" onClick={() => setShowCc(true)} className="text-[11px] underline">
                        Cc
                    </button>
                ) : null}
            </div>
            {showCc ? (
                <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                    <span className="w-10">Cc</span>
                    <input value={state.cc ?? ''} onChange={(e) => patch({ cc: e.target.value })} aria-label="Cc" className={`${field} flex-1`} />
                </div>
            ) : null}
            {!reply ? (
                <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                    <span className="w-10">Subject</span>
                    <input value={state.subject} onChange={(e) => patch({ subject: e.target.value })} aria-label="Subject" className={`${field} flex-1`} />
                </div>
            ) : null}
            <textarea value={state.text} onChange={(e) => patch({ text: e.target.value })} aria-label="Message" rows={reply ? 6 : 10} placeholder="Write your message…" className="w-full px-2 py-1.5 rounded border border-border bg-background-elevated text-[13px]" />
            {error ? <p className="text-xs text-red-400">{error}</p> : null}
            <div className="flex items-center gap-2">
                <button type="button" disabled={busy || !state.to.trim() || !state.text.trim()} onClick={() => void send()} className="h-7 px-3 rounded bg-primary text-white text-[13px] disabled:opacity-50">
                    {busy ? 'Sending…' : 'Send'}
                </button>
                <button type="button" onClick={onCancel} className="h-7 px-3 rounded border border-border text-[13px]">
                    Discard
                </button>
                <span className="ml-auto text-[11px] text-text-secondary">Ctrl+Enter to send</span>
            </div>
        </div>
    );
}
