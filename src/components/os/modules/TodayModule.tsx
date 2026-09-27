'use client';

import { useEffect, useState } from 'react';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { ChangeBadge, formatMetric, type OsMetric } from './CompanySnapshot';

interface TodayRow {
    companyId: string;
    name: string;
    color?: string;
    relationship: string;
    metrics: Record<string, { current: number; change: number | null; lastDay: number | null; unit: OsMetric['unit'] }>;
    changes: string[];
}

const COLUMNS: { key: string; label: string; unit: OsMetric['unit'] }[] = [
    { key: 'leads_new', label: 'Leads', unit: 'count' },
    { key: 'users_new', label: 'Users', unit: 'count' },
    { key: 'sessions', label: 'Sessions', unit: 'count' },
    { key: 'customers_new', label: 'Customers', unit: 'count' },
    { key: 'revenue_net', label: 'Revenue', unit: 'money' },
    { key: 'subscribers_active', label: 'Subscribers', unit: 'count' },
    { key: 'mrr', label: 'MRR', unit: 'money' },
];

/** Cross-company headline view: last 7 days per business with change vs the 7 before. */
export default function TodayModule() {
    const wm = useWindowManager();
    const [data, setData] = useState<{ rows: TodayRow[]; totals: Record<string, number> } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch('/api/os/today');
            const body = (await res.json().catch(() => null)) as { rows: TodayRow[]; totals: Record<string, number> } | null;
            if (cancelled) return;
            if (!res.ok || !body) setError(`Failed to load (${res.status})`);
            else setData(body);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    if (error) return <div className="p-4 text-sm text-red-400">{error}</div>;
    if (!data) return <div className="p-4 text-sm text-text-secondary">Loading…</div>;
    if (data.rows.length === 0) {
        return <div className="p-4 text-sm text-text-secondary">No metrics yet. Connect a company&apos;s sources and run its first sync.</div>;
    }

    const visible = COLUMNS.filter((c) => data.rows.some((r) => r.metrics[c.key]));

    return (
        <div className="h-full overflow-auto p-4 space-y-4 text-text-primary">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {visible.map((c) => (
                    <div key={c.key} className="rounded-md border border-border p-2.5">
                        <div className="text-[11px] text-text-secondary">{c.label} · 7 days</div>
                        <div className="text-lg font-semibold tabular-nums">{formatMetric(c.unit, data.totals[c.key] ?? 0)}</div>
                        <div className="text-[10px] text-text-secondary">all businesses</div>
                    </div>
                ))}
            </div>

            <table className="w-full text-sm border-collapse">
                <thead>
                    <tr className="text-[11px] text-text-secondary text-left">
                        <th className="font-normal py-1 pr-2">Business</th>
                        {visible.map((c) => (
                            <th key={c.key} className="font-normal py-1 px-2 text-right">
                                {c.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {data.rows.map((row) => (
                        <tr
                            key={row.companyId}
                            onClick={(e) => {
                                e.stopPropagation();
                                wm.open('company', { payload: { companyId: row.companyId, companyName: row.name } });
                            }}
                            className="border-t border-border hover:bg-background-card cursor-pointer align-top"
                        >
                            <td className="py-2 pr-2">
                                <div className="flex items-center gap-2">
                                    <span aria-hidden className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.color ?? '#64748b' }} />
                                    <span className="font-medium">{row.name}</span>
                                </div>
                                {row.changes.length ? <div className="mt-0.5 text-[11px] text-text-secondary">{row.changes[0]}</div> : null}
                            </td>
                            {visible.map((c) => {
                                const m = row.metrics[c.key];
                                return (
                                    <td key={c.key} className="py-2 px-2 text-right tabular-nums whitespace-nowrap">
                                        {m ? (
                                            <>
                                                <div>{formatMetric(m.unit, m.current)}</div>
                                                <ChangeBadge change={m.change} />
                                            </>
                                        ) : (
                                            <span className="text-text-secondary">–</span>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="text-[11px] text-text-secondary">Last 7 complete days vs the 7 before. Subscribers and MRR are current values vs a week ago.</p>
        </div>
    );
}
