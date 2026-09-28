'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import IdeChatMarkdown from '@/components/ide/IdeChatMarkdown';
import BuildCard, { type BuildView } from './building/BuildCard';
import AskComposer, { type AttachmentRef } from './assistant/AskComposer';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import {
    ChatModeSwitch,
    CostSelect,
    DirectModelPicker,
    levelParam,
    readCostChoice,
    readDirectSelection,
    resolveDirectSelection,
    useEngineProviders,
    writeDirectSelection,
    type ChatMode,
    type CostChoice,
    type DirectSelection,
} from '@/components/ai/EngineControls';
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
    /** A code change this answer proposed. */
    build?: BuildView | null;
    /** Files attached to a user message. */
    attachments?: { name: string; kind?: string; size: number; error?: string | null }[];
    /** While answering: what Nucleas has done so far, newest last. */
    progress?: string[];
    startedAt?: number;
}

const MODE_KEY = 'nucleas.os.assistant.mode';

function readMode(): ChatMode {
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

type AnswerBody = { turn?: Turn; actions?: Turn['actions']; error?: string };

/** Reads the NDJSON answer stream (progress lines, then the reply); falls back to plain JSON. */
async function readAnswerStream(res: Response, onProgress: (text: string) => void): Promise<AnswerBody> {
    if (!(res.headers.get('content-type') ?? '').includes('ndjson') || !res.body) {
        return (await res.json().catch(() => ({}))) as AnswerBody;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: AnswerBody = { error: 'The answer stream ended early. Try again.' };
    const handle = (line: string) => {
        if (!line.trim()) return;
        try {
            const event = JSON.parse(line) as { type: string; text?: string; error?: string } & AnswerBody;
            if (event.type === 'progress' && event.text) onProgress(event.text);
            else if (event.type === 'reply') result = { turn: event.turn, actions: event.actions };
            else if (event.type === 'error') result = { error: event.error };
        } catch {
            // Ignore a malformed line.
        }
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
            handle(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf('\n');
        }
    }
    handle(buffer);
    return result;
}

/** What Nucleas is doing right now, the steps before it, and how long it has been working. */
function PendingProgress({ turn }: { turn: Turn }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    const steps = turn.progress ?? [];
    const done = steps.slice(0, -1).slice(-5);
    const seconds = turn.startedAt ? Math.max(0, Math.round((now - turn.startedAt) / 1000)) : 0;
    return (
        <div className="space-y-1">
            {done.length ? (
                <ul className="space-y-0.5 text-[11px] text-text-secondary">
                    {done.map((s, i) => (
                        <li key={`${i}-${s}`} className="truncate" title={s}>
                            ✓ {s}
                        </li>
                    ))}
                </ul>
            ) : null}
            <p className="flex items-center gap-2 text-sm text-text-primary">
                <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse flex-shrink-0" aria-hidden />
                <span className="min-w-0">{turn.text}</span>
                <span className="ml-auto text-[10px] text-text-secondary tabular-nums flex-shrink-0">
                    {seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}
                </span>
            </p>
        </div>
    );
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

const SELECTION_KEY = 'nucleas.os.assistant.model';

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
    const wm = useWindowManager();
    const [turns, setTurns] = useState<Turn[] | null>(null);
    const { providers } = useEngineProviders();
    const [storedSelection, setStoredSelection] = useState<DirectSelection | null>(null);
    const [mode, setMode] = useState<ChatMode>('orchestrated');
    const [cost, setCost] = useState<CostChoice>('default');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const endRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const historyRes = await fetch('/api/os/assistant');
            const history = (await historyRes.json().catch(() => ({}))) as { turns?: Turn[] };
            if (cancelled) return;
            setMode(readMode());
            setCost(readCostChoice());
            setStoredSelection(readDirectSelection(SELECTION_KEY));
            setTurns(history.turns ?? []);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // The saved Direct choice, if its provider still lists the model; otherwise the strongest available.
    const selection = resolveDirectSelection(providers, storedSelection);

    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'end' });
    }, [turns]);

    const send = async (message: string, attachments: AttachmentRef[] = []): Promise<boolean> => {
        const trimmed = message.trim();
        if ((!trimmed && !attachments.length) || busy || (mode === 'direct' && !selection)) return false;
        setBusy(true);
        setError(null);
        const optimistic: Turn = {
            id: `local-${Date.now()}`,
            role: 'user',
            text: trimmed || 'Please look at the attached file(s).',
            createdAt: new Date().toISOString(),
            attachments: attachments.map((a) => ({ name: a.name, size: a.size })),
        };
        setTurns((t) => [...(t ?? []), optimistic, { id: 'pending', role: 'assistant', text: 'Starting…', createdAt: '', pending: true, progress: [], startedAt: Date.now() }]);
        try {
            const res = await fetch('/api/os/assistant', {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
                body: JSON.stringify({
                    text: trimmed,
                    focusCompanyId: focus?.companyId,
                    mode,
                    ...(mode === 'orchestrated' ? levelParam(cost) : {}),
                    ...(mode === 'direct' && selection ? { modelProfileId: selection.profileId, model: selection.model } : {}),
                    ...(attachments.length ? { attachments } : {}),
                }),
            });
            // Progress arrives line by line while Nucleas works, then the reply.
            const body = await readAnswerStream(res, (text) =>
                setTurns((t) =>
                    (t ?? []).map((x) => (x.id === 'pending' ? { ...x, text, progress: [...(x.progress ?? []), text].slice(-12) } : x))
                )
            );
            if (!res.ok || !body.turn) {
                setError(body.error ?? `Failed (${res.status})`);
                setTurns((t) => (t ?? []).filter((x) => x.id !== 'pending'));
                return false;
            }
            const reply: Turn = { ...body.turn, actions: body.actions };
            setTurns((t) => [...(t ?? []).filter((x) => x.id !== 'pending'), reply]);
            return true;
        } catch {
            setError('The request did not reach Nucleas. Try again.');
            setTurns((t) => (t ?? []).filter((x) => x.id !== 'pending'));
            return false;
        } finally {
            setBusy(false);
        }
    };

    const suggestions = focus
        ? [`How is ${focus.companyName} doing this week?`, 'What changed recently, and what might explain it?', 'What should we focus on next to grow?']
        : ['Which business had the best week, and why?', 'Where are we losing momentum?', 'What should I focus on today?'];

    return (
        <div className="h-full flex flex-col text-text-primary">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <ChatModeSwitch
                    mode={mode}
                    onChange={(m) => {
                        setMode(m);
                        try {
                            window.localStorage.setItem(MODE_KEY, m);
                        } catch {
                            // Per-browser convenience only.
                        }
                    }}
                />
                {mode === 'orchestrated' ? <CostSelect value={cost} onChange={setCost} /> : null}
                {mode === 'direct' ? (
                    <DirectModelPicker
                        providers={providers}
                        value={selection}
                        onChange={(next) => {
                            setStoredSelection(next);
                            writeDirectSelection(SELECTION_KEY, next);
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
                            } ${t.pending ? 'min-w-[260px]' : ''}`}
                        >
                            {t.pending ? (
                                <PendingProgress turn={t} />
                            ) : t.role === 'assistant' ? (
                                <IdeChatMarkdown text={t.text} />
                            ) : (
                                <p className="whitespace-pre-wrap">{t.text}</p>
                            )}
                            {t.attachments?.length ? (
                                <ul className="mt-1.5 flex flex-wrap gap-1">
                                    {t.attachments.map((a, i) => (
                                        <li
                                            key={`${a.name}-${i}`}
                                            title={a.error ?? undefined}
                                            className={`text-[10px] px-1.5 py-0.5 rounded border ${a.error ? 'border-amber-400/50 text-amber-400' : 'border-border text-text-secondary'}`}
                                        >
                                            {a.kind === 'image' ? '🖼️' : '📄'} {a.name}
                                            {a.error ? ' · could not be read' : ''}
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
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
                            {t.build ? (
                                <div className="mt-2">
                                    <BuildCard
                                        build={t.build}
                                        compact
                                        onChange={(next) => setTurns((list) => (list ?? []).map((x) => (x.build?.id === next.id ? { ...x, build: next } : x)))}
                                        onOpenBuilding={() => wm.open('building')}
                                    />
                                </div>
                            ) : null}
                            {t.role !== 'user' && !t.pending ? <StageLine turn={t} /> : null}
                        </div>
                    </div>
                ))}
                <div ref={endRef} />
            </div>

            {error ? <p className="px-3 pb-1 text-xs text-red-400">{error}</p> : null}
            <AskComposer
                disabled={!(mode === 'orchestrated' || selection)}
                busy={busy}
                placeholder={(mode === 'orchestrated' || selection) ? (focus ? `Ask about ${focus.companyName} or anything else…` : 'Ask about any business… (drop files here to attach)') : 'Configure an AI credential in Admin → AI Settings first'}
                onSend={send}
            />
        </div>
    );
}
