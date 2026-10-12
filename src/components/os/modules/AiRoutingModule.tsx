'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Level = 'free' | 'low' | 'medium' | 'high';
type PaidLevel = Exclude<Level, 'free'>;

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
    /** The model chosen for this need at each level, or null for automatic. */
    overrides: Record<Level, { profileId: string; model: string } | null>;
    picks: Record<Level, Pick>;
}

interface Benchmark {
    intelligence: number | null;
    coding: number | null;
    math: number | null;
    source: string;
    /** A compressed copy of the listed model: its score is discounted, an estimate rather than a measurement. */
    estimated?: { quantization: string; factor: number };
}

interface ModelRow {
    profileId: string;
    profileLabel: string;
    model: string;
    free: boolean;
    price: number | null;
    benchmark: Benchmark | null;
    /** ranked: in the ranking tables; eligible: usable by the engine but outside the tables; excluded: skipped, see reason. */
    status: 'ranked' | 'eligible' | 'excluded';
    reason: string | null;
}

interface RankRow {
    profileLabel: string;
    model: string;
    price: number | null;
    /** Local (free) model, shown beside the paid ones. */
    free: boolean;
    benchmark: Benchmark | null;
    /** Nucleas check score for this kind of work (0-1); local models only. */
    check: number | null;
}

interface BenchmarkStatus {
    configured: boolean;
    keyLast4: string | null;
    models: number;
    fetchedAt: string | null;
    error: string | null;
    source: { name: string; url: string };
}

interface HealthIssue {
    profileId: string;
    profileLabel: string;
    model: string | null;
    httpStatus: number;
    message: string | null;
    until: string;
    failureCount: number;
    category: string | null;
}

interface CheckRow {
    profileId: string;
    profileLabel: string;
    model: string;
    status: 'queued' | 'running' | 'done' | 'failed';
    checkedAt: string | null;
    supports: { jsonSchema: boolean | null; jsonObject: boolean | null; tools: boolean | null };
    scores: { json: number | null; routing: number | null; tools: number | null; grounded: number | null; code: number | null; writing?: number | null };
    overall: number | null;
    avgLatencyMs: number | null;
    notes: string[];
    toolMode: 'native' | 'prompted' | null;
    stagesDone: number;
    stepDetail: string | null;
    error: string | null;
}

interface MediaRankView {
    rows: { rank: number | null; name: string; creator: string; elo: number; ci95: string | null; appearances: number | null; releaseDate: string | null; available: { profileLabel: string; model: string }[] }[];
    unmatched: { profileLabel: string; model: string }[];
    total: number;
}

type EngineData = { checks: CheckRow[]; health: HealthIssue[]; defaultCostLevel: Level; priceCeilings: Ceilings; needs: NeedRow[]; models: ModelRow[]; benchmarks: BenchmarkStatus; rankings: Record<'plan' | 'code', RankRow[]>; mediaRankings: { image: MediaRankView; video: MediaRankView; error: string | null; fetchedAt: string | null } };

const LEVELS: { key: Level; label: string; hint: string }[] = [
    { key: 'free', label: 'Free', hint: 'Rogly models only, for every step. Never calls or retries on a paid model.' },
    { key: 'low', label: 'Low', hint: 'Best-scoring paid model under this ceiling plans and reviews; Rogly does the work; never pays to retry.' },
    { key: 'medium', label: 'Medium', hint: 'Best-scoring paid model under this ceiling plans and reviews; Rogly does the work and may retry on that model.' },
    { key: 'high', label: 'High', hint: 'Best-scoring model under this ceiling plans, reviews and does the work.' },
];

type Ceilings = Record<PaidLevel, number | null>;

/** Max $ per 1M tokens for a level; empty means no ceiling. Saves on blur or Enter. */
function CeilingInput({ level, value, onSave }: { level: PaidLevel; value: number | null; onSave: (v: number | null) => void }) {
    const [draft, setDraft] = useState(value === null ? '' : String(value));
    const commit = () => {
        const trimmed = draft.trim();
        const next = trimmed === '' ? null : Number(trimmed);
        if (next !== null && (!Number.isFinite(next) || next <= 0)) return setDraft(value === null ? '' : String(value));
        if (next !== value) onSave(next);
    };
    return (
        <label className="mt-2 flex items-center gap-1 text-[11px] text-text-secondary">
            Max $
            <input
                type="number"
                min="0"
                step="0.25"
                inputMode="decimal"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                placeholder="no limit"
                className="h-6 w-20 px-1 rounded border border-border bg-background-elevated text-xs text-text-primary"
                aria-label={`Price ceiling for ${level}`}
            />
            / 1M tokens
        </label>
    );
}

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

function ModelChooser({ models, freeOnly, onChoose, onCancel }: { models: ModelRow[]; freeOnly: boolean; onChoose: (profileId: string, model: string) => void; onCancel: () => void }) {
    const pool = freeOnly ? models.filter((m) => m.free) : models;
    const providers = [...new Map(pool.map((m) => [m.profileId, m.profileLabel] as const)).entries()];
    const [profileId, setProfileId] = useState('');
    const [filter, setFilter] = useState('');
    const all = pool
        .filter((m) => m.profileId === profileId)
        .sort((a, b) => Number(a.status === 'excluded') - Number(b.status === 'excluded') || (b.benchmark?.intelligence ?? -1) - (a.benchmark?.intelligence ?? -1) || (b.price ?? 0) - (a.price ?? 0) || a.model.localeCompare(b.model));
    const needle = filter.trim().toLowerCase();
    const options = needle ? all.filter((m) => m.model.toLowerCase().includes(needle)) : all;
    const field = 'h-7 w-full px-1 rounded border border-border bg-background-elevated text-xs';
    return (
        <div className="mt-1 space-y-1">
            <select autoFocus value={profileId} onChange={(e) => { setProfileId(e.target.value); setFilter(''); }} className={field} aria-label="Provider">
                <option value="">Provider…</option>
                {providers.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                ))}
            </select>
            {profileId && all.length > 15 ? <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${all.length} models`} className={field} aria-label="Filter models" /> : null}
            <select disabled={!profileId} value="" onChange={(e) => { if (e.target.value) onChoose(profileId, e.target.value); }} className={`${field} disabled:opacity-50`} aria-label="Model">
                <option value="">{profileId ? `Model… (${options.length})` : 'Model…'}</option>
                {options.map((m) => (
                    <option key={m.model} value={m.model}>
                        {short(m.model)} · {m.free ? 'free' : m.price !== null ? `~${m.price}/1M` : 'price unknown'}{m.benchmark?.intelligence != null ? ` · score ${m.benchmark.intelligence.toFixed(1)}` : ''}{m.status === 'excluded' ? ' · not auto-ranked' : ''}
                    </option>
                ))}
            </select>
            <button type="button" onClick={onCancel} className="text-[11px] text-text-secondary hover:text-text-primary">Cancel</button>
        </div>
    );
}

function FindModel({ models }: { models: ModelRow[] }) {
    const [query, setQuery] = useState('');
    const needle = query.trim().toLowerCase();
    const hits = needle ? models.filter((m) => m.model.toLowerCase().includes(needle)) : [];
    const statusText = (m: ModelRow) =>
        m.status === 'ranked' ? 'Shown in the ranking tables' : m.status === 'eligible' ? 'Usable by the engine, but outside the top rows the tables show' : `Not auto-ranked: ${m.reason ?? 'unknown reason'}`;
    return (
        <div className="space-y-1">
            <label className="block text-xs font-medium" htmlFor="find-model">Find a model</label>
            <input id="find-model" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. sonnet" className="h-7 w-full max-w-xs px-2 rounded border border-border bg-background-elevated text-xs" />
            {needle ? (
                hits.length ? (
                    <ul className="text-[11px] space-y-0.5">
                        {hits.slice(0, 25).map((m) => (
                            <li key={`${m.profileId}::${m.model}`}>
                                <span className="font-medium">{m.model}</span> <span className="text-text-secondary">· {m.profileLabel} · {m.free ? 'free' : m.price !== null ? `~${m.price}/1M` : 'no price'} · </span>
                                <span className={m.status === 'excluded' ? 'text-amber-400' : 'text-emerald-400'}>{statusText(m)}</span>
                            </li>
                        ))}
                        {hits.length > 25 ? <li className="text-text-secondary">…and {hits.length - 25} more. Type more to narrow it down.</li> : null}
                    </ul>
                ) : (
                    <p className="text-[11px] text-amber-400">No enabled credential lists a model matching “{query.trim()}”. Check that the credential is enabled and use “Refresh model lists”.</p>
                )
            ) : (
                <p className="text-[11px] text-text-secondary">Search every model your credentials list to see whether it is ranked, or why it is not.</p>
            )}
        </div>
    );
}

function score(b: Benchmark | null, kind: 'intelligence' | 'coding'): string {
    const v = b ? (kind === 'coding' ? (b.coding ?? b.intelligence) : b.intelligence) : null;
    return v === null ? 'no score' : `${b?.estimated ? '~' : ''}${v.toFixed(1)}`;
}

function scoreTitle(b: Benchmark | null, free: boolean): string {
    if (!b) return free ? 'Not on the Artificial Analysis leaderboard' : 'Not on the leaderboard; ranked by price after scored models';
    if (!b.estimated) return `Artificial Analysis: ${b.source}`;
    return `Estimate. The listed model (${b.source}) scores higher; this compressed copy (${b.estimated.quantization}) is discounted to ${Math.round(b.estimated.factor * 1000) / 10}% as a rule of thumb, not measured.`;
}

function Ranking({ title, kind, rows }: { title: string; kind: 'intelligence' | 'coding'; rows: RankRow[] }) {
    const firstUnscored = rows.findIndex((r) => !r.benchmark);
    return (
        <div className="min-w-0">
            <h3 className="text-xs font-medium mb-1">{title}</h3>
            <div className="flex items-baseline gap-2 text-[10px] text-text-secondary">
                <span className="w-4" />
                <span className="flex-1">Model</span>
                <span title="Artificial Analysis index (public benchmark)">Index</span>
                <span className="w-12 text-right" title="Nucleas's own checks, local models only. A different scale from the index, so not comparable with it.">Checks</span>
                <span className="w-14 text-right">$/1M</span>
            </div>
            <ol className="space-y-0.5">
                {rows.map((r, i) => (
                    <li key={`${r.profileLabel}:${r.model}`} className={i === firstUnscored && i > 0 && r.free ? 'border-t border-border pt-0.5' : ''}>
                        {i === firstUnscored && i > 0 && r.free ? <div className="text-[10px] text-text-secondary">Not on the leaderboard: ranked by Nucleas checks only</div> : null}
                        <div className="flex items-baseline gap-2 text-[11px]">
                            <span className="w-4 text-right text-text-secondary">{i + 1}</span>
                            <span className="truncate flex-1" title={scoreTitle(r.benchmark, r.free)}>
                                {short(r.model)} <span className="text-text-secondary">· {r.profileLabel}</span>
                                {r.free ? <span className="ml-1 text-[10px] text-emerald-400">free</span> : null}
                            </span>
                            <span className={r.benchmark ? (r.benchmark.estimated ? 'italic' : '') : 'text-text-secondary'} title={scoreTitle(r.benchmark, r.free)}>{score(r.benchmark, kind)}</span>
                            <span className="w-12 text-right text-text-secondary">{r.free ? (r.check === null ? 'unchecked' : `${Math.round(r.check * 100)}%`) : ''}</span>
                            <span className="w-14 text-right text-text-secondary">{r.price !== null ? `${r.price}` : r.free ? 'free' : ''}</span>
                        </div>
                    </li>
                ))}
            </ol>
            {rows.some((r) => r.benchmark?.estimated) ? (
                <p className="mt-1 text-[10px] text-text-secondary">~ Estimate: the listed model&apos;s score for a compressed copy, discounted by a rule of thumb (8-bit about 0.5%, 4-bit about 1.5-4%). Not measured by Nucleas.</p>
            ) : null}
        </div>
    );
}

function MediaRanking({ title, ranking, configured }: { title: string; ranking: MediaRankView; configured: boolean }) {
    return (
        <div className="min-w-0">
            <h3 className="text-xs font-medium mb-1">{title}</h3>
            {ranking.rows.length === 0 ? (
                <p className="text-[11px] text-text-secondary">{configured ? 'No leaderboard data yet. Use “Refresh model lists”.' : 'Add the Artificial Analysis key above to load this leaderboard.'}</p>
            ) : (
                <>
                    <div className="flex items-baseline gap-2 text-[10px] text-text-secondary">
                        <span className="w-5" />
                        <span className="flex-1">Model</span>
                        <span className="w-24 text-right" title="Elo from blind side-by-side votes on Artificial Analysis. ± is the 95% confidence interval.">Elo</span>
                        <span className="w-28 text-right">Your credentials</span>
                    </div>
                    <ol className="space-y-0.5">
                        {ranking.rows.map((r) => (
                            <li key={`${r.name}:${r.creator}`} className="flex items-baseline gap-2 text-[11px]">
                                <span className="w-5 text-right text-text-secondary">{r.rank ?? ''}</span>
                                <span className="truncate flex-1" title={`${r.name}${r.releaseDate ? ` · released ${r.releaseDate}` : ''}${r.appearances ? ` · ${r.appearances.toLocaleString()} votes` : ''}`}>
                                    {r.name} {r.creator ? <span className="text-text-secondary">· {r.creator}</span> : null}
                                </span>
                                <span className="w-24 text-right">{Math.round(r.elo)}{r.ci95 ? <span className="text-text-secondary"> {r.ci95}</span> : null}</span>
                                <span className={`w-28 text-right truncate ${r.available.length ? 'text-emerald-400' : 'text-text-secondary'}`} title={r.available.map((a) => `${a.model} · ${a.profileLabel}`).join('\n')}>
                                    {r.available.length ? r.available.map((a) => a.profileLabel).join(', ') : '—'}
                                </span>
                            </li>
                        ))}
                    </ol>
                    <p className="mt-1 text-[10px] text-text-secondary">Top {Math.min(ranking.rows.length, ranking.total)} of {ranking.total} ranked models, plus any your credentials can use.</p>
                </>
            )}
            {ranking.unmatched.length ? (
                <p className="mt-1 text-[10px] text-text-secondary" title={ranking.unmatched.map((m) => `${m.model} · ${m.profileLabel}`).join('\n')}>
                    Also listed by your credentials but not on the leaderboard: {ranking.unmatched.slice(0, 4).map((m) => short(m.model)).join(', ')}{ranking.unmatched.length > 4 ? ` and ${ranking.unmatched.length - 4} more` : ''}.
                </p>
            ) : null}
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

const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
const yesNo = (v: boolean | null) => (v === null ? '?' : v ? 'yes' : 'no');

/** Nucleas measures its free models by running them; selection ranks Rogly models by these scores. */
function FreeModelChecks({ rows, onRun, onCancel }: { rows: CheckRow[]; onRun: () => Promise<void>; onCancel: () => Promise<void> }) {
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState<string | null>(null);
    const active = rows.some((r) => r.status === 'queued' || r.status === 'running');
    return (
        <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Free model checks</h2>
                <div className="flex items-center gap-2">
                {active ? (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                            setBusy(true);
                            await onCancel();
                            setBusy(false);
                        }}
                        title="Stops queued and running checks. A running one stops at its next step; earlier scores stay in use."
                        className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card disabled:opacity-50"
                    >
                        Cancel checks
                    </button>
                ) : null}
                <button
                    type="button"
                    disabled={busy || active}
                    onClick={async () => {
                        setBusy(true);
                        await onRun();
                        setBusy(false);
                    }}
                    className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card disabled:opacity-50"
                >
                    {active ? 'Checking…' : busy ? 'Starting…' : 'Run checks'}
                </button>
                </div>
            </div>
            <p className="text-[11px] text-text-secondary">
                Nucleas runs each free model through tests of the work Ask gives it: forced JSON, sorting requests (including follow-ups) into questions, code changes and jobs, calling the right tool with exact arguments over several steps, exact code edits, and answering only from given
                facts. Rogly models are ranked by these scores. Checks are free. Fast models finish in a couple of minutes; slow ones are checked in parts over several passes (every 10 minutes), and the scores in use stay until new ones land.
            </p>
            {rows.length ? (
                <table className="w-full text-xs">
                    <thead>
                        <tr className="text-[11px] text-text-secondary text-left">
                            <th className="font-normal py-1 pr-2">Model</th>
                            <th className="font-normal py-1 px-1">Overall</th>
                            <th className="font-normal py-1 px-1">JSON</th>
                            <th className="font-normal py-1 px-1">Routing</th>
                            <th className="font-normal py-1 px-1">Tools</th>
                            <th className="font-normal py-1 px-1">Grounded</th>
                            <th className="font-normal py-1 px-1">Code</th>
                            <th className="font-normal py-1 px-1" title="Writing in a given voice: voice match, natural sounding, facts kept">Writing</th>
                            <th className="font-normal py-1 px-1" title="Host supports: schema-guided JSON / tool calls">Supports</th>
                            <th className="font-normal py-1 pl-1 text-right">Speed</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => {
                            const key = `${r.profileId}:${r.model}`;
                            return (
                                <tr key={key} className="border-t border-border align-top">
                                    <td className="py-1 pr-2 min-w-0">
                                        <button type="button" onClick={() => setOpen(open === key ? null : key)} className="text-left truncate max-w-[16rem]" title={r.notes.length ? 'Show what went wrong' : r.model}>
                                            {short(r.model)}
                                        </button>
                                        <div className="text-[10px] text-text-secondary">
                                            {r.status === 'queued' ? (r.stagesDone || r.stepDetail ? `${r.stagesDone} of 5 parts done${r.stepDetail ? ` · ${r.stepDetail}` : ''} · continues shortly` : 'queued') : r.status === 'running' ? `checking now · ${r.stagesDone} of 5 parts done${r.stepDetail ? ` · ${r.stepDetail}` : ''}` : r.status === 'failed' ? <span className="text-amber-400">failed: {r.error}{r.checkedAt ? ` · scores are from the last good check (${new Date(r.checkedAt).toLocaleString()})` : ''}</span> : r.checkedAt ? `checked ${new Date(r.checkedAt).toLocaleString()}` : ''}
                                        </div>
                                        {open === key && r.notes.length ? (
                                            <ul className="mt-1 text-[10px] text-text-secondary list-disc pl-4">
                                                {r.notes.map((n) => (
                                                    <li key={n}>{n}</li>
                                                ))}
                                            </ul>
                                        ) : null}
                                    </td>
                                    <td className="py-1 px-1 font-medium">{pct(r.overall)}</td>
                                    <td className="py-1 px-1">{pct(r.scores.json)}</td>
                                    <td className="py-1 px-1">{pct(r.scores.routing)}</td>
                                    <td className="py-1 px-1">{pct(r.scores.tools)}</td>
                                    <td className="py-1 px-1">{pct(r.scores.grounded)}</td>
                                    <td className="py-1 px-1">{pct(r.scores.code)}</td>
                                    <td className="py-1 px-1">{pct(r.scores.writing ?? null)}</td>
                                    <td className="py-1 px-1 text-[10px] text-text-secondary whitespace-nowrap">
                                        schema {yesNo(r.supports.jsonSchema)} · tools {r.toolMode === 'prompted' ? 'via prompt' : yesNo(r.supports.tools)}
                                    </td>
                                    <td className="py-1 pl-1 text-right text-text-secondary whitespace-nowrap">{r.avgLatencyMs !== null ? `${(r.avgLatencyMs / 1000).toFixed(1)}s` : ''}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            ) : (
                <p className="text-[11px] text-text-secondary">No checks yet.</p>
            )}
        </section>
    );
}

/** The AI engine: default cost level, what it picks per need and level, and optional pins (administrators). */
export default function AiRoutingModule() {
    const [data, setData] = useState<EngineData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshingModels, setRefreshingModels] = useState(false);
    const [refreshResult, setRefreshResult] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const forceNextLoad = useRef(false);
    const modelIds = useRef<Set<string>>(new Set());
    const reload = useCallback((force = false) => {
        if (force) forceNextLoad.current = true;
        setReloadKey((k) => k + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;
        const force = forceNextLoad.current;
        forceNextLoad.current = false;
        if (force) {
            setRefreshingModels(true);
            setRefreshResult(null);
        }
        void (async () => {
            try {
                const res = await fetch(`/api/os/ai-engine${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
                const body = (await res.json().catch(() => ({}))) as EngineData & { error?: string };
                if (cancelled) return;
                if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);

                const nextIds = new Set(body.models.map((model) => `${model.profileId}:${model.model}`));
                if (force) {
                    const added = [...nextIds].filter((id) => !modelIds.current.has(id)).length;
                    const removed = [...modelIds.current].filter((id) => !nextIds.has(id)).length;
                    const changes = added || removed ? ` ${added} added, ${removed} removed.` : ' No model IDs changed.';
                    setRefreshResult(`Model lists refreshed at ${new Date().toLocaleTimeString()}. ${nextIds.size} models available.${changes}`);
                }
                modelIds.current = nextIds;
                setData(body);
                setError(null);
            } catch (cause) {
                if (!cancelled) {
                    setError(cause instanceof Error ? cause.message : 'Could not refresh model lists.');
                    if (force) setRefreshResult(null);
                }
            } finally {
                if (!cancelled && force) setRefreshingModels(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [reloadKey]);

    const save = async (payload: Record<string, unknown>) => {
        const res = await fetch('/api/os/ai-engine', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            setError(body.error ?? `Failed (${res.status})`);
            return;
        }
        setError(null);
        setEditing(null);
        reload();
    };

    // While checks run, refresh every 10s to show progress.
    const checking = Boolean(data?.checks.some((c) => c.status === 'queued' || c.status === 'running'));
    useEffect(() => {
        if (!checking) return;
        const timer = setTimeout(() => setReloadKey((k) => k + 1), 10_000);
        return () => clearTimeout(timer);
    }, [checking, reloadKey]);

    const runChecks = async () => {
        const res = await fetch('/api/os/ai-engine', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'run_checks' }) });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
        else setError(null);
        reload();
    };

    const cancelChecks = async () => {
        const res = await fetch('/api/os/ai-engine', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel_checks' }) });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(res.ok ? null : body.error ?? `Failed (${res.status})`);
        reload();
    };

    if (!data) return <div className="p-4 text-sm text-text-secondary">{error ?? 'Loading…'}</div>;

    return (
        <div className="h-full overflow-y-auto p-4 space-y-4 text-text-primary">
            <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">Cost levels</h2>
                    <button type="button" disabled={refreshingModels} onClick={() => reload(true)} className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card disabled:opacity-50">
                        {refreshingModels ? 'Refreshing models…' : 'Refresh model lists'}
                    </button>
                </div>
                {refreshResult ? <p role="status" className="text-[11px] text-emerald-400">{refreshResult}</p> : null}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {LEVELS.map((l) => (
                        <div key={l.key} className={`rounded-md border p-2 ${data.defaultCostLevel === l.key ? 'border-primary bg-primary/10' : 'border-border'}`}>
                            <button type="button" onClick={() => void save({ defaultCostLevel: l.key })} className="w-full text-left" title="Make this the default level">
                                <div className="text-sm font-medium">
                                    {l.label}
                                    {data.defaultCostLevel === l.key ? <span className="ml-1 text-[10px] text-primary">default</span> : null}
                                </div>
                                <div className="text-[11px] text-text-secondary">{l.hint}</div>
                            </button>
                            {l.key === 'free' ? (
                                <div className="mt-1 text-[11px] text-text-secondary">No price ceiling: $0 always.</div>
                            ) : (
                                <CeilingInput
                                    key={`${l.key}:${data.priceCeilings[l.key] ?? ''}`}
                                    level={l.key}
                                    value={data.priceCeilings[l.key]}
                                    onSave={(v) => void save({ priceCeilings: { [l.key]: v } })}
                                />
                            )}
                        </div>
                    ))}
                </div>
                <p className="text-[11px] text-text-secondary">
                    Prices are blended $ per 1M tokens (3 parts input to 1 part output). Click a level to make it the default; each Ask or IDE request can choose its own.
                </p>
            </section>

            {error ? <p className="text-xs text-red-400">{error}</p> : null}

            {data.health.length ? (
                <section className="rounded-md border border-amber-400/50 p-3 space-y-1">
                    <h2 className="text-sm font-semibold text-amber-400">Skipped for now</h2>
                    <p className="text-[11px] text-text-secondary">
                        Adaptive circuits temporarily skip providers after rejected credentials, rate limits, or repeated endpoint failures. Any successful call closes the circuit immediately.
                    </p>
                    <ul className="text-xs space-y-0.5">
                        {data.health.map((h) => (
                            <li key={`${h.profileId}:${h.model ?? ''}`}>
                                <span className="font-medium">{h.profileLabel}</span>
                                {h.model ? ` · ${h.model}` : ' · every model'} — {h.httpStatus ? `HTTP ${h.httpStatus}` : 'transport failure'}
                                {h.category ? ` · ${h.category.replace('_', ' ')}` : ''}
                                {h.failureCount > 1 ? ` · ${h.failureCount} consecutive failures` : ''}
                                {h.message ? `: ${h.message}` : ''}
                                <span className="text-text-secondary"> (until {new Date(h.until).toLocaleTimeString()})</span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            <FreeModelChecks rows={data.checks} onRun={runChecks} onCancel={cancelChecks} />

            <section className="space-y-2">
                <h2 className="text-sm font-semibold">Benchmark ranking</h2>
                <BenchmarkKey status={data.benchmarks} onSave={(key) => save({ benchmarkApiKey: key })} />
                <FindModel models={data.models} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Ranking title="Plan, review, write, research (intelligence index)" kind="intelligence" rows={data.rankings.plan} />
                    <Ranking title="Code (coding index)" kind="coding" rows={data.rankings.code} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <MediaRanking title="Image generation (Elo)" ranking={data.mediaRankings.image} configured={data.benchmarks.configured} />
                    <MediaRanking title="Video generation (Elo)" ranking={data.mediaRankings.video} configured={data.benchmarks.configured} />
                </div>
                {data.mediaRankings.error ? <p className="text-[11px] text-amber-400">{data.mediaRankings.error}</p> : null}
                <p className="text-[11px] text-text-secondary">
                    Benchmark data:{' '}
                    <a href={data.benchmarks.source.url} target="_blank" rel="noreferrer" className="underline">
                        {data.benchmarks.source.name}
                    </a>
                    . Models not on the leaderboard rank after scored ones, by price.
                </p>
            </section>

            <section>
                <div className="flex items-center justify-between gap-2 mb-1">
                    <h2 className="text-sm font-semibold">What the engine picks</h2>
                    <button
                        type="button"
                        disabled={!data.needs.some((n) => LEVELS.some((l) => n.overrides[l.key]))}
                        onClick={() => { if (window.confirm('Put every task at every level back to the engine’s own pick? Models you chose by hand are cleared.')) void save({ clearAll: true }); }}
                        className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card disabled:opacity-40"
                        title="Clear every model you chose by hand, at every level"
                    >
                        Reset all to Auto
                    </button>
                </div>
                <p className="text-[11px] text-text-secondary mb-2">
                    Chosen automatically from every enabled credential. Rogly uses its best-checked model for the job (by name until checks have run). Use Change to choose a provider and model for one task at one plan level; Auto returns it to the engine's pick.
                </p>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-[11px] text-text-secondary text-left">
                            <th className="font-normal py-1 pr-2">Need</th>
                            {LEVELS.map((l) => (
                                <th key={l.key} className="font-normal py-1 px-2">
                                    {l.label}
                                    {data.needs.some((n) => n.overrides[l.key]) ? (
                                        <button type="button" onClick={() => void save({ clearAll: { level: l.key } })} className="ml-1 text-[10px] underline text-text-secondary hover:text-text-primary" title={`Put every task at the ${l.label} level back to Auto`}>
                                            reset
                                        </button>
                                    ) : null}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.needs.map((n) => (
                            <tr key={n.need} className="border-t border-border align-top">
                                <td className="py-2 pr-2 w-44">
                                    <div className="text-sm">{n.label}</div>
                                    <div className="text-[10px] text-text-secondary">{n.description}</div>
                                </td>
                                {LEVELS.map((l) => {
                                    const cell = `${n.need}:${l.key}`;
                                    const chosen = n.overrides[l.key];
                                    return (
                                        <td key={l.key} className="py-2 px-2 min-w-[8.5rem]">
                                            <PickCell pick={n.picks[l.key]} />
                                            {chosen ? <div className="text-[10px] text-amber-400">set by you</div> : null}
                                            {editing === cell ? (
                                                <ModelChooser
                                                    models={data.models}
                                                    freeOnly={l.key === 'free'}
                                                    onChoose={(profileId, model) => void save({ override: { level: l.key, need: n.need, profileId, model } })}
                                                    onCancel={() => setEditing(null)}
                                                />
                                            ) : (
                                                <div className="mt-1 flex gap-1">
                                                    <button type="button" onClick={() => setEditing(cell)} className="text-[11px] px-1.5 py-0.5 rounded border border-border hover:bg-background-card">
                                                        Change
                                                    </button>
                                                    {chosen ? (
                                                        <button type="button" onClick={() => void save({ clearOverride: { level: l.key, need: n.need } })} className="text-[11px] px-1.5 py-0.5 rounded border border-border hover:bg-background-card">
                                                            Auto
                                                        </button>
                                                    ) : null}
                                                </div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
        </div>
    );
}
