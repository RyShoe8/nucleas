'use client';
import { useEffect, useState } from 'react';
export default function RecentCaptures() {
    const [items, setItems] = useState<{ id: string; name: string; url: string; createdAt: string; kind: string }[] | null>(null), [error, setError] = useState('');
    useEffect(() => { const c = new AbortController(); void fetch('/api/os/captures', { signal: c.signal }).then(async r => { if (!r.ok) throw Error('Could not load saved captures.'); return r.json(); }).then(data => { if (!c.signal.aborted) setItems(data.captures); }).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort(); }, []);
    return <div className="space-y-3"><h3 className="font-medium">Your recent captures</h3><p className="text-xs text-text-secondary">Media you saved to Nucleas. Downloads stored only on your computer are not listed.</p>{error ? <p role="alert">{error}</p> : !items ? <p>Loading…</p> : !items.length ? <p>No saved captures yet.</p> : items.map(i => <a className="block rounded-lg border border-border p-3 hover:border-primary" key={i.id} href={i.url} target="_blank" rel="noreferrer"><strong className="text-sm">{i.name} ↗</strong><small className="block text-text-secondary">{i.kind} · {new Date(i.createdAt).toLocaleString()}</small></a>)}</div>;
}
