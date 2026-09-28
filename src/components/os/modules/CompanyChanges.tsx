'use client';

import { useEffect, useState } from 'react';

interface ChangeItem {
    at: string;
    kind: 'code' | 'build' | 'action' | 'integration' | 'company';
    title: string;
    detail?: string;
    by?: string;
}

const KIND_LABEL: Record<ChangeItem['kind'], string> = {
    code: 'Code',
    build: 'Build',
    action: 'Action',
    integration: 'Integration',
    company: 'Company',
};

function when(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** The same "what changed recently" timeline Ask uses: commits, builds, actions and integration changes. */
export default function CompanyChanges({ companyId }: { companyId: string }) {
    const [items, setItems] = useState<ChangeItem[] | null>(null);
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/companies/${companyId}/changes?limit=40`, { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as { items?: ChangeItem[] };
            if (!cancelled) setItems(res.ok ? (body.items ?? []) : []);
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId]);

    if (items === null || items.length === 0) return null;
    const shown = showAll ? items : items.slice(0, 8);
    return (
        <section>
            <h3 className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">Recent changes</h3>
            <ul className="rounded-md border border-border divide-y divide-border">
                {shown.map((c, i) => (
                    <li key={`${c.at}-${i}`} className="px-3 py-1.5 flex gap-2 text-xs">
                        <span className="w-24 flex-shrink-0 text-text-secondary">{when(c.at)}</span>
                        <span className="w-16 flex-shrink-0 text-text-secondary">{KIND_LABEL[c.kind]}</span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate" title={c.title}>
                                {c.title}
                            </span>
                            {c.detail || c.by ? (
                                <span className="block truncate text-[11px] text-text-secondary" title={c.detail}>
                                    {[c.by, c.detail].filter(Boolean).join(' · ')}
                                </span>
                            ) : null}
                        </span>
                    </li>
                ))}
            </ul>
            {items.length > 8 ? (
                <button type="button" className="mt-1 text-[11px] text-text-secondary underline" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? 'Show fewer' : `Show all ${items.length}`}
                </button>
            ) : null}
        </section>
    );
}
