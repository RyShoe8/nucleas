'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Row { url: string; title: string; postedAt: string | null; skipped: boolean; next: boolean }
interface RotationData { everyDays: number; cycle: number; explicit: boolean; nextDue: string | null; pool: Row[]; available: { url: string; title: string }[]; problem: string | null }

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** How often, as a number and a unit. Whole weeks show as weeks. */
const split = (days: number): { n: number; unit: 'days' | 'weeks' } => (days % 7 === 0 ? { n: days / 7, unit: 'weeks' } : { n: days, unit: 'days' });

async function saveRotation(jobId: string, rotation: Record<string, unknown>): Promise<string | null> {
    const res = await fetch(`/api/os/jobs/${jobId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'publishing_settings', settings: { rotation } }) });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? `Failed (${res.status})`;
}

/** The evergreen rotation: how often to post, and the articles in the order they go out. Drag to reorder. */
export default function RotationEditor({ jobId, canManage }: { jobId: string; canManage: boolean }) {
    const [data, setData] = useState<RotationData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [every, setEvery] = useState({ n: 3, unit: 'weeks' as 'days' | 'weeks' });
    const [dragFrom, setDragFrom] = useState<number | null>(null);
    const [dragOver, setDragOver] = useState<number | null>(null);
    const [reload, setReload] = useState(0);
    const timer = useRef<number | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/jobs/${jobId}/rotation`, { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as { rotation?: RotationData; error?: string };
            if (cancelled) return;
            if (!res.ok || !body.rotation) return setError(body.error ?? `Failed (${res.status})`);
            setError(null);
            setData(body.rotation);
            setEvery(split(body.rotation.everyDays));
        })();
        return () => {
            cancelled = true;
        };
    }, [jobId, reload]);

    const flash = useCallback(() => {
        setSaved(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setSaved(false), 2000);
    }, []);

    // One save at a time, in order: quick drags must not send overlapping requests. A dropped database connection is
    // retried here once more (the server already retries) before an error is shown.
    const queue = useRef<Promise<void>>(Promise.resolve());
    const save = (rotation: Record<string, unknown>) => {
        queue.current = queue.current.then(async () => {
            let problem = await saveRotation(jobId, rotation);
            if (problem && /connection|interrupted|try again/i.test(problem)) {
                await new Promise((resolve) => window.setTimeout(resolve, 2500));
                problem = await saveRotation(jobId, rotation);
            }
            if (problem) {
                setError(problem);
                setReload((n) => n + 1);
                return;
            }
            setError(null);
            flash();
            setReload((n) => n + 1);
        });
        return queue.current;
    };

    const savePool = (rows: { url: string; title: string }[]) => save({ pool: rows.map((r) => ({ url: r.url, title: r.title })) });

    const move = (from: number, to: number) => {
        if (!data || from === to || to < 0 || to >= data.pool.length) return;
        const pool = [...data.pool];
        const [item] = pool.splice(from, 1);
        pool.splice(to, 0, item!);
        setData({ ...data, pool, explicit: true });
        void savePool(pool);
    };

    const remove = (index: number) => {
        if (!data) return;
        const pool = data.pool.filter((_, i) => i !== index);
        setData({ ...data, pool, explicit: true });
        void savePool(pool);
    };

    const add = (url: string) => {
        if (!data || !url) return;
        const found = data.available.find((a) => a.url === url);
        if (!found) return;
        const pool = [...data.pool, { ...found, postedAt: null, skipped: false, next: false }];
        setData({ ...data, pool, available: data.available.filter((a) => a.url !== url), explicit: true });
        void savePool(pool);
    };

    const changeEvery = (next: { n: number; unit: 'days' | 'weeks' }) => {
        setEvery(next);
        const days = Math.round(next.n) * (next.unit === 'weeks' ? 7 : 1);
        if (Number.isFinite(days) && days >= 1 && days <= 365 && days !== data?.everyDays) void save({ everyDays: days });
    };

    if (!data) return error ? <p role="alert" className="text-xs text-red-400">{error}</p> : <p className="text-xs text-text-secondary">Loading the rotation…</p>;
    return (
        <section className="space-y-3 rounded border border-border p-3" aria-label="Evergreen rotation">
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>Post one article every</span>
                <input type="number" min={1} max={365} value={Number.isFinite(every.n) ? every.n : ''} disabled={!canManage} aria-label="How many" className="ui-control w-16" onChange={(e) => changeEvery({ ...every, n: Number(e.target.value) })} />
                <select value={every.unit} disabled={!canManage} aria-label="Days or weeks" className="ui-control" onChange={(e) => changeEvery({ ...every, unit: e.target.value as 'days' | 'weeks' })}>
                    <option value="days">days</option>
                    <option value="weeks">weeks</option>
                </select>
                <span className="flex-1" />
                {saved ? <span role="status" className="text-[11px] text-emerald-400">Saved</span> : null}
            </div>
            <p className="text-[11px] text-text-secondary">
                {data.nextDue ? `The next one goes out on ${dateLabel(data.nextDue)}.` : 'The first one goes out at the next hourly check.'}
                {data.cycle > 1 ? ` Round ${data.cycle}: the list has started over.` : ''}
            </p>
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            {data.problem ? <p className="text-xs text-amber-300">{data.problem}</p> : null}

            {data.pool.length === 0 ? <p className="text-sm text-text-secondary">The list is empty. Add an article below.</p> : (
                <ol className="space-y-1">
                    {data.pool.map((row, index) => (
                        <li
                            key={row.url}
                            draggable={canManage}
                            onDragStart={(e) => { setDragFrom(index); e.dataTransfer.effectAllowed = 'move'; }}
                            onDragOver={(e) => { if (dragFrom === null) return; e.preventDefault(); setDragOver(index); }}
                            onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, index); setDragFrom(null); setDragOver(null); }}
                            onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
                            className={`flex items-center gap-2 rounded border px-2 py-1.5 text-sm ${row.next ? 'border-primary/50 bg-primary/5' : 'border-border'} ${dragOver === index && dragFrom !== index ? 'border-dashed border-primary' : ''} ${dragFrom === index ? 'opacity-50' : ''}`}
                        >
                            {canManage ? <span aria-hidden className="cursor-grab select-none text-text-secondary" title="Drag to reorder">⋮⋮</span> : null}
                            <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-text-secondary">{index + 1}</span>
                            <a href={row.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 break-words hover:underline">{row.title}</a>
                            {row.next ? <span className="shrink-0 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">Next</span> : null}
                            {row.postedAt ? <span className="shrink-0 text-[11px] text-text-secondary">Posted {dateLabel(row.postedAt)}</span> : null}
                            {row.skipped ? <span className="shrink-0 text-[11px] text-amber-300">Skipped</span> : null}
                            {canManage ? (
                                <span className="flex shrink-0 items-center gap-0.5">
                                    <button type="button" aria-label={`Move ${row.title} up`} disabled={index === 0} onClick={() => move(index, index - 1)} className="hidden h-8 w-8 items-center justify-center rounded text-text-secondary hover:text-text-primary disabled:opacity-30 [@media(pointer:coarse)]:inline-flex">▲</button>
                                    <button type="button" aria-label={`Move ${row.title} down`} disabled={index === data.pool.length - 1} onClick={() => move(index, index + 1)} className="hidden h-8 w-8 items-center justify-center rounded text-text-secondary hover:text-text-primary disabled:opacity-30 [@media(pointer:coarse)]:inline-flex">▼</button>
                                    <button type="button" aria-label={`Remove ${row.title} from the list`} onClick={() => remove(index)} className="h-8 w-8 rounded text-text-secondary hover:text-red-300">✕</button>
                                </span>
                            ) : null}
                        </li>
                    ))}
                </ol>
            )}

            {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                    {data.available.length ? (
                        <select value="" aria-label="Add an article" className="ui-control max-w-full" onChange={(e) => add(e.target.value)}>
                            <option value="">Add an article…</option>
                            {data.available.map((a) => (
                                <option key={a.url} value={a.url}>{a.title}</option>
                            ))}
                        </select>
                    ) : null}
                    {data.explicit ? <button type="button" className="touch-link text-[11px] text-text-secondary" onClick={() => void save({ pool: null })}>Back to every article, oldest first</button> : null}
                </div>
            ) : null}
        </section>
    );
}
