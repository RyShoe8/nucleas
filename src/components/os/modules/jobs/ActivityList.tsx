'use client';

import { useEffect, useState } from 'react';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import type { ActivityGroup, ActivityItem } from '@/lib/activity/types-client';

/**
 * Everything Nucleas does outside of jobs (inbox watches, articles and digests, Building runs, Company
 * Overview crawls), shown in the same groups as the jobs so this window is one live view of all activity.
 * Each row opens the window where that work is managed.
 */

export interface Activity {
    items: ActivityItem[];
    busy: boolean;
}

/** The activity list, refreshed every 5 seconds while something runs and every minute otherwise. */
export function useActivity(reloadKey: number): Activity | null {
    const [state, setState] = useState<Activity | null>(null);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const body = (await fetch('/api/os/activity', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }))) as { items?: ActivityItem[] };
            if (cancelled) return;
            const items = body.items ?? [];
            setState({ items, busy: items.some((i) => i.group === 'working') });
        })();
        return () => {
            cancelled = true;
        };
    }, [reloadKey, tick]);
    useEffect(() => {
        const timer = window.setInterval(() => setTick((t) => t + 1), state?.busy ? 5000 : 60_000);
        return () => window.clearInterval(timer);
    }, [state?.busy]);
    return state;
}

/** The items for one group in this window: its categories (all in Jobs) and the chosen company. */
export function activityFor(activity: Activity | null, group: ActivityGroup, companyId: string, categories?: string[]): ActivityItem[] {
    return (activity?.items ?? []).filter((i) => i.group === group && (!categories || categories.includes(i.category)) && (companyId === 'all' || i.companyId === companyId));
}

const TONE: Record<ActivityGroup, string> = {
    you: 'border-amber-400/50 text-amber-300',
    working: 'border-sky-400/50 text-sky-300',
    set: 'border-emerald-400/40 text-emerald-300',
    failed: 'border-red-400/50 text-red-300',
};

export function ActivityRows({ items, showCompany }: { items: ActivityItem[]; showCompany: boolean }) {
    const wm = useWindowManager();
    return (
        <>
            {items.map((item) => (
                <li key={item.id}>
                    <button type="button" onClick={() => wm.open(item.open.window, item.open.payload ? { payload: item.open.payload } : undefined)} className="ui-card-interactive w-full px-3 py-2.5 text-left">
                        <span className="flex items-center gap-2">
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">{item.title}{showCompany && item.companyName && item.kind !== 'overview' ? <span className="text-text-secondary"> · {item.companyName}</span> : null}</span>
                                <span className="block truncate text-[11px] text-text-secondary">{item.detail}</span>
                            </span>
                            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${TONE[item.group]}`}>{item.status}</span>
                        </span>
                        {item.group === 'working' ? (
                            <span className="mt-2 block h-1 overflow-hidden rounded-full bg-background-elevated">
                                <span className="block h-full w-1/3 animate-pulse rounded-full bg-primary" />
                            </span>
                        ) : null}
                    </button>
                </li>
            ))}
        </>
    );
}
