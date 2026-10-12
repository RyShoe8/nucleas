'use client';

import { useState } from 'react';

/** Name and (optional) website for a new company or client. Created companies open in their own window. */
export default function AddCompanyForm({ relationship, onCreated, onCancel }: { relationship: 'owned' | 'client'; onCreated: (company: { id: string; name: string }) => void; onCancel: () => void }) {
    const [name, setName] = useState('');
    const [domain, setDomain] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const noun = relationship === 'owned' ? 'company' : 'client';

    const submit = async () => {
        setBusy(true);
        setError(null);
        const res = await fetch('/api/os/companies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, domain, relationship }) });
        const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: string };
        setBusy(false);
        if (!res.ok || !body.id) return setError(body.error ?? `Failed (${res.status})`);
        window.dispatchEvent(new Event('nucleas:companies-changed'));
        onCreated({ id: body.id, name: body.name ?? name });
    };

    return (
        <form
            className="ui-card m-3 space-y-3 p-4"
            onSubmit={(e) => {
                e.preventDefault();
                if (!busy && name.trim().length >= 2) void submit();
            }}
        >
            <h3 className="text-sm font-semibold">{relationship === 'owned' ? 'Add a company' : 'Add a client'}</h3>
            <p className="text-xs text-text-secondary">{relationship === 'owned' ? 'A business you run yourself.' : 'A business you work for.'} You can fill in the rest from its window.</p>
            <label className="block space-y-1">
                <span className="ui-kicker">Name</span>
                <input className="ui-control w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={relationship === 'owned' ? 'e.g. PlayBound' : 'e.g. Acme Plumbing'} autoFocus />
            </label>
            <label className="block space-y-1">
                <span className="ui-kicker">Website (optional)</span>
                <input className="ui-control w-full" value={domain} onChange={(e) => setDomain(e.target.value)} maxLength={500} placeholder="example.com" inputMode="url" autoCapitalize="none" />
            </label>
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            <div className="flex gap-2">
                <button type="submit" className="ui-button-primary" disabled={busy || name.trim().length < 2}>{busy ? 'Adding…' : `Add ${noun}`}</button>
                <button type="button" className="ui-button" onClick={onCancel}>Cancel</button>
            </div>
        </form>
    );
}
