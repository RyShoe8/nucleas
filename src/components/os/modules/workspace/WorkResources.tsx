'use client';
import { useEffect, useRef, useState } from 'react';
type Resource = { id: string; name: string; type: string };
export default function WorkResources({ companyId, ids, onChange, onBusy }: { companyId: string; ids: string[]; onChange: (ids: string[]) => void; onBusy: (busy: boolean) => void }) {
    const [assets, setAssets] = useState<Resource[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const selected = ids.join(',');
    useEffect(() => {
        if (!companyId) return;
        const c = new AbortController();
        const read = async (query = '') => { const r = await fetch(`/api/os/work/resources?companyId=${companyId}${query}`, { signal: c.signal }); const b = await r.json(); if (!r.ok) throw Error(b.error); return b.assets as Resource[]; };
        void Promise.all([read(), selected ? read('&ids=' + selected) : Promise.resolve([])]).then(([all, chosen]) => { if (!c.signal.aborted) { setAssets([...new Map([...all, ...chosen].map(a => [a.id, a])).values()]); setError(''); } }).catch(e => { if (!c.signal.aborted) setError(e.message); });
        return () => c.abort();
    }, [companyId, selected]);
    const upload = async (file?: File) => {
        if (!file) return;
        if (file.size > 3_000_000) { setError('Use a file under 3 MB.'); return; }
        setBusy(true); onBusy(true); setError('');
        try {
            const form = new FormData(); form.set('file', file); form.set('name', file.name); form.set('type', 'file'); form.set('linkedClientId', companyId); form.set('tags', 'work-attachment');
            const r = await fetch('/api/assets/upload', { method: 'POST', body: form }); const b = await r.json();
            if (!r.ok) throw Error(b.error ?? 'Upload failed.');
            setAssets(a => [...a, { id: b._id, name: b.name, type: b.type }]); onChange([...ids, b._id]);
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); onBusy(false); }
    };
    return <fieldset className="space-y-2 rounded-xl border border-border p-3"><legend className="text-sm">Reference files</legend>
        <p className="text-xs text-text-secondary">Saved in the company Library and retained with this work. Up to six files; PNG, JPEG, WebP, GIF, PDF or text, 3 MB each.</p>
        <input ref={input} type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="flex flex-wrap gap-2"><button type="button" className="ui-button" disabled={!companyId || busy || ids.length >= 6} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Upload reference'}</button>
        <select aria-label="Attach a saved company file" className="ui-control min-w-0 flex-1" value="" disabled={!companyId || busy || ids.length >= 6} onChange={e => onChange([...ids, e.target.value])}><option value="">Choose a saved file…</option>{assets.filter(a => !ids.includes(a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        {ids.map(id => <div key={id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{assets.find(a => a.id === id)?.name ?? 'Attached file'}</span><button type="button" disabled={busy} className="ui-button" onClick={() => onChange(ids.filter(i => i !== id))}>Remove</button></div>)}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </fieldset>;
}
