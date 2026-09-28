'use client';

import { useCallback, useEffect, useState } from 'react';

interface CodeRepository {
    fullName: string;
    defaultBranch: string;
    appConnected: boolean;
}

interface CodeProject {
    projectId: string;
    projectName: string;
    repository: CodeRepository | null;
}

interface CompanyCode {
    githubConfigured: boolean;
    canManage: boolean;
    projects: CodeProject[];
}

interface AppRepository {
    fullName: string;
    defaultBranch: string;
    private: boolean;
}

/**
 * GitHub for one company: each project's repository (what Ask plans against and Building builds
 * from), with a picker of every repository the GitHub App can reach.
 */
export default function CodeRepositories({ companyId, compact = false }: { companyId: string; compact?: boolean }) {
    const [code, setCode] = useState<CompanyCode | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [repos, setRepos] = useState<AppRepository[] | null>(null);
    const [choice, setChoice] = useState('');
    const [filter, setFilter] = useState('');
    const [busy, setBusy] = useState(false);

    const [reloadKey, setReloadKey] = useState(0);
    const load = useCallback(() => setReloadKey((k) => k + 1), []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/companies/${companyId}/code`, { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as CompanyCode & { error?: string };
            if (cancelled) return;
            if (!res.ok) setError(body.error ?? `Failed (${res.status})`);
            else {
                setCode(body);
                setError(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId, reloadKey]);

    const startEditing = async (project: CodeProject, refresh = false) => {
        setEditing(project.projectId);
        setChoice(project.repository?.fullName ?? '');
        setFilter('');
        if (repos && !refresh) return;
        setRepos(null);
        const res = await fetch(`/api/os/github/repositories${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as { repositories?: AppRepository[]; error?: string };
        if (!res.ok) {
            setError(body.error ?? `Failed (${res.status})`);
            setRepos([]);
        } else setRepos(body.repositories ?? []);
    };

    const save = async (projectId: string) => {
        if (!choice) return;
        setBusy(true);
        const res = await fetch(`/api/os/companies/${companyId}/code`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectId, fullName: choice }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setBusy(false);
        if (!res.ok) return setError(body.error ?? `Failed (${res.status})`);
        setEditing(null);
        load();
    };

    const disconnect = async (project: CodeProject) => {
        if (!window.confirm(`Disconnect ${project.repository?.fullName} from ${project.projectName}? Ask can no longer plan changes against it.`)) return;
        const res = await fetch(`/api/os/companies/${companyId}/code?projectId=${encodeURIComponent(project.projectId)}`, { method: 'DELETE' });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return setError(body.error ?? `Failed (${res.status})`);
        load();
    };

    if (!code) return error ? <p className="text-xs text-red-400">{error}</p> : null;

    const shown = (repos ?? []).filter((r) => !filter || r.fullName.toLowerCase().includes(filter.toLowerCase()));

    return (
        <section>
            <h3 className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">Code repository</h3>
            {!code.githubConfigured ? <p className="text-xs text-amber-400 mb-1">The GitHub App is not configured on the server.</p> : null}
            {code.projects.length === 0 ? (
                <p className="text-sm text-text-secondary">This company has no project yet, so there is nowhere to connect a repository.</p>
            ) : (
                <ul className="rounded-md border border-border divide-y divide-border">
                    {code.projects.map((p) => (
                        <li key={p.projectId} className="px-3 py-2 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="flex-1 min-w-0">
                                    {code.projects.length > 1 || !compact ? <span className="block text-[11px] text-text-secondary">{p.projectName}</span> : null}
                                    {p.repository ? (
                                        <a
                                            href={`https://github.com/${p.repository.fullName}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block text-sm truncate hover:underline"
                                        >
                                            {p.repository.fullName}
                                            <span className="ml-2 text-[11px] text-text-secondary">{p.repository.defaultBranch}</span>
                                        </a>
                                    ) : (
                                        <span className="block text-sm text-text-secondary">Not connected</span>
                                    )}
                                </span>
                                {p.repository ? (
                                    <span
                                        className={`text-[10px] px-1.5 py-0.5 rounded border ${p.repository.appConnected ? 'text-emerald-400 border-emerald-400/40' : 'text-amber-400 border-amber-400/40'}`}
                                    >
                                        {p.repository.appConnected ? 'Connected' : 'App not installed'}
                                    </span>
                                ) : null}
                                {code.canManage && code.githubConfigured && editing !== p.projectId ? (
                                    <button
                                        type="button"
                                        onClick={() => void startEditing(p)}
                                        className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card"
                                    >
                                        {p.repository ? 'Change' : 'Connect'}
                                    </button>
                                ) : null}
                                {code.canManage && p.repository && editing !== p.projectId ? (
                                    <button
                                        type="button"
                                        onClick={() => void disconnect(p)}
                                        className="text-[11px] px-1.5 py-0.5 rounded border border-border hover:bg-background-card"
                                        aria-label={`Disconnect ${p.repository.fullName}`}
                                        title="Disconnect"
                                    >
                                        ✕
                                    </button>
                                ) : null}
                            </div>
                            {editing === p.projectId ? (
                                <div className="space-y-1">
                                    {repos === null ? (
                                        <p className="text-xs text-text-secondary">Loading repositories from GitHub…</p>
                                    ) : (
                                        <>
                                            <input
                                                value={filter}
                                                onChange={(e) => setFilter(e.target.value)}
                                                placeholder={`Filter ${repos.length} repositories`}
                                                className="h-7 w-full px-2 rounded border border-border bg-background-elevated text-xs"
                                                aria-label="Filter repositories"
                                            />
                                            <select
                                                value={choice}
                                                onChange={(e) => setChoice(e.target.value)}
                                                size={Math.min(8, Math.max(3, shown.length))}
                                                className="w-full rounded border border-border bg-background-elevated text-xs"
                                                aria-label="Repository"
                                            >
                                                {shown.map((r) => (
                                                    <option key={r.fullName} value={r.fullName}>
                                                        {r.fullName}
                                                        {r.private ? ' · private' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                            <p className="text-[10px] text-text-secondary">
                                                Missing a repository? Install the Nucleas GitHub App on it (or on the client&apos;s account), then{' '}
                                                <button type="button" className="underline" onClick={() => void startEditing(p, true)}>
                                                    refresh
                                                </button>
                                                .
                                            </p>
                                        </>
                                    )}
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            disabled={!choice || busy}
                                            onClick={() => void save(p.projectId)}
                                            className="text-[11px] px-2 py-1 rounded bg-primary text-white disabled:opacity-50"
                                        >
                                            {busy ? 'Saving…' : 'Save'}
                                        </button>
                                        <button type="button" onClick={() => setEditing(null)} className="text-[11px] px-2 py-1 rounded border border-border">
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
            {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
        </section>
    );
}
