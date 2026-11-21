'use client';
import { useEffect, useState } from 'react';
import type { WorkAgreement } from '@/lib/work/agreements';
export default function WorkReferences({ companyId, agreement }: { companyId: string; agreement: WorkAgreement }) {
    const [assets, setAssets] = useState<{ id: string; name: string }[]>([]), [error, setError] = useState('');
    const ids = agreement.assetIds?.join(',') ?? '';
    useEffect(() => {
        if (!ids) return;
        const c = new AbortController();
        void fetch(`/api/os/work/resources?companyId=${companyId}&ids=${ids}`, { signal: c.signal }).then(async r => { const b = await r.json(); if (!r.ok) throw Error(b.error); return b.assets; }).then(a => { if (!c.signal.aborted) setAssets(a); }).catch(e => { if (!c.signal.aborted) setError(e.message); });
        return () => c.abort();
    }, [companyId, ids]);
    return <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm">Agreed outcome & references</summary><div className="mt-3 space-y-2 text-sm"><p>{agreement.outcome}</p><p><strong>Done means:</strong> {agreement.standard}</p>{error && <p role="alert">{error}</p>}{assets.map(a => <a key={a.id} className="block text-primary underline" target="_blank" rel="noreferrer" href={`/api/os/work/resources/file?companyId=${companyId}&id=${a.id}`}>{a.name} ↗</a>)}{agreement.sources?.map(url => <a key={url} className="block break-all text-primary underline" href={url} target="_blank" rel="noreferrer">{url}</a>)}</div></details>;
}
