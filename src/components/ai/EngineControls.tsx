'use client';

import { useEffect, useState } from 'react';

/**
 * The controls every AI chat shares (Ask, IDE): Orchestrated with a cost level, or Direct with a
 * provider and model. Choices are per-browser conveniences kept in localStorage.
 */

export type ChatMode = 'orchestrated' | 'direct';
export type CostChoice = 'default' | 'free' | 'low' | 'medium' | 'high';

export interface ProviderModel {
    id: string;
    label: string;
    free: boolean;
    price: number | null;
    score: number | null;
    /** On the short list shown by default. */
    recommended: boolean;
}

export interface Provider {
    profileId: string;
    label: string;
    models: ProviderModel[];
}

export interface DirectSelection {
    profileId: string;
    model: string;
}

const COST_KEY = 'nucleas.ai.cost';

function storageGet(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function storageSet(key: string, value: string) {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // Per-browser convenience only.
    }
}

export function readCostChoice(): CostChoice {
    const v = storageGet(COST_KEY);
    return v === 'free' || v === 'low' || v === 'medium' || v === 'high' ? v : 'default';
}

export function writeCostChoice(v: CostChoice) {
    storageSet(COST_KEY, v);
}

/** The request field for a cost choice: omitted for the organization default. */
export function levelParam(cost: CostChoice): { level?: Exclude<CostChoice, 'default'> } {
    return cost === 'default' ? {} : { level: cost };
}

export function readDirectSelection(key: string): DirectSelection | null {
    const raw = storageGet(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<DirectSelection>;
        return typeof parsed.profileId === 'string' && typeof parsed.model === 'string' ? { profileId: parsed.profileId, model: parsed.model } : null;
    } catch {
        return null;
    }
}

export function writeDirectSelection(key: string, value: DirectSelection) {
    storageSet(key, JSON.stringify(value));
}

/** A saved choice if its provider still lists the model; otherwise the first provider's strongest model. */
export function resolveDirectSelection(providers: Provider[], stored: DirectSelection | null): DirectSelection | null {
    const storedProvider = providers.find((p) => p.profileId === stored?.profileId);
    if (storedProvider && stored && storedProvider.models.some((m) => m.id === stored.model)) return stored;
    const provider = storedProvider ?? providers[0];
    if (!provider) return null;
    const model = (provider.models.find((m) => m.recommended) ?? provider.models[0])?.id;
    return model ? { profileId: provider.profileId, model } : null;
}

/** Providers and the models each lists right now (enabled credentials only). */
export function useEngineProviders(): { providers: Provider[]; loaded: boolean } {
    const [state, setState] = useState<{ providers: Provider[]; loaded: boolean }>({ providers: [], loaded: false });
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch('/api/os/ai-models', { cache: 'no-store' }).catch(() => null);
            const body = (await res?.json().catch(() => ({}))) as { providers?: Provider[] } | undefined;
            if (!cancelled) setState({ providers: body?.providers ?? [], loaded: true });
        })();
        return () => {
            cancelled = true;
        };
    }, []);
    return state;
}

const CONTROL = 'h-7 px-1 rounded border border-border bg-background-elevated text-xs';

export function ChatModeSwitch({ mode, onChange, allowOrchestrated = true }: { mode: ChatMode; onChange: (m: ChatMode) => void; allowOrchestrated?: boolean }) {
    const modes: ChatMode[] = allowOrchestrated ? ['orchestrated', 'direct'] : ['direct'];
    return (
        <div role="radiogroup" aria-label="Chat mode" className="inline-flex rounded border border-border overflow-hidden text-xs">
            {modes.map((m) => (
                <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    title={m === 'orchestrated' ? 'The AI engine picks the best model for each step at the chosen cost level' : 'One model you choose answers directly'}
                    onClick={() => onChange(m)}
                    className={`px-2 h-7 ${mode === m ? 'bg-primary text-white' : 'hover:bg-background-card'}`}
                >
                    {m === 'orchestrated' ? 'Orchestrated' : 'Direct'}
                </button>
            ))}
        </div>
    );
}

export function CostSelect({ value, onChange, disabled }: { value: CostChoice; onChange: (v: CostChoice) => void; disabled?: boolean }) {
    return (
        <select
            value={value}
            disabled={disabled}
            onChange={(e) => {
                const v = e.target.value as CostChoice;
                writeCostChoice(v);
                onChange(v);
            }}
            title="Free uses only Rogly models. The other levels use the best-scoring model under their price ceiling (set by admins in the AI Engine window)."
            className={`${CONTROL} px-2`}
            aria-label="Cost level"
        >
            <option value="default">Cost: default</option>
            <option value="free">Cost: free (Rogly only)</option>
            <option value="low">Cost: low</option>
            <option value="medium">Cost: medium</option>
            <option value="high">Cost: high</option>
        </select>
    );
}

function modelOptionLabel(m: ProviderModel): string {
    const bits = [m.free ? 'free' : m.price !== null ? `$${m.price}/1M` : null, m.score !== null ? `score ${m.score.toFixed(0)}` : null].filter(Boolean);
    return bits.length ? `${m.id} · ${bits.join(' · ')}` : m.id;
}

const SHOW_ALL = '__show_all__';

/** Direct mode: choose a provider, then one of its strongest models (or any model it lists, on request). */
export function DirectModelPicker({
    providers,
    value,
    onChange,
    disabled,
}: {
    providers: Provider[];
    value: DirectSelection | null;
    onChange: (v: DirectSelection) => void;
    disabled?: boolean;
}) {
    const provider = providers.find((p) => p.profileId === value?.profileId) ?? null;
    const [showAll, setShowAll] = useState(false);
    const all = provider?.models ?? [];
    // The short list, plus the current choice so it never disappears from the menu.
    const shown = showAll ? all : all.filter((m) => m.recommended || m.id === value?.model);
    const hidden = all.length - shown.length;
    return (
        <span className="inline-flex items-center gap-1 min-w-0">
            <select
                value={provider?.profileId ?? ''}
                disabled={disabled}
                onChange={(e) => {
                    const next = providers.find((x) => x.profileId === e.target.value);
                    if (!next) return;
                    setShowAll(false);
                    onChange({ profileId: next.profileId, model: (next.models.find((m) => m.recommended) ?? next.models[0])?.id ?? '' });
                }}
                className={`${CONTROL} max-w-[130px]`}
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
                disabled={disabled || !provider}
                className={`${CONTROL} max-w-[240px] min-w-0`}
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
