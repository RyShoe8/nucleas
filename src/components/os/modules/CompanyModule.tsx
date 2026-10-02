'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import type { ModuleRenderContext } from '@/lib/os/types';
import { RELATIONSHIP_LABEL, type OsCompanyDetail, type OsConnection } from './companyTypes';
import CompanySnapshot from './CompanySnapshot';
import { setAssistantFocus } from '@/lib/os/assistantFocus';
import CompanyActivity from './CompanyActivity';
import CodeRepositories from './CodeRepositories';
import AdminAccount from './AdminAccount';
import CompanyChanges from './CompanyChanges';
import PropertyOverviewButton from './PropertyOverviewReport';

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
        <div className="h-full overflow-y-auto p-5 space-y-5 text-text-primary">
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
                        {company.devUrl ? ` · dev ${company.devUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : ''}
                    </p>
                    <ProductionDomainEditor
                        companyId={company.id}
                        domain={company.domain}
                        canManage={detail.canManage}
                        onSaved={(domain) => {
                            setDetail((current) => current ? { ...current, company: { ...current.company, domain: domain ?? undefined } } : current);
                            setActivityKey((key) => key + 1);
                        }}
                    />
                    {company.description ? (
                        <p className="mt-1 text-sm text-text-secondary line-clamp-2">{company.description}</p>
                    ) : null}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                    <PropertyOverviewButton companyId={company.id} companyName={company.name} canManage={detail.canManage} />
                    <MarketingPlanButton companyId={company.id} companyName={company.name} />
                    <AskButton companyId={company.id} companyName={company.name} />
                </div>
            </header>

            <CompanySnapshot
                companyId={company.id}
                connections={connections.filter((c) => c.status === 'connected')}
                aiCitations={detail.stats?.aiCitations ?? 0}
                onActivity={() => setActivityKey((k) => k + 1)}
            />
            <ProjectsSection projects={projects} />
            <CodeRepositories companyId={company.id} compact />
            <AdminAccount companyId={company.id} defaultDomain={company.domain} />
            <CompanyChanges companyId={company.id} />
            <CompanyActivity companyId={company.id} refreshKey={activityKey} />
            <IntegrationsSummary companyId={company.id} companyName={company.name} connections={connections} />
        </div>
    );
}

function ProductionDomainEditor({ companyId, domain, canManage, onSaved }: { companyId: string; domain?: string; canManage: boolean; onSaved: (domain: string | null) => void }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(domain ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => setValue(domain ?? ''), [domain]);

    async function save(event: FormEvent) {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError(null);
        try {
            const response = await fetch(`/api/os/companies/${companyId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ domain: value }),
            });
            const data = await response.json().catch(() => ({})) as { domain?: string | null; error?: string };
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            onSaved(data.domain ?? null);
            setEditing(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the production domain.');
        } finally {
            setSaving(false);
        }
    }

    if (!editing) {
        return (
            <div className="mt-1 flex items-center gap-2 text-xs">
                {domain ? (
                    <a href={`https://${domain}`} target="_blank" rel="noreferrer" className="text-primary hover:underline" onClick={(event) => event.stopPropagation()}>{domain}</a>
                ) : (
                    <span className="text-text-secondary">No production domain</span>
                )}
                {canManage ? (
                    <button type="button" className="text-[11px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline" onClick={() => { setValue(domain ?? ''); setError(null); setEditing(true); }}>
                        {domain ? 'Edit' : 'Set domain'}
                    </button>
                ) : null}
            </div>
        );
    }

    return (
        <form onSubmit={save} className="mt-2 max-w-md space-y-1.5">
            <label className="block text-[11px] text-text-secondary" htmlFor={`production-domain-${companyId}`}>Production domain</label>
            <div className="flex gap-2">
                <input
                    id={`production-domain-${companyId}`}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder="example.com"
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-text-primary"
                />
                <button type="submit" disabled={saving} className="rounded bg-primary px-2.5 py-1 text-xs text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
                <button type="button" disabled={saving} className="rounded border border-border px-2.5 py-1 text-xs hover:bg-background-card disabled:opacity-50" onClick={() => { setEditing(false); setError(null); setValue(domain ?? ''); }}>Cancel</button>
            </div>
            <p className="text-[11px] text-text-secondary">Used to match analytics, search, hosting, and other company integrations. This does not change DNS.</p>
            {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
        </form>
    );
}

function AskButton({ companyId, companyName }: { companyId: string; companyName: string }) {
    const wm = useWindowManager();
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                setAssistantFocus({ companyId, companyName });
                wm.open('assistant');
            }}
            className="ui-button-primary flex-shrink-0"
        >
            ✨ Ask Nucleas
        </button>
    );
}

function MarketingPlanButton({ companyId, companyName }: { companyId: string; companyName: string }) {
    const wm = useWindowManager();
    return <button type="button" onClick={(e) => { e.stopPropagation(); wm.open('marketing', { payload: { companyId, companyName, kind: 'seo_brief' } }); }} className="ui-button flex-shrink-0">Marketing plan</button>;
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
            <h3 className="ui-kicker mb-2">Projects</h3>
            {projects.length === 0 ? (
                <p className="text-sm text-text-secondary">No projects linked.</p>
            ) : (
                <ul className="ui-card ui-divider-list overflow-hidden">
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
