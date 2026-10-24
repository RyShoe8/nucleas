'use client';

import { useEffect, useState } from 'react';
import type { WebsiteConnectionView } from '@/lib/connectors/connections';
import type { WebsiteConnectorConfig } from '@/lib/connectors/contracts';

/** One optional setup section. Preparing a connection never changes existing jobs. */
export default function WebsiteConnectionPanel({ companyId, domain }: { companyId: string; domain?: string }) {
    const [opened, setOpened] = useState(false);
    return <details className="rounded border border-border p-3" onToggle={event => setOpened(event.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-medium">Website publishing connection</summary>
        {opened ? <ConnectionForm companyId={companyId} domain={domain} /> : null}
    </details>;
}
function ConnectionForm({ companyId, domain }: { companyId: string; domain?: string }) {
    const [data, setData] = useState<WebsiteConnectionView | null>(null);
    const [config, setConfig] = useState<WebsiteConnectorConfig | null>(null);
    const [credential, setCredential] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sample, setSample] = useState<{ title: string; url: string } | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        void fetch(`/api/os/companies/${companyId}/website-connection`, { cache: 'no-store' }).then(async response => {
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? 'Could not load connection.');
            if (!cancelled) {
                setData(body);
                let origin = '';
                try { origin = new URL(domain?.includes('://') ? domain : `https://${domain}`).origin; } catch {}
                setConfig(body.connection?.config ?? { version: 1, adapter: 'website-v1', origin, endpointPath: '/api/nucleas/v1', enabled: false, permissions: ['content.items.list'], collection: 'published-items' });
            }
        }).catch(problem => { if (!cancelled) setError(problem.message); });
        return () => { cancelled = true; };
    }, [companyId, domain]);
    const action = async (kind: 'save' | 'test', enabled = config?.enabled ?? false) => {
        if (!config) return;
        setBusy(true); setError(null); setMessage(null);
        try {
            const response = await fetch(`/api/os/companies/${companyId}/website-connection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(kind === 'test' ? { action: 'test' } : { action: 'save', config: { ...config, enabled }, ...(credential ? { credential } : {}), expectedRevision: data?.connection?.revision ?? 0 }) });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? 'Connection request failed.');
            const view: WebsiteConnectionView = body.view ?? body;
            setData(view); setConfig(view.connection!.config); setCredential(''); setSample(body.sample ?? null);
            setMessage(kind === 'test' ? 'Read-only test passed. No post or draft was created on the website.' : enabled ? 'Connection enabled for future connector drafts.' : 'Connection prepared. Existing jobs keep their current delivery path.');
            window.dispatchEvent(new Event('nucleas:companies-changed'));
        } catch (problem) { setError(problem instanceof Error ? problem.message : 'Connection request failed.'); }
        finally { setBusy(false); }
    };
    if (!data || !config) return <p className="mt-3 text-xs text-text-secondary">{error ?? 'Loading connection…'}</p>;
    const change = (patch: Partial<WebsiteConnectorConfig>) => { setConfig({ ...config, ...patch }); setMessage(null); setSample(null); };
    const changed = !data.connection || JSON.stringify(config) !== JSON.stringify(data.connection.config) || Boolean(credential);
    return <div className="mt-3 space-y-3 text-xs">
        <p className="text-text-secondary">Prepare and test website access here. Current jobs are not migrated automatically.</p>
        {!data.rolloutAvailable ? <p className="text-text-secondary">The reusable path is not activated yet. You can save and test this connection without changing live workflows.</p> : null}
        <fieldset disabled={!data.canManage || busy} className="space-y-3">
            <label className="block">Connection type<select aria-label="Website connection type" className="ui-control mt-1 block w-full" value={config.adapter} onChange={event => change({ adapter: event.target.value as WebsiteConnectorConfig['adapter'] })}><option value="website-v1">Reusable website API</option><option value="playbound-roundup-v0">Existing roundup endpoint (compatibility)</option></select></label>
            <label className="block">Website<input className="ui-control mt-1 block w-full" value={config.origin} readOnly /><span className="text-text-secondary">Uses the website set on this company.</span></label>
            <label className="block">Published collection<input className="ui-control mt-1 block w-full" value={config.collection} onChange={event => change({ collection: event.target.value })} /></label>
            <details><summary className="cursor-pointer text-text-secondary">Advanced connection settings</summary><div className="mt-2 space-y-2">
                {config.adapter === 'website-v1' ? <label className="block">API path<input className="ui-control mt-1 block w-full" value={config.endpointPath} onChange={event => change({ endpointPath: event.target.value })} /></label> : null}
                <label className="flex items-center gap-2"><input type="checkbox" checked={config.permissions.includes('content.posts.publish')} onChange={event => change({ permissions: event.target.checked ? [...new Set([...config.permissions, 'content.posts.publish' as const])] : config.permissions.filter(permission => permission !== 'content.posts.publish') })} />Allow publishing approved posts</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={config.permissions.includes('content.posts.read')} onChange={event => change({ permissions: event.target.checked ? [...new Set([...config.permissions, 'content.posts.read' as const])] : config.permissions.filter(permission => permission !== 'content.posts.read') })} />Allow checking publication receipts</label>
            </div></details>
            <label className="block">{data.connection?.hasCredential ? 'Replace signing key (optional)' : 'Website signing key'}<input type="password" autoComplete="new-password" className="ui-control mt-1 block w-full" value={credential} onChange={event => setCredential(event.target.value)} /></label>
            <div className="flex flex-wrap gap-2">
                <button type="button" className="ui-button-primary" disabled={!changed || !config.origin} onClick={() => void action('save')}>Save connection</button>
                <button type="button" className="ui-button" disabled={changed || !data.connection} onClick={() => void action('test')}>Test read-only access</button>
                {data.rolloutAvailable && data.connection?.testOk && !changed ? <button type="button" className="ui-button" onClick={() => void action('save', !config.enabled)}>{config.enabled ? 'Pause connector' : 'Use for future update posts'}</button> : null}
            </div>
        </fieldset>
        {error ? <p role="alert" className="text-red-400">{error}</p> : null}
        {message ? <p role="status" className="text-text-secondary">{message}</p> : null}
        {sample ? <p>Sample: <a href={sample.url} className="text-primary underline" target="_blank" rel="noreferrer">{sample.title}</a></p> : null}
        {data.connection?.testError ? <p className="text-text-secondary">{data.connection.testError}</p> : null}
    </div>;
}
