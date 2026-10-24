'use client';

import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { RoundupAction, RoundupDraft, RoundupMutationResponse, RoundupResponse } from '@/lib/roundups/types';
import { useOsCompanies } from '../CompaniesModule';
import { useWindowManager } from '@/hooks/os/useWindowManager';

const date = (value: string | null) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'the previous published update';
const running = (draft: RoundupDraft) => ['queued', 'generating', 'publishing'].includes(draft.status);

export default function ReleaseUpdatesPanel({ initialCompanyId }: { initialCompanyId?: string }) {
    const { companies, error: companyError } = useOsCompanies();
    const [selected, setSelected] = useState(initialCompanyId ?? '');
    const companyId = selected || (companies?.length === 1 ? companies[0].id : '');
    const [data, setData] = useState<RoundupResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [reload, setReload] = useState(0);
    const wm = useWindowManager();
    const refresh = useCallback(() => setReload(value => value + 1), []);
    useEffect(() => { setData(null); setError(null); }, [companyId]);
    useEffect(() => {
        if (!companyId) return;
        let cancelled = false;
        void fetch(`/api/os/content/roundups?companyId=${companyId}`, { cache: 'no-store' })
            .then(async response => {
                const body = await response.json();
                if (!response.ok) throw new Error(body.error ?? 'Could not load update posts.');
                if (!cancelled) { setData(body); setError(null); }
            }).catch(problem => { if (!cancelled) setError(problem instanceof Error ? problem.message : 'Could not load update posts.'); });
        return () => { cancelled = true; };
    }, [companyId, reload]);
    const active = data?.drafts[0];
    const isRunning = Boolean(active && running(active));
    useEffect(() => {
        if (!isRunning) return;
        const timer = window.setInterval(refresh, 4000);
        return () => window.clearInterval(timer);
    }, [isRunning, refresh]);
    const mutate = async (action: RoundupAction): Promise<RoundupDraft | undefined> => {
        setBusy(true); setError(null);
        try {
            const response = await fetch('/api/os/content/roundups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) });
            const body = await response.json() as RoundupMutationResponse & { error?: string };
            if (!response.ok) throw new Error(body.error ?? 'The update could not be saved.');
            refresh();
            window.dispatchEvent(new Event('nucleas:jobs-changed'));
            return body.draft;
        } catch (problem) {
            setError(problem instanceof Error ? problem.message : 'The update could not be saved.');
            throw problem;
        } finally { setBusy(false); }
    };
    const company = companies?.find(entry => entry.id === companyId);
    return <div className="space-y-4 p-4">
        <header className="space-y-2">
            <h2 className="text-base font-semibold">Update posts</h2>
            <p className="text-sm text-text-secondary">Turn shipped releases and newly published games into a focused changelog. Run it when you are ready, then review before publishing.</p>
            <label className="block text-xs text-text-secondary">Company
                <select aria-label="Update post company" className="ui-control mt-1 block w-full sm:max-w-xs" value={companyId} onChange={event => setSelected(event.target.value)} disabled={busy}>
                    <option value="">Choose a company…</option>
                    {(companies ?? []).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
            </label>
        </header>
        {error || companyError ? <p role="alert" className="text-sm text-red-400">{error ?? companyError}<button type="button" className="ml-2 underline" onClick={refresh}>Reload</button></p> : null}
        {!companyId ? <p className="text-sm text-text-secondary">Choose the company whose updates you want to publish.</p> : !data ? <p role="status" className="text-sm text-text-secondary">Loading update posts…</p> : <>
            {data.setupRequirements.length && !active ? <div className="ui-card space-y-2 p-4">
                <h3 className="text-sm font-medium">Finish setup once</h3>
                <ul className="list-disc space-y-1 pl-4 text-xs text-text-secondary">{data.setupRequirements.map(requirement => <li key={requirement.code}>{requirement.message}</li>)}</ul>
                <button type="button" className="ui-button" onClick={() => wm.open('company', { payload: { companyId, companyName: company?.name ?? 'Company' } })}>Open company setup</button>
            </div> : null}
            {active ? <RoundupReview key={`${active.id}:${active.status}`} draft={active} companyName={company?.name ?? 'the company'} busy={busy} canPublish={data.permissions.canPublish} canEdit={data.permissions.canDraft} canManage={data.permissions.canManage} onAction={mutate} /> : <div className="ui-card space-y-3 p-4">
                <p className="text-sm">{data.settings.coverageEnd ? `Next post covers changes since ${date(data.settings.coverageEnd)}.` : 'Your first draft starts from the last published update on your site.'}</p>
                <button type="button" className="ui-button-primary" disabled={busy || !data.permissions.canDraft || data.setupRequirements.length > 0} onClick={() => void mutate({ companyId, action: 'generate' }).catch(() => {})}>{busy ? 'Starting…' : 'Create update post'}</button>
                <p className="text-xs text-text-secondary">Nothing is published until you accept the draft.</p>
            </div>}
            <details className="text-xs" key={`settings-${data.settings.repoIds.join(',')}`}>
                <summary className="cursor-pointer text-text-secondary">Sources and settings</summary>
                <div className="mt-3 space-y-3">
                    <p className="text-text-secondary">Published catalog games come from {company?.domain || 'the company website'}. Only published GitHub releases are included. Internal maintenance is left out.</p>
                    <RepositorySelection data={data} busy={busy || Boolean(active)} onSave={ids => mutate({ action: 'configure', companyId, repoIds: ids }).then(() => {})} />
                </div>
            </details>
            {data.history.length ? <details className="text-xs"><summary className="cursor-pointer text-text-secondary">Previous posts and rejected drafts ({data.history.length})</summary><ul className="mt-2 space-y-2">{data.history.map(draft => <li key={draft.id} className="ui-card p-3"><span className="font-medium">{draft.title || 'Update draft'}</span><span className="ml-2 text-text-secondary">{draft.status === 'published' ? 'Published' : 'Rejected'} · {date(draft.updatedAt)}</span>{draft.publishedUrl ? <a className="ml-2 text-primary underline" href={draft.publishedUrl} target="_blank" rel="noreferrer">View post</a> : null}</li>)}</ul></details> : null}
        </>}
    </div>;
}

function RepositorySelection({ data, busy, onSave }: { data: RoundupResponse; busy: boolean; onSave: (ids: string[]) => Promise<void> }) {
    const [ids, setIds] = useState(data.settings.repoIds);
    return <fieldset disabled={busy || !data.permissions.canManage} className="space-y-2"><legend className="font-medium">Release repositories</legend>
        {data.settings.availableRepos.map(repo => <label key={repo.id} className="flex items-center gap-2"><input type="checkbox" checked={ids.includes(repo.id)} onChange={event => setIds(event.target.checked ? [...ids, repo.id] : ids.filter(id => id !== repo.id))} />{repo.name}</label>)}
        {data.settings.availableRepos.length ? <button type="button" className="ui-button" disabled={!ids.length || JSON.stringify(ids.slice().sort()) === JSON.stringify(data.settings.repoIds.slice().sort())} onClick={() => void onSave(ids).catch(() => {})}>Save sources</button> : <p className="text-text-secondary">Connect a GitHub repository in company setup.</p>}
        {busy ? <p className="text-text-secondary">Sources stay fixed while a draft is open.</p> : null}
    </fieldset>;
}

export function RoundupReview({ draft, companyName, busy, canPublish, canEdit, canManage, onAction }: { draft: RoundupDraft; companyName: string; busy: boolean; canPublish: boolean; canEdit: boolean; canManage: boolean; onAction: (action: RoundupAction) => Promise<RoundupDraft | undefined> }) {
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(draft.title);
    const [summary, setSummary] = useState(draft.summary);
    const [body, setBody] = useState(draft.bodyMarkdown);
    const changed = title !== draft.title || summary !== draft.summary || body !== draft.bodyMarkdown;
    const save = async () => {
        await onAction({ companyId: draft.companyId, action: 'save', id: draft.id, title, summary, bodyMarkdown: body });
        setEditing(false);
    };
    const publish = async () => {
        if (changed) await save();
        await onAction({ companyId: draft.companyId, action: 'publish', id: draft.id });
    };
    return <article className="ui-card space-y-4 p-4">
        <div><p className="text-xs text-text-secondary">{draft.status === 'draft' ? 'Ready for your review' : draft.status === 'publish_uncertain' ? 'Publication needs confirmation' : draft.progress}</p>{draft.coverageEnd ? <p className="mt-1 text-xs text-text-secondary">Covers {date(draft.coverageStart)} – {date(draft.coverageEnd)}</p> : null}</div>
        {draft.error ? <p role="alert" className="text-sm text-red-400">{draft.error}</p> : null}
        {running(draft) ? <p role="status" className="text-sm text-text-secondary">{draft.progress}. You can close this window and return later.</p> : null}
        {draft.status === 'draft' && editing ? <div className="space-y-3">
            <label className="block text-xs text-text-secondary">Title<input className="ui-control mt-1 w-full" aria-label="Update post title" value={title} onChange={event => setTitle(event.target.value)} maxLength={160} disabled={busy} /></label>
            <label className="block text-xs text-text-secondary">Short introduction<textarea className="ui-control mt-1 w-full resize-y" aria-label="Update post summary" value={summary} onChange={event => setSummary(event.target.value)} maxLength={400} disabled={busy} /></label>
            <label className="block text-xs text-text-secondary">Post<textarea className="ui-control mt-1 min-h-80 w-full resize-y font-mono text-sm" aria-label="Update post body" value={body} onChange={event => setBody(event.target.value)} maxLength={40000} disabled={busy} /></label>
            <p className="text-xs text-text-secondary">Use ## for section headings and - for changelog bullets.</p>
        </div> : draft.bodyMarkdown ? <div><h3 className="mb-2 text-lg font-semibold">{title || draft.title}</h3><p className="mb-3 text-sm text-text-secondary">{summary || draft.summary}</p><div className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{body || draft.bodyMarkdown}</ReactMarkdown></div></div> : null}
        {draft.status === 'draft' ? <div className="flex flex-wrap items-center gap-2">
            {canPublish ? <button type="button" className="ui-button-primary" disabled={busy || !title.trim() || !summary.trim() || !body.trim()} onClick={() => void publish().catch(() => {})}>{busy ? 'Saving…' : 'Accept and publish'}</button> : <span className="text-xs text-text-secondary">A manager can publish this post.</span>}
            {canEdit ? editing ? <button type="button" className="ui-button" disabled={busy} onClick={() => void save().catch(() => {})}>Save and preview</button> : <button type="button" className="ui-button" disabled={busy} onClick={() => setEditing(true)}>Edit inline</button> : null}
            {canManage ? <button type="button" className="ui-button text-red-300" disabled={busy} onClick={() => void onAction({ companyId: draft.companyId, action: 'reject', id: draft.id }).catch(() => {})}>Reject draft</button> : null}
            <span className="w-full text-xs text-text-secondary">Accept publishes this post to {companyName}. Reject keeps these changes available for your next draft.</span>
        </div> : null}
        {draft.status === 'failed' ? <div className="flex gap-2">{canEdit ? <button type="button" className="ui-button-primary" disabled={busy} onClick={() => void onAction({ companyId: draft.companyId, action: 'generate' }).catch(() => {})}>Try again</button> : null}{canManage ? <button type="button" className="ui-button" disabled={busy} onClick={() => void onAction({ companyId: draft.companyId, action: 'reject', id: draft.id }).catch(() => {})}>Dismiss draft</button> : null}</div> : null}
        {draft.status === 'publish_uncertain' && canPublish ? <div className="space-y-2"><p className="text-xs text-text-secondary">The site may have received this post. Check the same publication safely; this will not create a second copy.</p><button type="button" className="ui-button-primary" disabled={busy} onClick={() => void onAction({ companyId: draft.companyId, action: 'publish', id: draft.id }).catch(() => {})}>{busy ? 'Checking publication…' : 'Check publication'}</button></div> : null}
        <details className="text-xs"><summary className="cursor-pointer text-text-secondary">Sources and run details</summary><ul className="mt-2 space-y-1">{draft.details.sources.map(source => <li key={source.id}><a href={source.url} className="text-primary underline" target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>{draft.details.warnings?.length ? <ul className="mt-3 list-disc space-y-1 pl-4 text-amber-300">{draft.details.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}<ul className="mt-3 space-y-1 text-text-secondary">{draft.details.logs.map((log, index) => <li key={index}>{log.message}</li>)}</ul></details>
    </article>;
}
