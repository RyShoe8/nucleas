'use client';

import { useEffect, useState } from 'react';

interface Candidate {
    externalId: string;
    label: string;
    detail?: string;
    pinnedTo?: { companyId: string; name: string };
}
interface Account {
    secretId: string;
    accountHint: string;
    candidates: Candidate[];
    error?: string;
}
interface Options {
    noun: string;
    pinned?: { externalId: string; label?: string };
    accounts: Account[];
}

/** Lists what the connected account(s) can see and pins the chosen resource to the company. */
export default function ResourcePicker({
    companyId,
    provider,
    onPinned,
    onClose,
}: {
    companyId: string;
    provider: string;
    onPinned: () => void;
    onClose: () => void;
}) {
    const [options, setOptions] = useState<Options | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/companies/${companyId}/resources/${provider}`);
            const data = (await res.json().catch(() => ({}))) as Options & { error?: string };
            if (cancelled) return;
            if (!res.ok) setError(data.error ?? `Failed (${res.status})`);
            else setOptions(data);
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId, provider]);

    const pin = async (account: Account, candidate: Candidate) => {
        if (candidate.pinnedTo && !window.confirm(`${candidate.label} is pinned to ${candidate.pinnedTo.name}. Move it to this company?`)) return;
        setSaving(true);
        setError(null);
        const res = await fetch(`/api/os/companies/${companyId}/resources/${provider}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ secretId: account.secretId, externalId: candidate.externalId, move: Boolean(candidate.pinnedTo) }),
        });
        setSaving(false);
        if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            setError(data.error ?? `Failed (${res.status})`);
            return;
        }
        onPinned();
    };

    const q = filter.trim().toLowerCase();
    const matches = (c: Candidate) => !q || c.label.toLowerCase().includes(q) || (c.detail ?? '').toLowerCase().includes(q);

    return (
        <div className="mt-2 ml-[5.5rem] rounded border border-border p-2 bg-background-elevated">
            <div className="flex items-center gap-2 mb-2">
                <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={options ? `Search ${options.noun.toLowerCase()}s` : 'Loading…'}
                    className="flex-1 min-w-0 h-7 px-2 rounded border border-border bg-background text-xs"
                    autoFocus
                />
                <button type="button" onClick={onClose} className="text-[11px] text-text-secondary hover:text-text-primary">
                    Close
                </button>
            </div>
            {error ? <p className="text-[11px] text-red-400 mb-1">{error}</p> : null}
            {options === null && !error ? <p className="text-[11px] text-text-secondary">Loading what the account can see…</p> : null}
            {options?.accounts.length === 0 ? <p className="text-[11px] text-text-secondary">No connected account for this integration yet.</p> : null}
            <div className="max-h-56 overflow-y-auto space-y-2">
                {options?.accounts.map((account) => (
                    <div key={account.secretId}>
                        <p className="text-[10px] uppercase tracking-wider text-text-secondary mb-1">{account.accountHint}</p>
                        {account.error ? <p className="text-[11px] text-amber-400">{account.error}</p> : null}
                        <ul>
                            {account.candidates.filter(matches).map((c) => {
                                const current = options.pinned?.externalId === c.externalId;
                                return (
                                    <li key={c.externalId}>
                                        <button
                                            type="button"
                                            disabled={saving || current}
                                            onClick={() => pin(account, c)}
                                            className="w-full text-left px-2 py-1 rounded hover:bg-background-card disabled:opacity-60 flex items-baseline gap-2"
                                        >
                                            <span className="text-xs truncate">{c.label}</span>
                                            {c.detail ? <span className="text-[10px] text-text-secondary truncate">{c.detail}</span> : null}
                                            <span className="ml-auto text-[10px] flex-shrink-0 text-text-secondary">
                                                {current ? 'current' : c.pinnedTo ? `on ${c.pinnedTo.name}` : ''}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </div>
        </div>
    );
}
