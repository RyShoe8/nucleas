'use client';

import { useCallback, useEffect, useState } from 'react';

type Level = 'low' | 'medium' | 'high';

interface Choice {
    profileId: string;
    model: string;
    free: boolean;
    label: string;
}

interface Pick {
    primary: Choice | null;
    fallback: Choice | null;
    source: 'pinned' | 'auto' | 'none';
}

interface NeedRow {
    need: string;
    label: string;
    description: string;
    pinned: { profileId: string; model: string } | null;
    picks: Record<Level, Pick>;
}

interface Benchmark {
    intelligence: number | null;
    coding: number | null;
    math: number | null;
    source: string;
}

interface ModelRow {
    profileId: string;
    profileLabel: string;
    model: string;
    free: boolean;
    price: number | null;
    benchmark: Benchmark | null;
}

interface RankRow {
    profileLabel: string;
    model: string;
    price: number | null;
    benchmark: Benchmark | null;
}

interface BenchmarkStatus {
    configured: boolean;
    keyLast4: string | null;
    models: number;
    fetchedAt: string | null;
    error: string | null;
    source: { name: string; url: string };
}

type EngineData = { defaultCostLevel: Level; needs: NeedRow[]; models: ModelRow[]; benchmarks: BenchmarkStatus; rankings: Record<'plan' | 'code', RankRow[]> };

const LEVELS: { key: Level; label: string; hint: string }[] = [
    { key: 'low', label: 'Low', hint: '3rd ranked paid model for planning and review; Rogly does the work; never pays to retry.' },
    { key: 'medium', label: 'Medium', hint: '2nd ranked paid model; Rogly does the work and may retry on that model if it fails.' },
    { key: 'high', label: 'High', hint: 'The #1 ranked paid model plans and reviews; the #3 ranked paid model to each task does the work; Rogly only for utilities.' },
];

function short(model?: string): string {
    return (model ?? '').split('/').pop() ?? '';
}

function PickCell({ pick }: { pick: Pick }) {
    if (!pick.primary) return <span className="text-amber-400 text-[11px]">none available</span>;
    return (
        <div className="min-w-0">
            <div className="text-xs truncate" title={`${pick.primary.model} · ${pick.primary.label}`}>
                {short(pick.primary.model)}
                <span className={`ml-1 text-[10px] ${pick.primary.free ? 'text-emerald-400' : 'text-text-secondary'}`}>{pick.primary.free ? 'free' : 'paid'}</span>
            </div>
            {pick.fallback ? <div className="text-[10px] text-text-secondary truncate">retry: {short(pick.fallback.model)}</div> : null}
        </div>
    );
}

function score(b: Benchmark | null, kind: 'intelligence' | 'coding'): string {
    const v = b ? (kind === 'coding' ? (b.coding ?? b.intelligence) : b.intelligence) : null;
    return v === null ? 'no score' : v.toFixed(1);
}

function Ranking({ title, kind, rows }: { title: string; kind: 'intelligence' | 'coding'; rows: RankRow[] }) {
    return (
        <div className="min-w-0">
            <h3 className="text-xs font-medium mb-1">{title}</h3>
            <ol className="space-y-0.5">
                {rows.map((r, i) => (
                    <li key={`${r.profileLabel}:${r.model}`} className="flex items-baseline gap-2 text-[11px]">
                        <span className="w-4 text-right text-text-secondary">{i + 1}</span>
                        <span className="truncate flex-1" title={r.benchmark ? `Artificial Analysis: ${r.benchmark.source}` : 'Not on the leaderboard; ranked by price after scored models'}>
                            {short(r.model)} <span className="text-text-secondary">· {r.profileLabel}</span>
                        </span>
                        <span className={r.benchmark ? '' : 'text-text-secondary'}>{score(r.benchmark, kind)}</span>
                        <span className="w-14 text-right text-text-secondary">{r.price !== null ? `${r.price}` : ''}</span>
                    </li>
                ))}
            </ol>
        </div>
    );
}

function BenchmarkKey({ status, onSave }: { status: BenchmarkStatus; onSave: (key: string | null) => Promise<void> }) {
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const submit = async (key: string | null) => {
        setBusy(true);
        await onSave(key);
        setBusy(false);
        setValue('');
    };
    return (
        <div className="space-y-1">
            <p className="text-[11px] text-text-secondary">
                {status.configured
                    ? `Key ending ${status.keyLast4} · ${status.models} models scored${status.fetchedAt ? ` · updated ${new Date(status.fetchedAt).toLocaleString()}` : ''}`
                    : 'No key yet, so paid models are ranked by price. Create a free key at Artificial Analysis and paste it here.'}
            </p>
            {status.error ? <p className="text-[11px] text-amber-400">Last refresh: {status.error}</p> : null}
            <div className="flex gap-2">
                <input
                    type="password"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={status.configured ? 'Replace key' : 'Artificial Analysis API key'}
                    autoComplete="off"
                    className="h-7 flex-1 min-w-0 px-2 rounded border border-border bg-background-elevated text-xs"
                    aria-label="Artificial Analysis API key"
                />
                <button type="button" disabled={busy || !value.trim()} onClick={() => void submit(value)} className="text-[11px] px-2 rounded border border-border hover:bg-background-card disabled:opacity-50">
                    {busy ? 'Checking…' : 'Save'}
                </button>
                {status.configured ? (
                    <button type="button" disabled={busy} onClick={() => void submit(null)} className="text-[11px] px-2 rounded border border-border hover:bg-background-card">
                        Remove
                    </button>
                ) : null}
            </div>
        </div>
    );
}

/** The AI engine: default cost level, what it picks per need and level, and optional pins (administrators). */
export default function AiRoutingModule() {
    const [data, setData] = useState<EngineData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pinning, setPinning] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [refresh, setRefresh] = useState(false);
    const reload = useCallback((force = false) => {
        setRefresh(force);
        setReloadKey((k) => k + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/ai-engine${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as EngineData & { error?: string };
            if (cancelled) return;
            if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
            else setData(body);
        })();
        return () => {
            cancelled = true;
        };
    }, [reloadKey, refresh]);

    const save = async (payload: Record<string, unknown>) => {
        const res = await fetch('/api/os/ai-engine', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            setError(body.error ?? `Failed (${res.status})`);
            return;
        }
        setError(null);
        setPinning(null);
        reload();
    };

    if (!data) return <div className="p-4 text-sm text-text-secondary">{error ?? 'Loading…'}</div>;

    return (
        <div className="h-full overflow-y-auto p-4 space-y-4 text-text-primary">
            <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">Default cost level</h2>
                    <button type="button" onClick={() => reload(true)} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card">
                        Refresh model lists
                    </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {LEVELS.map((l) => (
                        <button
                            key={l.key}
                            type="button"
                            onClick={() => void save({ defaultCostLevel: l.key })}
                            className={`text-left rounded-md border p-2 ${data.defaultCostLevel === l.key ? 'border-primary bg-primary/10' : 'border-border hover:bg-background-card'}`}
                        >
                            <div className="text-sm font-medium">{l.label}</div>
                            <div className="text-[11px] text-text-secondary">{l.hint}</div>
                        </button>
                    ))}
                </div>
                <p className="text-[11px] text-text-secondary">This is the default everywhere; each Ask or IDE request can choose its own level.</p>
            </section>

            {error ? <p className="text-xs text-red-400">{error}</p> : null}

            <section className="space-y-2">
                <h2 className="text-sm font-semibold">Benchmark ranking</h2>
                <BenchmarkKey status={data.benchmarks} onSave={(key) => save({ benchmarkApiKey: key })} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Ranking title="Plan, review, write, research (intelligence index)" kind="intelligence" rows={data.rankings.plan} />
                    <Ranking title="Code (coding index)" kind="coding" rows={data.rankings.code} />
                </div>
                <p className="text-[11px] text-text-secondary">
                    Benchmark data:{' '}
                    <a href={data.benchmarks.source.url} target="_blank" rel="noreferrer" className="underline">
                        {data.benchmarks.source.name}
                    </a>
                    . Models not on the leaderboard rank after scored ones, by price.
                </p>
            </section>

            <section>
                <h2 className="text-sm font-semibold mb-1">What the engine picks</h2>
                <p className="text-[11px] text-text-secondary mb-2">
                    Chosen automatically from every enabled credential. Rogly always uses its strongest model for the job. Pin a model to override a need at every level.
                </p>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-[11px] text-text-secondary text-left">
                            <th className="font-normal py-1 pr-2">Need</th>
                            {LEVELS.map((l) => (
                                <th key={l.key} className="font-normal py-1 px-2">
                                    {l.label}
                                </th>
                            ))}
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {data.needs.map((n) => (
                            <tr key={n.need} className="border-t border-border align-top">
                                <td className="py-2 pr-2 w-44">
                                    <div className="text-sm">{n.label}</div>
                                    <div className="text-[10px] text-text-secondary">{n.description}</div>
                                    {n.pinned ? <div className="text-[10px] text-amber-400 mt-0.5">pinned</div> : null}
                                    {pinning === n.need ? (
                                        <select
                                            autoFocus
                                            defaultValue=""
                                            onChange={(e) => {
                                                const [profileId, ...rest] = e.target.value.split('::');
                                                if (profileId) void save({ pin: { need: n.need, profileId, model: rest.join('::') } });
                                            }}
                                            className="mt-1 h-7 w-full px-1 rounded border border-border bg-background-elevated text-xs"
                                            aria-label={`Pin a model for ${n.label}`}
                                        >
                                            <option value="">Choose a model…</option>
                                            {data.models.map((m) => (
                                                <option key={`${m.profileId}::${m.model}`} value={`${m.profileId}::${m.model}`}>
                                                    {m.model} · {m.profileLabel} · {m.free ? 'free' : m.price !== null ? `~${m.price}/1M` : 'price unknown'}{m.benchmark?.intelligence != null ? ` · score ${m.benchmark.intelligence.toFixed(1)}` : ''}
                                                </option>
                                            ))}
                                        </select>
                                    ) : null}
                                </td>
                                {LEVELS.map((l) => (
                                    <td key={l.key} className="py-2 px-2">
                                        <PickCell pick={n.picks[l.key]} />
                                    </td>
                                ))}
                                <td className="py-2 pl-2 text-right whitespace-nowrap">
                                    {n.pinned ? (
                                        <button type="button" onClick={() => void save({ unpin: n.need })} className="text-[11px] px-2 py-0.5 rounded border border-border">
                                            Unpin
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setPinning(pinning === n.need ? null : n.need)}
                                            className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card"
                                        >
                                            {pinning === n.need ? 'Cancel' : 'Pin'}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
        </div>
    );
}
