'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import IdeChatMarkdown from '@/components/ide/IdeChatMarkdown';
import { getAssistantFocus, setAssistantFocus, subscribeAssistantFocus } from '@/lib/os/assistantFocus';

interface Turn {
    id: string;
    role: 'user' | 'assistant' | 'status';
    text: string;
    createdAt: string;
    actions?: { id: string; title: string; status: string; summary?: string; error?: string; companyName?: string }[];
    pending?: boolean;
    mode?: 'orchestrated' | 'direct';
    stages?: { stage: string; model?: string; free?: boolean; costMicros?: number | null; note?: string }[];
    costMicros?: number | null;
}

type AskMode = 'orchestrated' | 'direct';
type CostChoice = 'default' | 'low' | 'medium' | 'high';
const COST_KEY = 'nucleas.os.assistant.cost';

function readCost(): CostChoice {
    try {
        const v = window.localStorage.getItem(COST_KEY);
        return v === 'low' || v === 'medium' || v === 'high' ? v : 'default';
    } catch {
        return 'default';
    }
}
const MODE_KEY = 'nucleas.os.assistant.mode';

function readMode(): AskMode {
    try {
        return window.localStorage.getItem(MODE_KEY) === 'direct' ? 'direct' : 'orchestrated';
    } catch {
        return 'orchestrated';
    }
}

function usd(micros: number): string {
    const d = micros / 1_000_000;
    return d === 0 ? '$0' : d < 0.01 ? '<$0.01' : `$${d.toFixed(d < 1 ? 3 : 2)}`;
}

function shortModel(model?: string): string {
    return (model ?? '').split('/').pop()?.replace(/-(instruct|it|awq|fp8|qat).*$/i, '') ?? '';
}

/** "plan · sonnet $0.004 → fetch 3 jobs → write · gemma free → numbers ✓ → total $0.004" */
function StageLine({ turn }: { turn: Turn }) {
    if (!turn.stages?.length) return turn.costMicros != null ? <p className="mt-1 text-[10px] text-text-secondary">{usd(turn.costMicros)}</p> : null;
    const label: Record<string, string> = { plan: 'plan', fetch: 'fetch', research: 'research', work: 'write', check: 'numbers', review: 'review' };
    const parts = turn.stages.map((s) => {
        if (s.stage === 'fetch') return s.note ?? 'fetch';
        if (s.stage === 'check') return `numbers ${s.note?.startsWith('all') ? '✓' : '⚠'}`;
        const cost = s.free ? 'free' : s.costMicros != null ? usd(s.costMicros) : '';
        return `${label[s.stage] ?? s.stage} · ${shortModel(s.model)} ${cost}`.trim();
    });
    return (
        <p className="mt-1 text-[10px] text-text-secondary" title={turn.stages.map((s) => `${s.stage}: ${s.note ?? s.model ?? ''}`).join('\n')}>
            {parts.join(' → ')}
            {turn.costMicros != null ? ` · total ${usd(turn.costMicros)}` : ''}
        </p>
    );
}

interface ProviderModel {
    id: string;
    label: string;
    free: boolean;
    price: number | null;
    score: number | null;
    /** On the short list shown by default. */
    recommended: boolean;
}

interface Provider {
    profileId: string;
    label: string;
    models: ProviderModel[];
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

function modelOptionLabel(m: ProviderModel): string {
    const bits = [m.free ? 'free' : m.price !== null ? `$${m.price}/1M` : null, m.score !== null ? `score ${m.score.toFixed(0)}` : null].filter(Boolean);
    return bits.length ? `${m.id} · ${bits.join(' · ')}` : m.id;
}

const SHOW_ALL = '__show_all__';

/** Direct mode: choose a provider, then one of its strongest models (or any model it lists, on request). */
function DirectModelPicker({
    providers,
    value,
    onChange,
}: {
    providers: Provider[];
    value: { profileId: string; model: string } | null;
    onChange: (v: { profileId: string; model: string }) => void;
}) {
    const provider = providers.find((p) => p.profileId === value?.profileId) ?? null;
    const [showAll, setShowAll] = useState(false);
    const all = provider?.models ?? [];
    // The short list, plus the current choice so it never disappears from the menu.
    const shown = showAll ? all : all.filter((m) => m.recommended || m.id === value?.model);
    const hidden = all.length - shown.length;
    return (
        <span className="inline-flex items-center gap-1">
            <select
                value={provider?.profileId ?? ''}
                onChange={(e) => {
                    const next = providers.find((x) => x.profileId === e.target.value);
                    if (!next) return;
                    setShowAll(false);
                    onChange({ profileId: next.profileId, model: (next.models.find((m) => m.recommended) ?? next.models[0])?.id ?? '' });
                }}
                className="h-7 px-1 rounded border border-border bg-background-elevated text-xs max-w-[130px]"
                aria-label="Provider"
            >
                {providers.length === 0 ? <option value="">No models available</option> : null}
                {providers.map((p) => (
                    <option key={p.profileId} value={p.profileId}>
                        {p.label}
                    </option>
                ))}
            </select>
            <select
                value={value?.model ?? ''}
                onChange={(e) => {
                    if (e.target.value === SHOW_ALL) return setShowAll(true);
                    if (provider) onChange({ profileId: provider.profileId, model: e.target.value });
                }}
                disabled={!provider}
                className="h-7 px-1 rounded border border-border bg-background-elevated text-xs max-w-[240px]"
                aria-label="Model"
            >
                {shown.map((m) => (
                    <option key={m.id} value={m.id}>
                        {modelOptionLabel(m)}
                    </option>
                ))}
                {hidden > 0 ? <option value={SHOW_ALL}>Show all {all.length} models…</option> : null}
            </select>
        </span>
    );
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

/**
 * Portfolio-wide AI conversation. Works out which company a question is about; an optional focus
 * (set from a company window) is a starting point, not a limit.
 */
export default function AssistantModule() {
    const focus = useSyncExternalStore(subscribeAssistantFocus, getAssistantFocus, () => null);
    const [turns, setTurns] = useState<Turn[] | null>(null);
    const [providers, setProviders] = useState<Provider[]>([]);
    const [selection, setSelection] = useState<{ profileId: string; model: string } | null>(null);
    const [mode, setMode] = useState<AskMode>('orchestrated');
    const [cost, setCost] = useState<CostChoice>('default');
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const endRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [historyRes, profilesRes] = await Promise.all([
                fetch('/api/os/assistant'),
                fetch('/api/os/ai-models', { cache: 'no-store' }),
            ]);
            const history = (await historyRes.json().catch(() => ({}))) as { turns?: Turn[] };
            const catalog = (await profilesRes.json().catch(() => ({}))) as { providers?: Provider[] };
            if (cancelled) return;
            setMode(readMode());
            setCost(readCost());
            setTurns(history.turns ?? []);
            const available = catalog.providers ?? [];
            setProviders(available);
            // Restore the saved choice only if that provider still lists the model.
            const stored = readSelection();
            const storedProvider = available.find((p) => p.profileId === stored?.profileId);
            const chosen = storedProvider ?? available[0];
            if (chosen) {
                const keep = storedProvider && storedProvider.models.some((m) => m.id === stored?.model);
                setSelection({ profileId: chosen.profileId, model: keep ? stored!.model : (chosen.models[0]?.id ?? '') });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'end' });
    }, [turns]);

    const send = async (message: string) => {
        const trimmed = message.trim();
        if (!trimmed || busy || (mode === 'direct' && !selection)) return;
        setBusy(true);
        setError(null);
        setText('');
        const optimistic: Turn = { id: `local-${Date.now()}`, role: 'user', text: trimmed, createdAt: new Date().toISOString() };
        setTurns((t) => [...(t ?? []), optimistic, { id: 'pending', role: 'assistant', text: 'Looking into it…', createdAt: '', pending: true }]);
        try {
            const res = await fetch('/api/os/assistant', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    text: trimmed,
                    focusCompanyId: focus?.companyId,
                    mode,
                    ...(mode === 'orchestrated' && cost !== 'default' ? { level: cost } : {}),
                    ...(mode === 'direct' && selection ? { modelProfileId: selection.profileId, model: selection.model } : {}),
                }),
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

    const suggestions = focus
        ? [`How is ${focus.companyName} doing this week?`, 'What changed recently, and what might explain it?', 'What should we focus on next to grow?']
        : ['Which business had the best week, and why?', 'Where are we losing momentum?', 'What should I focus on today?'];

    return (
        <div className="h-full flex flex-col text-text-primary">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <div role="radiogroup" aria-label="Ask mode" className="inline-flex rounded border border-border overflow-hidden text-xs">
                    {(['orchestrated', 'direct'] as AskMode[]).map((m) => (
                        <button
                            key={m}
                            type="button"
                            role="radio"
                            aria-checked={mode === m}
                            title={m === 'orchestrated' ? 'Paid model plans, Rogly writes, paid model reviews when it matters' : 'One model you choose answers directly'}
                            onClick={() => {
                                setMode(m);
                                try {
                                    window.localStorage.setItem(MODE_KEY, m);
                                } catch {
                                    // Per-browser convenience only.
                                }
                            }}
                            className={`px-2 h-7 ${mode === m ? 'bg-primary text-white' : 'hover:bg-background-card'}`}
                        >
                            {m === 'orchestrated' ? 'Orchestrated' : 'Direct'}
                        </button>
                    ))}
                </div>
                {mode === 'orchestrated' ? (
                    <select
                        value={cost}
                        onChange={(e) => {
                            const v = e.target.value as CostChoice;
                            setCost(v);
                            try {
                                window.localStorage.setItem(COST_KEY, v);
                            } catch {
                                // Per-browser convenience only.
                            }
                        }}
                        title="Low: 3rd most powerful paid model plans and reviews, Rogly works. Medium: 2nd most powerful, paid retries. High: the most powerful paid model plans and reviews, the #3 paid model for the task does the work."
                        className="h-7 px-2 rounded border border-border bg-background-elevated text-xs"
                        aria-label="Cost level"
                    >
                        <option value="default">Cost: default</option>
                        <option value="low">Cost: low</option>
                        <option value="medium">Cost: medium</option>
                        <option value="high">Cost: high</option>
                    </select>
                ) : null}
                {mode === 'direct' ? (
                    <DirectModelPicker
                        providers={providers}
                        value={selection}
                        onChange={(next) => {
                            setSelection(next);
                            writeSelection(next);
                        }}
                    />
                ) : null}
                <span className="flex-1" />
                {focus ? (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border">
                        Focus: {focus.companyName}
                        <button type="button" onClick={() => setAssistantFocus(null)} aria-label="Clear focus" className="text-text-secondary hover:text-text-primary">
                            ×
                        </button>
                    </span>
                ) : (
                    <span className="text-[11px] text-text-secondary">All companies</span>
                )}
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {turns === null ? <p className="text-sm text-text-secondary">Loading…</p> : null}
                {turns?.length === 0 ? (
                    <div className="space-y-2">
                        <p className="text-sm text-text-secondary">
                            Ask about any of your businesses or clients. Nucleas works out which company you mean and answers from its stored metrics, connected systems, projects and recent actions.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {suggestions.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    disabled={!(mode === 'orchestrated' || selection) || busy}
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
                                            <span className="text-text-secondary">
                                                {a.companyName ? `${a.companyName}: ` : ''}
                                                {a.title}
                                            </span>
                                            <span className={ACTION_TONE[a.status] ?? 'text-text-secondary'}>{a.status.replace('_', ' ')}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                            {t.role !== 'user' && !t.pending ? <StageLine turn={t} /> : null}
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
                    placeholder={(mode === 'orchestrated' || selection) ? (focus ? `Ask about ${focus.companyName} or anything else…` : 'Ask about any business…') : 'Configure an AI credential in Admin → AI Settings first'}
                    rows={2}
                    disabled={!(mode === 'orchestrated' || selection)}
                    className="flex-1 min-w-0 px-2 py-1.5 rounded border border-border bg-background-elevated text-sm resize-none"
                />
                <button type="submit" disabled={busy || !text.trim() || !(mode === 'orchestrated' || selection)} className="px-3 rounded bg-primary text-white text-sm disabled:opacity-50">
                    {busy ? '…' : 'Ask'}
                </button>
            </form>
        </div>
    );
}
