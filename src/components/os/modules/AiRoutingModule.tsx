'use client';

import { useCallback, useEffect, useState } from 'react';

interface Choice {
    profileId: string;
    model: string;
    free: boolean;
    label: string;
}

interface RouteRow {
    key: string;
    label: string;
    description: string;
    preferredTier: 'paid' | 'free';
    primary: Choice | null;
    fallback: Choice | null;
    allowPaidFallback: boolean;
    source: 'assigned' | 'ai_team' | 'rogly_default' | 'unconfigured';
}

interface Profile {
    id: string;
    label: string;
}

const SOURCE_LABEL: Record<RouteRow['source'], string> = {
    assigned: 'Assigned',
    ai_team: 'From AI Team',
    rogly_default: 'Rogly default',
    unconfigured: 'Not configured',
};

function useModels(profileId: string) {
    const [models, setModels] = useState<string[]>([]);
    useEffect(() => {
        if (!profileId) return;
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/ai/ide/free-chat/models?profileId=${encodeURIComponent(profileId)}`, { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as { models?: { id: string }[] };
            if (!cancelled) setModels((body.models ?? []).map((m) => m.id));
        })();
        return () => {
            cancelled = true;
        };
    }, [profileId]);
    return models;
}

function ModelPicker({ profiles, value, onChange }: { profiles: Profile[]; value: { profileId: string; model: string }; onChange: (v: { profileId: string; model: string }) => void }) {
    const models = useModels(value.profileId);
    return (
        <span className="inline-flex gap-1">
            <select value={value.profileId} onChange={(e) => onChange({ profileId: e.target.value, model: '' })} className="h-7 px-1 rounded border border-border bg-background-elevated text-xs max-w-[150px]" aria-label="Credential">
                <option value="">Credential…</option>
                {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                        {p.label}
                    </option>
                ))}
            </select>
            <select value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })} className="h-7 px-1 rounded border border-border bg-background-elevated text-xs max-w-[230px]" aria-label="Model" disabled={!value.profileId}>
                <option value="">{value.profileId && models.length === 0 ? 'Loading models…' : 'Model…'}</option>
                {models.map((m) => (
                    <option key={m} value={m}>
                        {m}
                    </option>
                ))}
            </select>
        </span>
    );
}

function RouteEditor({ row, profiles, onSaved }: { row: RouteRow; profiles: Profile[]; onSaved: () => void }) {
    const [primary, setPrimary] = useState({ profileId: row.primary?.profileId ?? '', model: row.primary?.model ?? '' });
    const [fallback, setFallback] = useState({ profileId: row.fallback?.profileId ?? '', model: row.fallback?.model ?? '' });
    const [allowFallback, setAllowFallback] = useState(row.allowPaidFallback);
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        setError(null);
        const res = await fetch('/api/os/ai-routes', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                route: row.key,
                profileId: primary.profileId,
                model: primary.model,
                fallbackProfileId: fallback.profileId,
                fallbackModel: fallback.model,
                allowPaidFallback: allowFallback,
            }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
        else onSaved();
    };

    const reset = async () => {
        await fetch(`/api/os/ai-routes?route=${encodeURIComponent(row.key)}`, { method: 'DELETE' });
        onSaved();
    };

    return (
        <div className="mt-2 space-y-2 rounded border border-border p-2 bg-background-elevated">
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="w-16 text-text-secondary">Model</span>
                <ModelPicker profiles={profiles} value={primary} onChange={setPrimary} />
            </div>
            {row.preferredTier === 'free' ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="w-16 text-text-secondary">Fallback</span>
                    <ModelPicker profiles={profiles} value={fallback} onChange={setFallback} />
                    <label className="inline-flex items-center gap-1">
                        <input type="checkbox" checked={allowFallback} onChange={(e) => setAllowFallback(e.target.checked)} disabled={!fallback.model} />
                        Allow paid fallback when Rogly fails
                    </label>
                </div>
            ) : null}
            <div className="flex items-center gap-2">
                <button type="button" onClick={save} disabled={!primary.model} className="text-xs px-2 py-1 rounded bg-primary text-white disabled:opacity-50">
                    Save
                </button>
                {row.source === 'assigned' ? (
                    <button type="button" onClick={reset} className="text-xs px-2 py-1 rounded border border-border">
                        Reset to default
                    </button>
                ) : null}
                {error ? <span className="text-xs text-red-400">{error}</span> : null}
            </div>
        </div>
    );
}

/** Which model handles each kind of AI work (administrators). */
export default function AiRoutingModule() {
    const [routes, setRoutes] = useState<RouteRow[] | null>(null);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [editing, setEditing] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const reload = useCallback(() => setReloadKey((k) => k + 1), []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [routesRes, profilesRes] = await Promise.all([fetch('/api/os/ai-routes', { cache: 'no-store' }), fetch('/api/ai/ide/free-chat/pipeline', { cache: 'no-store' })]);
            const r = (await routesRes.json().catch(() => ({}))) as { routes?: RouteRow[]; error?: string };
            const p = (await profilesRes.json().catch(() => ({}))) as { profiles?: Profile[] };
            if (cancelled) return;
            if (!routesRes.ok) setError(r.error ?? `Failed (${routesRes.status})`);
            else setRoutes(r.routes ?? []);
            setProfiles(p.profiles ?? []);
        })();
        return () => {
            cancelled = true;
        };
    }, [reloadKey]);

    if (error) return <div className="p-4 text-sm text-red-400">{error}</div>;
    if (!routes) return <div className="p-4 text-sm text-text-secondary">Loading…</div>;

    return (
        <div className="h-full overflow-y-auto p-4 space-y-3 text-text-primary">
            <p className="text-xs text-text-secondary">
                Paid models plan and review; Rogly (free) does the volume. Unassigned routes inherit from AI Team, or use the default Rogly model.
            </p>
            <ul className="rounded-md border border-border divide-y divide-border">
                {routes.map((r) => {
                    const mismatch = r.primary && ((r.preferredTier === 'free' && !r.primary.free) || (r.preferredTier === 'paid' && r.primary.free));
                    return (
                        <li key={r.key} className="px-3 py-2">
                            <div className="flex items-start gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm">
                                        {r.label}
                                        <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded border ${r.preferredTier === 'free' ? 'border-emerald-400/40 text-emerald-400' : 'border-border text-text-secondary'}`}>
                                            meant for {r.preferredTier === 'free' ? 'Rogly (free)' : 'a paid model'}
                                        </span>
                                    </div>
                                    <div className="text-[11px] text-text-secondary">{r.description}</div>
                                    <div className="mt-1 text-xs">
                                        {r.primary ? (
                                            <>
                                                <span className="font-mono">{r.primary.model}</span>
                                                <span className="text-text-secondary"> · {r.primary.label} · {r.primary.free ? 'free' : 'paid'}</span>
                                            </>
                                        ) : (
                                            <span className="text-amber-400">No model</span>
                                        )}
                                        <span className="ml-2 text-[10px] text-text-secondary">{SOURCE_LABEL[r.source]}</span>
                                        {r.allowPaidFallback && r.fallback ? <span className="ml-2 text-[10px] text-amber-400">paid fallback: {r.fallback.model}</span> : null}
                                        {mismatch ? <span className="ml-2 text-[10px] text-amber-400">uses a {r.primary!.free ? 'free' : 'paid'} model</span> : null}
                                    </div>
                                </div>
                                <button type="button" onClick={() => setEditing(editing === r.key ? null : r.key)} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card">
                                    {editing === r.key ? 'Close' : 'Change'}
                                </button>
                            </div>
                            {editing === r.key ? (
                                <RouteEditor
                                    row={r}
                                    profiles={profiles}
                                    onSaved={() => {
                                        setEditing(null);
                                        reload();
                                    }}
                                />
                            ) : null}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
