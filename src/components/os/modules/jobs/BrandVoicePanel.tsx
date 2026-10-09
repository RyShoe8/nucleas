'use client';

import { useEffect, useState } from 'react';
import type { JobView } from './JobCard';

type Voice = { persona: string; examples: string; status: 'draft' | 'approved'; revision: number; sources: string[] };
const EMPTY: Voice = { persona: '', examples: '', status: 'draft', revision: 0, sources: [] };

export default function BrandVoicePanel({ companyId, onCreated }: { companyId: string; onCreated: (job: JobView) => void }) {
  const [voice, setVoice] = useState<Voice>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    fetch(`/api/os/brand-voices/${companyId}`, { cache: 'no-store' }).then(async (res) => {
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load Voice.');
      if (!cancelled) { setVoice(body.voice ?? EMPTY); setLoading(false); setError(''); }
    }).catch((e: Error) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [companyId, reload]);

  async function save(status: Voice['status'], generate = false) {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await fetch(`/api/os/brand-voices/${companyId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persona: voice.persona, examples: voice.examples, revision: voice.revision, status }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not save Voice.');
      setVoice(body.voice);
      if (generate) {
        const created = await fetch('/api/os/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId, template: 'brand_voice', config: {} }) });
        const result = await created.json();
        if (!created.ok || !result.job) throw new Error(result.error || 'Could not create Voice job.');
        onCreated(result.job);
        window.dispatchEvent(new Event('nucleas:jobs-changed'));
      } else setMessage(status === 'approved' ? 'Voice approved. Content and social drafting jobs will use it.' : 'Draft saved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Voice request failed.'); }
    finally { setBusy(false); }
  }

  if (!companyId) return <p className="text-sm text-text-secondary">Choose a company to build its Voice.</p>;
  if (loading) return <p className="text-sm text-text-secondary">Loading Voice…</p>;
  return <div className="space-y-3">
    <p className="text-xs text-text-secondary">Build a persona from the Company Overview, website, and writing samples. Accept the generated job result, then edit and approve the persona here for content and social drafts.</p>
    <label className="block space-y-1"><span className="ui-kicker">Brand writing samples</span><textarea aria-label="Brand writing samples" value={voice.examples} maxLength={16000} onChange={(e) => setVoice({ ...voice, examples: e.target.value })} placeholder="Paste your own articles or posts, including source URLs. Third-party emails are content sources, not your brand voice." className="ui-control w-full h-32 resize-y" /></label>
    <label className="block space-y-1"><span className="ui-kicker">Persona · {voice.status} · revision {voice.revision}</span><textarea aria-label="Brand persona" value={voice.persona} maxLength={20000} onChange={(e) => setVoice({ ...voice, persona: e.target.value, status: 'draft' })} placeholder="Generate a persona or write your brand’s voice guidelines here." className="ui-control w-full h-64 resize-y" /></label>
    {voice.sources.length ? <p className="text-xs text-text-secondary whitespace-pre-wrap">Sources: {voice.sources.join('\n')}</p> : null}
    {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
    {message ? <p role="status" className="text-xs text-emerald-400">{message}</p> : null}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} className="ui-button-primary" onClick={() => void save(voice.status, true)}>{busy ? 'Saving…' : 'Generate Voice'}</button>
      <button type="button" disabled={busy} className="ui-button" onClick={() => void save('draft')}>Save draft</button>
      <button type="button" disabled={busy || voice.persona.trim().length < 40} className="ui-button" onClick={() => void save('approved')}>Approve Voice</button>
      <button type="button" disabled={busy} className="ui-button" onClick={() => { setLoading(true); setReload((n) => n + 1); }}>Reload saved Voice</button>
    </div>
  </div>;
}
