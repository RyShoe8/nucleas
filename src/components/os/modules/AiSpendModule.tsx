'use client';

import { useEffect, useMemo, useState } from 'react';

interface Row {
    key: string;
    label: string;
    detail?: string;
    costMicros: number;
    runs: number;
}

interface Spend {
    period: string;
    budget: { limitMicros: number | null; spentMicros: number; reservedMicros: number };
    totals: { costMicros: number; runs: number; unknownCostRuns: number; inputTokens: number; outputTokens: number };
    byDay: { date: string; costMicros: number; runs: number }[];
    bySource: Row[];
    byModel: Row[];
    byUser: Row[];
    search: { braveQueries: number; googleQueries: number; estimatedMicros: number };
}

function usd(micros: number): string {
    const dollars = micros / 1_000_000;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dollars < 10 ? 2 : 0, maximumFractionDigits: dollars < 10 ? 2 : 0 }).format(dollars);
}

const nf = new Intl.NumberFormat('en-US');

function recentMonths(count: number): string[] {
    const now = new Date();
    return Array.from({ length: count }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
}

function monthLabel(period: string): string {
    const [y, m] = period.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-md border border-border p-2.5 min-w-0">
            <div className="text-[11px] text-text-secondary truncate">{label}</div>
            <div className="text-lg font-semibold tabular-nums leading-tight">{value}</div>
            {hint ? <div className="text-[10px] text-text-secondary">{hint}</div> : null}
        </div>
    );
}

function DailyBars({ days, period }: { days: Spend['byDay']; period: string }) {
    const [y, m] = period.split('-').map(Number);
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const byDate = new Map(days.map((d) => [d.date, d]));
    const series = Array.from({ length: count }, (_, i) => {
        const date = `${period}-${String(i + 1).padStart(2, '0')}`;
        return { date, costMicros: byDate.get(date)?.costMicros ?? 0, runs: byDate.get(date)?.runs ?? 0 };
    });
    const max = Math.max(...series.map((s) => s.costMicros), 1);
    const today = new Date().toISOString().slice(0, 10);
    const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    // Label a readable subset of days so the axis never crowds.
    const labelled = new Set([1, 5, 10, 15, 20, 25, count]);

    return (
        <div role="img" aria-label={`AI spend per day in ${monthName}; highest day ${usd(max)}`}>
            <div className="flex gap-2">
                {/* Scale */}
                <div className="flex flex-col justify-between text-[10px] text-text-secondary tabular-nums text-right w-12 flex-shrink-0 h-28">
                    <span>{usd(max)}</span>
                    <span>{usd(max / 2)}</span>
                    <span>$0</span>
                </div>
                {/* Bars */}
                <div className="relative flex-1 h-28 border-l border-b border-border">
                    <div className="absolute inset-x-0 top-0 border-t border-dashed border-border/60" aria-hidden />
                    <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/60" aria-hidden />
                    <div className="absolute inset-0 flex items-end gap-px px-px">
                        {series.map((s) => (
                            <div
                                key={s.date}
                                className="flex-1 h-full flex items-end group"
                                title={`${monthName} ${Number(s.date.slice(8))}: ${usd(s.costMicros)} · ${s.runs} run${s.runs === 1 ? '' : 's'}`}
                            >
                                <div
                                    className={`w-full rounded-t-sm ${s.date === today ? 'bg-primary' : 'bg-primary/70'} group-hover:bg-primary`}
                                    style={{ height: s.costMicros > 0 ? `${Math.max(2, (s.costMicros / max) * 100)}%` : 0 }}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            {/* Day axis */}
            <div className="flex gap-2 mt-1">
                <div className="w-12 flex-shrink-0" />
                <div className="flex-1 flex gap-px px-px">
                    {series.map((s, i) => (
                        <div key={s.date} className={`flex-1 text-center text-[10px] tabular-nums ${s.date === today ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}>
                            {labelled.has(i + 1) ? i + 1 : ''}
                        </div>
                    ))}
                </div>
            </div>
            <div className="text-[10px] text-text-secondary text-center mt-0.5">{monthName} (UTC)</div>
        </div>
    );
}

function Breakdown({ title, rows, total }: { title: string; rows: Row[]; total: number }) {
    if (rows.length === 0) return null;
    return (
        <section>
            <h3 className="text-[11px] uppercase tracking-wider text-text-secondary mb-1">{title}</h3>
            <table className="w-full text-sm">
                <tbody>
                    {rows.slice(0, 12).map((r) => (
                        <tr key={r.key} className="border-t border-border">
                            <td className="py-1.5 pr-2">
                                <div className="truncate max-w-[260px]">{r.label}</div>
                                {r.detail ? <div className="text-[10px] text-text-secondary">{r.detail}</div> : null}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-text-secondary text-xs">{nf.format(r.runs)} runs</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{usd(r.costMicros)}</td>
                            <td className="py-1.5 pl-2 w-20">
                                <div className="h-1.5 rounded bg-background-card overflow-hidden">
                                    <div className="h-full bg-primary" style={{ width: `${total > 0 ? Math.round((r.costMicros / total) * 100) : 0}%` }} />
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
}

/** Organization-wide AI spend (administrators). */
export default function AiSpendModule() {
    const months = useMemo(() => recentMonths(6), []);
    const [period, setPeriod] = useState(months[0]);
    const [data, setData] = useState<Spend | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/ai-spend?month=${period}`, { cache: 'no-store' });
            const body = (await res.json().catch(() => null)) as (Spend & { error?: string }) | null;
            if (cancelled) return;
            if (!res.ok || !body) {
                setError(body?.error ?? `Failed (${res.status})`);
                setData(null);
            } else {
                setError(null);
                setData(body);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [period]);

    return (
        <div className="h-full overflow-y-auto p-4 space-y-4 text-text-primary">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">AI spend · whole organization</h2>
                <select value={period} onChange={(e) => setPeriod(e.target.value)} className="h-7 px-2 rounded border border-border bg-background-elevated text-xs" aria-label="Month">
                    {months.map((m) => (
                        <option key={m} value={m}>
                            {monthLabel(m)}
                        </option>
                    ))}
                </select>
            </div>

            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            {!data && !error ? <p className="text-sm text-text-secondary">Loading…</p> : null}

            {data ? (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <Tile label="AI spend" value={usd(data.totals.costMicros)} hint={`${nf.format(data.totals.runs)} runs`} />
                        <Tile
                            label="Budget ledger"
                            value={usd(data.budget.spentMicros)}
                            hint={`${data.budget.reservedMicros ? `${usd(data.budget.reservedMicros)} reserved · ` : ''}${data.budget.limitMicros ? `limit ${usd(data.budget.limitMicros)}` : 'no limit set'}`}
                        />
                        <Tile label="Tokens" value={nf.format(data.totals.inputTokens + data.totals.outputTokens)} hint={`${nf.format(data.totals.inputTokens)} in · ${nf.format(data.totals.outputTokens)} out`} />
                        <Tile
                            label="Web search (est.)"
                            value={usd(data.search.estimatedMicros)}
                            hint={`${nf.format(data.search.braveQueries + data.search.googleQueries)} queries, after free tiers`}
                        />
                    </div>

                    {data.totals.unknownCostRuns > 0 ? (
                        <p className="text-xs text-amber-400">
                            {nf.format(data.totals.unknownCostRuns)} completed run(s) have no reported cost, so the total may be understated.
                        </p>
                    ) : null}

                    <section>
                        <h3 className="text-[11px] uppercase tracking-wider text-text-secondary mb-1">Per day</h3>
                        {data.totals.runs ? <DailyBars days={data.byDay} period={data.period} /> : <p className="text-sm text-text-secondary">No AI usage this month.</p>}
                    </section>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Breakdown title="By source" rows={data.bySource} total={data.totals.costMicros} />
                        <Breakdown title="By person" rows={data.byUser} total={data.totals.costMicros} />
                        <Breakdown title="By model" rows={data.byModel} total={data.totals.costMicros} />
                    </div>
                    <p className="text-[11px] text-text-secondary">
                        AI spend sums the settled cost recorded on every AI run this month (UTC). The budget ledger is the organization&apos;s accounting record and can differ slightly while runs are
                        in flight.
                    </p>
                </>
            ) : null}
        </div>
    );
}
