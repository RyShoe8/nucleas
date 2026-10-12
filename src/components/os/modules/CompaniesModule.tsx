'use client';

import { useEffect, useState } from 'react';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import AddCompanyForm from './AddCompanyForm';
import { RELATIONSHIP_LABEL, type OsCompanySummary } from './companyTypes';

export function useOsCompanies() {
    const [companies, setCompanies] = useState<OsCompanySummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Bumped when a company is added anywhere (this window or another), so every list refreshes.
    const [reload, setReload] = useState(0);

    useEffect(() => {
        const refresh = () => setReload((n) => n + 1);
        window.addEventListener('nucleas:companies-changed', refresh);
        return () => window.removeEventListener('nucleas:companies-changed', refresh);
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/os/companies');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = (await res.json()) as { companies: OsCompanySummary[] };
                if (!cancelled) setCompanies(data.companies);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'unknown');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [reload]);

    return { companies, error };
}

const GROUP_ORDER: OsCompanySummary['relationship'][] = ['internal', 'owned', 'client'];

export default function CompaniesModule() {
    const wm = useWindowManager();
    const { companies, error } = useOsCompanies();
    const auth = useOsAuth();
    const [adding, setAdding] = useState<'owned' | 'client' | null>(null);

    if (error) return <div className="p-4 text-sm text-red-400">Failed to load companies: {error}</div>;
    if (companies === null) return <div className="p-4 text-sm text-text-secondary">Loading companies…</div>;
    const canAdd = auth.isManagerOrAdmin || auth.isAdmin;

    return (
        <div className="touch-comfort h-full overflow-y-auto">
            {canAdd ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                    <button type="button" className={adding === 'owned' ? 'ui-button-primary' : 'ui-button'} onClick={() => setAdding(adding === 'owned' ? null : 'owned')}>Add company</button>
                    <button type="button" className={adding === 'client' ? 'ui-button-primary' : 'ui-button'} onClick={() => setAdding(adding === 'client' ? null : 'client')}>Add client</button>
                </div>
            ) : null}
            {adding ? (
                <AddCompanyForm
                    key={adding}
                    relationship={adding}
                    onCancel={() => setAdding(null)}
                    onCreated={(company) => {
                        setAdding(null);
                        wm.open('company', { payload: { companyId: company.id, companyName: company.name } });
                    }}
                />
            ) : null}
            {companies.length === 0 && !adding ? <div className="p-4 text-sm text-text-secondary">No companies yet.{canAdd ? ' Use Add company or Add client above.' : ''}</div> : null}
            {GROUP_ORDER.map((rel) => {
                const group = companies.filter((c) => c.relationship === rel);
                if (group.length === 0) return null;
                return (
                    <section key={rel}>
                        <h3 className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-text-secondary">
                            {RELATIONSHIP_LABEL[rel]}
                        </h3>
                        <ul className="divide-y divide-border">
                            {group.map((c) => {
                                const connected = c.connections.connected ?? 0;
                                const attention = (c.connections.needs_reauth ?? 0) + (c.connections.error ?? 0);
                                const total = Object.values(c.connections).reduce((a, b) => a + b, 0);
                                return (
                                    <li key={c.id}>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                wm.open('company', { payload: { companyId: c.id, companyName: c.name } });
                                            }}
                                            className="w-full px-4 py-3 hover:bg-background-card cursor-pointer flex items-center gap-3 text-left"
                                        >
                                            <span
                                                aria-hidden
                                                className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                                                style={{ backgroundColor: c.color ?? '#64748b' }}
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-sm text-text-primary truncate">{c.name}</span>
                                                <span className="block text-xs text-text-secondary truncate">
                                                    {c.domain ?? c.devUrl ?? 'No domain yet'}
                                                </span>
                                            </span>
                                            {total > 0 ? (
                                                <span
                                                    className={`text-[11px] flex-shrink-0 ${attention ? 'text-amber-400' : 'text-text-secondary'}`}
                                                >
                                                    {connected}/{total} connected{attention ? ` · ${attention} need attention` : ''}
                                                </span>
                                            ) : null}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
}
