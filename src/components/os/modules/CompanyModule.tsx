'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import type { ModuleRenderContext } from '@/lib/os/types';
import { DOMAIN_LABEL, RELATIONSHIP_LABEL, type OsCompanyDetail, type OsConnection } from './companyTypes';

const STATUS_STYLE: Record<string, string> = {
    connected: 'text-emerald-400 border-emerald-400/40',
    declared: 'text-text-secondary border-border',
    needs_reauth: 'text-amber-400 border-amber-400/40',
    error: 'text-red-400 border-red-400/40',
    disabled: 'text-text-secondary border-border',
};

const STATUS_LABEL: Record<string, string> = {
    connected: 'Connected',
    declared: 'Not connected',
    needs_reauth: 'Reconnect',
    error: 'Error',
    disabled: 'Disabled',
};

export default function CompanyModule({ payload }: ModuleRenderContext) {
    const companyId = payload?.companyId;
    const [detail, setDetail] = useState<OsCompanyDetail | null>(null);
    const [error, setError] = useState<string | null>(null);

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
                <div className="min-w-0">
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
            </header>

            <ProjectsSection projects={projects} />
            <ConnectionsSection companyId={company.id} connections={connections} onChanged={load} />
        </div>
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

function ConnectionsSection({
    companyId,
    connections,
    onChanged,
}: {
    companyId: string;
    connections: OsConnection[];
    onChanged: () => void;
}) {
    const auth = useOsAuth();
    return (
        <section>
            <h3 className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">Integrations</h3>
            {connections.length === 0 ? (
                <p className="text-sm text-text-secondary">No integrations declared yet.</p>
            ) : (
                <ul className="rounded-md border border-border divide-y divide-border">
                    {connections.map((c) => (
                        <ConnectionRow key={c.id} connection={c} onChanged={onChanged} />
                    ))}
                </ul>
            )}
            {auth.isManagerOrAdmin ? <AddIntegration companyId={companyId} onAdded={onChanged} /> : null}
        </section>
    );
}

function AddIntegration({ companyId, onAdded }: { companyId: string; onAdded: () => void }) {
    const [providers, setProviders] = useState<{ id: string; name: string }[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const open = async () => {
        setError(null);
        const res = await fetch(`/api/os/companies/${companyId}/connections`);
        const data = (await res.json().catch(() => ({}))) as { providers?: { id: string; name: string }[]; error?: string };
        if (!res.ok) setError(data.error ?? `Failed (${res.status})`);
        else setProviders(data.providers ?? []);
    };

    const add = async (provider: string) => {
        const res = await fetch(`/api/os/companies/${companyId}/connections`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider }),
        });
        if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            setError(data.error ?? `Failed (${res.status})`);
            return;
        }
        setProviders(null);
        onAdded();
    };

    if (providers === null) {
        return (
            <div className="mt-2">
                <button type="button" onClick={open} className="text-[11px] px-2 py-1 rounded border border-border hover:bg-background-card">
                    + Add integration
                </button>
                {error ? <span className="ml-2 text-[11px] text-red-400">{error}</span> : null}
            </div>
        );
    }
    return (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {providers.length === 0 ? (
                <span className="text-[11px] text-text-secondary">Every available integration is already added.</span>
            ) : (
                providers.map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        onClick={() => add(p.id)}
                        className="text-[11px] px-2 py-1 rounded border border-border hover:bg-background-card"
                    >
                        + {p.name}
                    </button>
                ))
            )}
            <button type="button" onClick={() => setProviders(null)} className="text-[11px] px-2 py-1 text-text-secondary">
                Cancel
            </button>
            {error ? <span className="text-[11px] text-red-400">{error}</span> : null}
        </div>
    );
}

function ConnectionRow({ connection: c, onChanged }: { connection: OsConnection; onChanged: () => void }) {
    const auth = useOsAuth();
    const [editing, setEditing] = useState(false);
    const [credential, setCredential] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch(`/api/os/connections/${c.id}/connect`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ credential }),
            });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) {
                setMessage(data.error ?? `Failed (${res.status})`);
                return;
            }
            setCredential('');
            setEditing(false);
            onChanged();
        } finally {
            setSaving(false);
        }
    };

    const canConnect = c.connectable && auth.isManagerOrAdmin;

    const remove = async () => {
        const warning =
            c.scope === 'org'
                ? `Remove ${c.providerName}? It is a shared account, so this removes it for every company.`
                : `Remove ${c.providerName} from this company? Its saved credential is deleted if nothing else uses it.`;
        if (!window.confirm(warning)) return;
        const res = await fetch(`/api/os/connections/${c.id}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            setMessage(data.error ?? `Failed (${res.status})`);
            return;
        }
        onChanged();
    };
    const detail = [
        c.scope === 'org' ? 'Shared account' : null,
        c.accountLabel,
        c.credentialHint,
        c.planLabel,
    ].filter(Boolean);

    return (
        <li className="px-3 py-2">
            <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-secondary w-20 flex-shrink-0">{DOMAIN_LABEL[c.domain] ?? c.domain}</span>
                <span className="text-sm flex-1 min-w-0 truncate">{c.providerName}</span>
                {c.planLimited ? (
                    <span className="text-[11px] px-1.5 py-0.5 rounded border text-amber-400 border-amber-400/40">Plan-limited</span>
                ) : null}
                <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATUS_STYLE[c.status] ?? STATUS_STYLE.declared}`}>
                    {STATUS_LABEL[c.status] ?? c.status}
                </span>
                {canConnect && !editing ? (
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card"
                    >
                        {c.status === 'connected' ? 'Replace key' : 'Connect'}
                    </button>
                ) : null}
                {c.signIn === 'google' && auth.isManagerOrAdmin && c.companyId ? (
                    <a
                        href={`/api/os/integrations/google/start?companyId=${encodeURIComponent(c.companyId)}`}
                        className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card"
                    >
                        {c.status === 'connected' ? 'Re-sign in' : 'Sign in with Google'}
                    </a>
                ) : null}
                {auth.isManagerOrAdmin && !editing ? (
                    <button
                        type="button"
                        onClick={remove}
                        title={`Remove ${c.providerName}`}
                        aria-label={`Remove ${c.providerName}`}
                        className="text-[11px] px-1.5 py-0.5 rounded text-text-secondary hover:text-red-400"
                    >
                        Remove
                    </button>
                ) : null}
            </div>
            {detail.length ? <p className="mt-0.5 ml-[5.5rem] text-[11px] text-text-secondary truncate">{detail.join(' · ')}</p> : null}
            {c.lastError ? <p className="mt-0.5 ml-[5.5rem] text-[11px] text-red-400">{c.lastError}</p> : null}
            {editing ? (
                <form onSubmit={submit} className="mt-2 ml-[5.5rem] flex items-center gap-2">
                    <input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={credential}
                        onChange={(e) => setCredential(e.target.value)}
                        placeholder={`${c.providerName} API key`}
                        className="flex-1 min-w-0 h-8 px-2 rounded border border-border bg-background-elevated text-sm"
                        autoFocus
                    />
                    <button
                        type="submit"
                        disabled={saving || !credential.trim()}
                        className="h-8 px-3 rounded bg-primary text-white text-sm disabled:opacity-50"
                    >
                        {saving ? 'Verifying…' : 'Verify & save'}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setEditing(false);
                            setCredential('');
                            setMessage(null);
                        }}
                        className="h-8 px-2 text-sm text-text-secondary"
                    >
                        Cancel
                    </button>
                </form>
            ) : null}
            {message ? <p className="mt-1 ml-[5.5rem] text-[11px] text-red-400">{message}</p> : null}
        </li>
    );
}
