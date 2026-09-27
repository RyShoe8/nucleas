'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import type { ModuleRenderContext } from '@/lib/os/types';
import { RELATIONSHIP_LABEL, type OsCompanyDetail, type OsConnection } from './companyTypes';
import CompanySnapshot from './CompanySnapshot';
import CompanyActivity from './CompanyActivity';

export default function CompanyModule({ payload }: ModuleRenderContext) {
    const companyId = payload?.companyId;
    const [detail, setDetail] = useState<OsCompanyDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activityKey, setActivityKey] = useState(0);

    const load = useCallback(async () => {
        if (!companyId) return;
        try {
            const res = await fetch(`/api/os/companies/${companyId}`);
            if (!res.ok) throw new Error(res.status === 404 ? 'Company not found' : `HTTP ${res.status}`);
            setDetail((await res.json()) as OsCompanyDetail);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'unknown');
        }
    }, [companyId]);

    useEffect(() => {
        void load();
    }, [load]);

    if (!companyId) return <div className="p-4 text-sm text-text-secondary">No company selected.</div>;
    if (error) return <div className="p-4 text-sm text-red-400">{error}</div>;
    if (!detail) return <div className="p-4 text-sm text-text-secondary">Loading…</div>;

    const { company, projects, connections } = detail;

    return (
        <div className="h-full overflow-y-auto p-4 space-y-5 text-text-primary">
            <header className="flex items-start gap-3">
                <span
                    aria-hidden
                    className="mt-1 h-3 w-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: company.color ?? '#64748b' }}
                />
                <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold leading-tight">{company.name}</h2>
                    <p className="text-xs text-text-secondary">
                        {RELATIONSHIP_LABEL[company.relationship]}
                        {' · '}
                        {company.domain ?? 'No production domain'}
                        {company.devUrl ? ` · dev ${company.devUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : ''}
                    </p>
                    {company.description ? (
                        <p className="mt-1 text-sm text-text-secondary line-clamp-2">{company.description}</p>
                    ) : null}
                </div>
                <AskButton companyId={company.id} companyName={company.name} />
            </header>

            <CompanySnapshot
                companyId={company.id}
                connections={connections.filter((c) => c.status === 'connected')}
                onActivity={() => setActivityKey((k) => k + 1)}
            />
            <ProjectsSection projects={projects} />
            <CompanyActivity companyId={company.id} refreshKey={activityKey} />
            <IntegrationsSummary companyId={company.id} companyName={company.name} connections={connections} />
        </div>
    );
}

function AskButton({ companyId, companyName }: { companyId: string; companyName: string }) {
    const wm = useWindowManager();
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                wm.open('assistant', { payload: { companyId, companyName } });
            }}
            className="flex-shrink-0 text-xs px-3 py-1.5 rounded-md bg-primary text-white hover:opacity-90"
        >
            ✨ Ask Nucleas
        </button>
    );
}

/** One line: connection counts, problems highlighted, and a link to the Integrations window. */
function IntegrationsSummary({ companyId, companyName, connections }: { companyId: string; companyName: string; connections: OsConnection[] }) {
    const wm = useWindowManager();
    const connected = connections.filter((c) => c.status === 'connected');
    const problems = connections.filter((c) => c.status === 'needs_reauth' || c.status === 'error');
    const notConnected = connections.filter((c) => c.status === 'declared');
    return (
        <section
            className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 ${problems.length ? 'border-amber-400/50' : 'border-border'}`}
        >
            <p className="text-xs min-w-0 truncate">
                <span className="text-text-secondary">Integrations: </span>
                {problems.length ? (
                    <span className="text-amber-400">
                        {problems.map((p) => p.providerName).join(', ')} need{problems.length === 1 ? 's' : ''} reconnecting ·{' '}
                    </span>
                ) : null}
                <span>{connected.length} connected</span>
                {notConnected.length ? <span className="text-text-secondary"> · {notConnected.length} not connected</span> : null}
            </p>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    wm.open('integrations', { payload: { companyId, companyName } });
                }}
                className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card flex-shrink-0"
            >
                Manage
            </button>
        </section>
    );
}

function ProjectsSection({ projects }: { projects: OsCompanyDetail['projects'] }) {
    const wm = useWindowManager();
    return (
        <section>
            <h3 className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">Projects</h3>
            {projects.length === 0 ? (
                <p className="text-sm text-text-secondary">No projects linked.</p>
            ) : (
                <ul className="rounded-md border border-border divide-y divide-border">
                    {projects.map((p) => (
                        <li key={p.id}>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    wm.open('project-detail', { payload: { projectId: p.id, projectName: p.name } });
                                }}
                                className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-background-card text-left"
                            >
                                <span className="text-sm truncate">
                                    {p.name}
                                    {p.isHub ? <span className="ml-2 text-[11px] text-text-secondary">main</span> : null}
                                </span>
                                <span className="text-[11px] text-text-secondary flex-shrink-0">
                                    {p.openTasks} open · {p.totalTasks} tasks · {p.status}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

