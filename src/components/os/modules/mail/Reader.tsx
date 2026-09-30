'use client';

import { useCallback, useEffect, useState } from 'react';
import Composer, { type ComposerInit } from './Composer';
import MessageBody from './MessageBody';
import { accountColor, api, displayName, post, type Account, type Bucket, type ThreadMessage, type ThreadSummary } from './types';

const MOVE_TARGETS: { bucket: Bucket; label: string }[] = [
    { bucket: 'normal', label: 'Inbox' },
    { bucket: 'updates', label: 'Updates' },
    { bucket: 'promotions', label: 'Promotions' },
    { bucket: 'suspicious', label: 'Suspicious' },
];

const fmtSize = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

export default function Reader({
    thread,
    accounts,
    onChanged,
    onClose,
    aiTools,
}: {
    thread: ThreadSummary;
    accounts: Account[];
    onChanged: (opts?: { removed?: boolean }) => void;
    onClose: () => void;
    /** AI help for this conversation (summary, draft). */
    aiTools?: (ctx: { thread: ThreadSummary; messages: ThreadMessage[]; draftInto: (text: string) => void }) => React.ReactNode;
}) {
    const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState<Set<string>>(new Set());
    const [replying, setReplying] = useState<ComposerInit | null>(null);
    const account = accounts.find((a) => a.id === thread.accountId);
    const triage = messages?.at(-1)?.triage ?? thread.triage;
    const filtered = triage && !['important', 'normal'].includes(triage.bucket);

    const load = useCallback(async () => {
        const res = await api<{ messages: ThreadMessage[] }>(`/api/os/mail/thread?accountId=${thread.accountId}&threadId=${encodeURIComponent(thread.threadId)}`);
        if (!res.ok) return setError(res.error);
        setMessages(res.data.messages);
        setOpen(new Set([res.data.messages.at(-1)?.id ?? '']));
        setError(null);
    }, [thread.accountId, thread.threadId]);

    // The parent keys this component by conversation, so each one starts fresh.
    useEffect(() => {
        void load();
    }, [load]);

    // Opening a conversation reads it.
    useEffect(() => {
        if (!thread.unread) return;
        void post('/api/os/mail/actions', { accountId: thread.accountId, threadId: thread.threadId, action: 'read' }).then(() => onChanged());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [thread.accountId, thread.threadId]);

    const act = async (action: string, extra: Record<string, unknown> = {}, removed = false) => {
        setError(null);
        const res = await post('/api/os/mail/actions', { accountId: thread.accountId, threadId: thread.threadId, action, ...extra });
        if (!res.ok) return setError(res.error);
        onChanged({ removed });
        if (removed) onClose();
    };

    const startReply = () => {
        const last = [...(messages ?? [])].reverse().find((m) => !m.sent) ?? messages?.at(-1);
        if (!last) return;
        setReplying({ accountId: thread.accountId, to: last.sent ? last.to.map((a) => a.email).join(', ') : last.from.email, subject: last.subject, text: '', replyToMessageId: last.id });
    };

    const btn = 'h-7 px-2 rounded border border-border text-[12px] hover:bg-background-card';
    return (
        <section className="flex-1 min-w-0 flex flex-col min-h-0" aria-label="Conversation">
            <header className="px-4 py-2 border-b border-border space-y-1.5">
                <div className="flex items-start gap-2">
                    <h2 className="flex-1 text-base font-semibold text-text-primary break-words">{thread.subject}</h2>
                    <button type="button" onClick={onClose} aria-label="Close conversation" className="text-text-secondary hover:text-text-primary">
                        ×
                    </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    {account ? (
                        <span className="inline-flex items-center gap-1 text-[11px] px-1.5 rounded border border-border text-text-secondary">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: accountColor(account, accounts) }} />
                            {account.label || account.emailAddress}
                            {account.companyName ? ` · ${account.companyName}` : ''}
                        </span>
                    ) : null}
                    <button type="button" className={btn} onClick={() => void act('archive', {}, true)}>Archive</button>
                    <button type="button" className={btn} onClick={() => void act('unread', {}, true)}>Mark unread</button>
                    <button type="button" className={btn} onClick={() => void act(thread.starred ? 'unstar' : 'star')}>{thread.starred ? '★ Starred' : '☆ Star'}</button>
                    <button type="button" className={btn} onClick={() => void act('trash', {}, true)}>Trash</button>
                    <button type="button" className={`${btn} text-amber-300`} title="Files it as spam in Gmail and blocks this sender" onClick={() => void act('spam', { scope: 'sender' }, true)}>Spam</button>
                    <button type="button" className={`${btn} text-amber-300`} title="Files it as spam and blocks everyone at this sender's domain" onClick={() => void act('spam', { scope: 'domain' }, true)}>Spam (whole domain)</button>
                    <select aria-label="Move to" value="" onChange={(e) => e.target.value && void act('move', { bucket: e.target.value }, true)} className="h-7 px-1 rounded border border-border bg-background-elevated text-[12px]">
                        <option value="">Move to…</option>
                        {MOVE_TARGETS.map((t) => (
                            <option key={t.bucket} value={t.bucket}>
                                {t.label}
                            </option>
                        ))}
                    </select>
                    {messages ? aiTools?.({ thread, messages, draftInto: (text) => { startReply(); setReplying((r) => (r ? { ...r, text } : r)); } }) : null}
                </div>
                {filtered && triage ? (
                    <div className={`rounded border px-2 py-1.5 text-[12px] flex flex-wrap items-center gap-2 ${triage.bucket === 'suspicious' ? 'border-amber-400/50 bg-amber-400/10 text-amber-200' : 'border-border bg-background-elevated text-text-secondary'}`}>
                        <span className="flex-1 min-w-0">
                            Filed under <b>{triage.bucket}</b>: {triage.reasons.slice(0, 3).join(' ') || 'the filter judged it not for the main inbox.'}
                        </span>
                        <button type="button" className={btn} onClick={() => void act('not_spam', { scope: 'sender' }, true)}>
                            Not spam: allow this sender
                        </button>
                        <button type="button" className={btn} onClick={() => void act('move', { bucket: 'normal' }, true)}>
                            Move to inbox
                        </button>
                    </div>
                ) : null}
                {error ? <p className="text-xs text-red-400">{error}</p> : null}
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {!messages ? <p className="text-sm text-text-secondary">Loading…</p> : null}
                {messages?.map((m) => {
                    const isOpen = open.has(m.id);
                    return (
                        <article key={m.id} className="rounded-md border border-border">
                            <button type="button" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} className="w-full flex items-baseline gap-2 px-3 py-2 text-left" aria-expanded={isOpen}>
                                <span className="text-[13px] font-medium text-text-primary truncate">{displayName(m.from)}</span>
                                {isOpen ? <span className="text-[11px] text-text-secondary truncate">&lt;{m.from.email}&gt;</span> : <span className="text-[12px] text-text-secondary truncate flex-1">{m.bodyText.slice(0, 120)}</span>}
                                <span className="ml-auto shrink-0 text-[11px] text-text-secondary">{new Date(m.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                            </button>
                            {isOpen ? (
                                <div className="px-3 pb-3 space-y-2">
                                    <p className="text-[11px] text-text-secondary">
                                        To: {m.to.map(displayName).join(', ') || '—'}
                                        {m.cc.length ? ` · Cc: ${m.cc.map(displayName).join(', ')}` : ''}
                                    </p>
                                    <MessageBody html={m.bodyHtml} text={m.bodyText} />
                                    {m.attachments.filter((a) => !a.inline).length ? (
                                        <ul className="flex flex-wrap gap-1.5 pt-1">
                                            {m.attachments.filter((a) => !a.inline).map((a) => (
                                                <li key={a.attachmentId}>
                                                    <a href={`/api/os/mail/attachments/${m.id}/${encodeURIComponent(a.attachmentId)}`} className="inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded border border-border hover:bg-background-card">
                                                        📎 {a.filename} <span className="text-text-secondary">{fmtSize(a.size)}</span>
                                                    </a>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}
                                </div>
                            ) : null}
                        </article>
                    );
                })}
                {messages ? (
                    replying ? (
                        <Composer
                            key={replying.replyToMessageId}
                            accounts={accounts}
                            init={replying}
                            onCancel={() => setReplying(null)}
                            onSent={() => { setReplying(null); void load(); onChanged(); }}
                            tools={(set) => aiTools?.({ thread, messages, draftInto: (text) => set({ text }) }) ?? null}
                        />
                    ) : (
                        <div className="flex gap-2">
                            <button type="button" onClick={startReply} className="h-8 px-4 rounded border border-border text-[13px] hover:bg-background-card">
                                ↩ Reply
                            </button>
                        </div>
                    )
                ) : null}
            </div>
        </section>
    );
}
