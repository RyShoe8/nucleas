'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import IdeChatMarkdown from '@/components/ide/IdeChatMarkdown';
import type { ModuleRenderContext } from '@/lib/os/types';

interface Turn {
    id: string;
    role: 'user' | 'assistant' | 'status';
    text: string;
    createdAt: string;
    actions?: { id: string; title: string; status: string; summary?: string; error?: string }[];
    pending?: boolean;
}

interface Profile {
    id: string;
    label: string;
    model?: string | null;
}

const SELECTION_KEY = 'nucleas.os.assistant.model';

function readSelection(): { profileId: string; model: string } | null {
    try {
        const raw = window.localStorage.getItem(SELECTION_KEY);
        return raw ? (JSON.parse(raw) as { profileId: string; model: string }) : null;
    } catch {
        return null;
    }
}

function writeSelection(value: { profileId: string; model: string }) {
    try {
        window.localStorage.setItem(SELECTION_KEY, JSON.stringify(value));
    } catch {
        // Per-browser convenience only.
    }
}

const ACTION_TONE: Record<string, string> = {
    succeeded: 'text-emerald-400',
    verified: 'text-emerald-400',
    pending_approval: 'text-amber-400',
    needs_setup: 'text-amber-400',
    plan_limited: 'text-amber-400',
    needs_reauth: 'text-amber-400',
    failed: 'text-red-400',
};

/** Company-scoped AI conversation. Answers use stored metrics, live capabilities and receipts. */
export default function AssistantModule({ payload }: ModuleRenderContext) {
    const companyId = payload?.companyId ?? '';
    const companyName = payload?.companyName ?? 'this company';
    const [turns, setTurns] = useState<Turn[] | null>(null);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [selection, setSelection] = useState<{ profileId: string; model: string } | null>(null);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const endRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!companyId) return;
        let cancelled = false;
        void (async () => {
            const [historyRes, profilesRes] = await Promise.all([
                fetch(`/api/os/companies/${companyId}/assistant`),
                fetch('/api/ai/ide/free-chat/pipeline', { cache: 'no-store' }),
            ]);
            const history = (await historyRes.json().catch(() => ({}))) as { turns?: Turn[] };
            const pipeline = (await profilesRes.json().catch(() => ({}))) as { profiles?: Profile[] };
            if (cancelled) return;
            setTurns(history.turns ?? []);
            const available = (pipeline.profiles ?? []).filter((p) => p.model);
            setProfiles(available);
            const stored = readSelection();
            const chosen = available.find((p) => p.id === stored?.profileId) ?? available[0];
            if (chosen) setSelection({ profileId: chosen.id, model: stored?.profileId === chosen.id ? stored.model : (chosen.model ?? '') });
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'end' });
    }, [turns]);

    const send = async (message: string) => {
        const trimmed = message.trim();
        if (!trimmed || busy || !selection) return;
        setBusy(true);
        setError(null);
        setText('');
        const optimistic: Turn = { id: `local-${Date.now()}`, role: 'user', text: trimmed, createdAt: new Date().toISOString() };
        setTurns((t) => [...(t ?? []), optimistic, { id: 'pending', role: 'assistant', text: 'Looking into it…', createdAt: '', pending: true }]);
        try {
            const res = await fetch(`/api/os/companies/${companyId}/assistant`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ text: trimmed, modelProfileId: selection.profileId, model: selection.model }),
            });
            const body = (await res.json().catch(() => ({}))) as {
                turn?: Turn;
                actions?: Turn['actions'];
                error?: string;
            };
            if (!res.ok || !body.turn) {
                setError(body.error ?? `Failed (${res.status})`);
                setTurns((t) => (t ?? []).filter((x) => x.id !== 'pending'));
                return;
            }
            const reply: Turn = { ...body.turn, actions: body.actions };
            setTurns((t) => [...(t ?? []).filter((x) => x.id !== 'pending'), reply]);
        } finally {
            setBusy(false);
        }
    };

    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        void send(text);
    };

    if (!companyId) return <div className="p-4 text-sm text-text-secondary">Open the assistant from a company.</div>;

    const suggestions = [
        `How is ${companyName} doing this week?`,
        'What changed recently, and what might explain it?',
        'What should we focus on next to grow?',
    ];

    return (
        <div className="h-full flex flex-col text-text-primary">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <span className="text-xs text-text-secondary">Model</span>
                <select
                    value={selection ? `${selection.profileId}` : ''}
                    onChange={(e) => {
                        const p = profiles.find((x) => x.id === e.target.value);
                        if (!p) return;
                        const next = { profileId: p.id, model: p.model ?? '' };
                        setSelection(next);
                        writeSelection(next);
                    }}
                    className="h-7 px-2 rounded border border-border bg-background-elevated text-xs max-w-[260px]"
                    aria-label="AI model"
                >
                    {profiles.length === 0 ? <option value="">No AI credentials configured</option> : null}
                    {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.label} · {p.model}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {turns === null ? <p className="text-sm text-text-secondary">Loading…</p> : null}
                {turns?.length === 0 ? (
                    <div className="space-y-2">
                        <p className="text-sm text-text-secondary">
                            Ask about {companyName}. Answers use its stored metrics, connected systems, projects and recent actions.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {suggestions.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    disabled={!selection || busy}
                                    onClick={() => void send(s)}
                                    className="text-xs px-2 py-1 rounded border border-border hover:bg-background-card disabled:opacity-50"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}
                {turns?.map((t) => (
                    <div key={t.id} className={t.role === 'user' ? 'flex justify-end' : ''}>
                        <div
                            className={`rounded-lg px-3 py-2 text-sm max-w-[90%] ${
                                t.role === 'user'
                                    ? 'bg-primary/20 border border-primary/30'
                                    : t.role === 'status'
                                      ? 'border border-amber-400/40 text-amber-300'
                                      : 'border border-border'
                            } ${t.pending ? 'text-text-secondary animate-pulse' : ''}`}
                        >
                            {t.role === 'assistant' && !t.pending ? <IdeChatMarkdown text={t.text} /> : <p className="whitespace-pre-wrap">{t.text}</p>}
                            {t.actions?.length ? (
                                <ul className="mt-2 pt-2 border-t border-border space-y-0.5">
                                    {t.actions.map((a) => (
                                        <li key={a.id} className="text-[11px] flex gap-2">
                                            <span className="text-text-secondary">{a.title}</span>
                                            <span className={ACTION_TONE[a.status] ?? 'text-text-secondary'}>{a.status.replace('_', ' ')}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </div>
                    </div>
                ))}
                <div ref={endRef} />
            </div>

            {error ? <p className="px-3 pb-1 text-xs text-red-400">{error}</p> : null}
            <form onSubmit={onSubmit} className="flex gap-2 p-3 border-t border-border">
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void send(text);
                        }
                    }}
                    placeholder={selection ? `Ask about ${companyName}…` : 'Configure an AI credential in Admin → AI Settings first'}
                    rows={2}
                    disabled={!selection}
                    className="flex-1 min-w-0 px-2 py-1.5 rounded border border-border bg-background-elevated text-sm resize-none"
                />
                <button type="submit" disabled={busy || !text.trim() || !selection} className="px-3 rounded bg-primary text-white text-sm disabled:opacity-50">
                    {busy ? '…' : 'Ask'}
                </button>
            </form>
        </div>
    );
}
