'use client';
import { useState } from 'react';

type Version = { revision: number; savedAt: string; text: string };
export default function ArtifactHistory({ companyId, kind }: { companyId: string; kind: 'brand_voice' | 'marketing_plan' }) {
  const [history, setHistory] = useState<{ current: Version | null; versions: Version[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/os/artifact-history/${companyId}?kind=${kind}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load versions.');
      setHistory(body);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load versions.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <button type="button" className="ui-button" disabled={busy || !companyId} onClick={() => void load()}>{busy ? 'Loading versions…' : 'Compare with previous version'}</button>
    {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
    {history ? <>
      {history.versions.length ? <>
        <div className="grid gap-3 lg:grid-cols-2">{[{ label: 'Previous', version: history.versions[0] }, { label: 'Current saved', version: history.current }].map(({ label, version }) => <div key={label}><p className="ui-kicker">{label} · revision {version?.revision}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-border p-3 text-xs">{version?.text ?? 'No saved version'}</pre></div>)}</div>
      </> : <p className="text-xs text-text-secondary">No previous version yet. Saving or accepting an update preserves the current version for comparison.</p>}
      <button type="button" className="ui-button" onClick={() => setHistory(null)}>Close comparison</button>
    </> : null}
  </div>;
}
