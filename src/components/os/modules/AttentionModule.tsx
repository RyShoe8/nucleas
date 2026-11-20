'use client';
import { useCallback, useEffect, useState } from 'react';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { DIGEST_LABELS, DIGEST_MINUTES, type AttentionItem, type DigestMinutes } from '@/lib/attention/types';
import { visibleInterval } from '@/lib/os/visibleInterval';
export default function AttentionModule() {
  const wm = useWindowManager();
  const [items, setItems] = useState<AttentionItem[]>([]), [interval, setInterval] = useState<DigestMinutes>(0), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const load = useCallback(async (signal: AbortSignal) => {
    try { const response = await fetch('/api/os/attention', { signal }); if (!response.ok) throw Error('Could not load your review requests.'); const data = await response.json(); if (!signal.aborted) { setItems(data.items); setInterval(data.intervalMinutes); setError(''); } } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Could not load notifications.'); }
  }, []);
  useEffect(() => { const c = new AbortController(); void load(c.signal); const stop = visibleInterval(() => { void load(c.signal); }, 60_000); return () => { stop(); c.abort(); }; }, [load]);
  return <div className="h-full overflow-y-auto p-5 space-y-4"><h2 className="text-xl font-semibold">Needs you</h2>
    <label className="block text-sm">Email summary<select aria-label="Email summary frequency" disabled={saving} value={interval} className="ui-control ml-3" onChange={async e => { const minutes = Number(e.target.value) as DigestMinutes; setSaving(true); try { const r = await fetch('/api/os/attention', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intervalMinutes: minutes }) }); if (!r.ok) throw Error('Could not save email settings.'); setInterval(minutes); setError(''); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } }}>{DIGEST_MINUTES.map(m => <option key={m} value={m}>{DIGEST_LABELS[m]}</option>)}</select></label>
    <p className="text-xs text-text-secondary">A complete summary of items still waiting for you, with direct links. Empty summaries are never sent. Deliveries run within five minutes of your chosen interval.</p>
    {error && <p role="alert" className="text-amber-300">{error}</p>}
    {!items.length && !error ? <p className="text-sm text-text-secondary">Nothing needs you right now.</p> : <ul className="space-y-2">{items.map(item => <li key={item.id}><button className="w-full rounded-xl border border-border p-3 text-left hover:bg-primary/10" onClick={() => wm.open(item.moduleId, { payload: item.payload })}><small className="text-primary">{item.companyName} · {item.employeeName}</small><strong className="block text-sm">{item.title}</strong><span className="block text-xs text-text-secondary mt-1">{item.detail} ↗</span></button></li>)}</ul>}
  </div>;
}
