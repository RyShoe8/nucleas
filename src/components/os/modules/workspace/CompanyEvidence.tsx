'use client';
import { useState } from 'react';
import type { BoardEvidence, TeamBoardView } from '@/lib/companies/teamBoard';

export default function CompanyEvidence({ companyId, board, canManage, onChange }: { companyId: string; board: TeamBoardView; canManage: boolean; onChange: (board: TeamBoardView) => void }) {
  const [editing, setEditing] = useState<BoardEvidence | null>(null);
  const [fact, setFact] = useState(''), [url, setUrl] = useState(''), [reason, setReason] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const save = async (withdraw: boolean) => {
    if (!editing) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/os/companies/${companyId}/library`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing.id, fact, url, reason, withdraw }) });
      const body = await response.json();
      if (!response.ok) throw Error(body.error ?? 'Could not update company memory.');
      onChange(body.board); setEditing(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update company memory.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-3">
    <p className="text-xs text-text-secondary">Shared observations retain their source, scope and check date. A link alone is not verification. Corrections require a fresh evidence check; previous versions remain in recent history.</p>
    {board.evidence.map((item, i) => <article key={item.id ?? i} className="space-y-2 rounded-xl border border-border p-4">
      <p>{item.fact}</p><p className="text-xs text-text-secondary">{item.status ?? 'unverified'} · source checked {item.checkedAt?.slice(0, 10) || 'not recorded'}{item.scope ? ` · ${item.scope}` : ''}</p>
      {/^https?:\/\//i.test(item.url) && <a className="break-all text-primary underline" href={item.url} target="_blank" rel="noreferrer">Source</a>}
      {item.quote && <details><summary className="cursor-pointer text-xs">Supporting passage</summary><blockquote className="mt-2 border-l-2 border-border pl-3 text-sm">{item.quote}</blockquote></details>}
      {item.correctionReason && <p className="text-xs text-text-secondary">Correction: {item.correctionReason}</p>}
      {canManage && item.id && <button type="button" className="ui-button text-xs" onClick={() => { setEditing(item); setFact(item.fact); setUrl(item.url); setReason(''); setError(''); }}>Correct or withdraw</button>}
      {editing?.id === item.id && editing && <form className="space-y-2 border-t border-border pt-3" onSubmit={e => { e.preventDefault(); void save(false); }}>
        <label className="block text-sm">Corrected claim<textarea required minLength={5} maxLength={1000} className="mt-1 w-full rounded border border-border bg-background p-2" value={fact} onChange={e => setFact(e.target.value)} /></label>
        <label className="block text-sm">Source URL<input required type="url" maxLength={2000} className="mt-1 w-full rounded border border-border bg-background p-2" value={url} onChange={e => setUrl(e.target.value)} /></label>
        <label className="block text-sm">Reason<textarea required minLength={5} maxLength={700} className="mt-1 w-full rounded border border-border bg-background p-2" value={reason} onChange={e => setReason(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2"><button className="ui-button" disabled={busy}>Save correction for verification</button><button type="button" className="ui-button" disabled={busy || reason.trim().length < 5} onClick={() => void save(true)}>Withdraw from active memory</button><button type="button" className="ui-button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button></div>
        {error && <p role="alert" className="text-sm text-amber-400">{error}</p>}
      </form>}
    </article>)}
    {!board.evidence.length && <p>No active research saved yet.</p>}
    {!!board.history?.length && <details><summary className="cursor-pointer text-sm">Recent memory history · {board.history.length}</summary>{board.history.map((item, i) => <div className="mt-2 rounded border border-border p-3 text-sm" key={item.id ?? i}><p>{item.fact}</p><p className="text-xs text-text-secondary">{item.status === 'withdrawn' ? 'Withdrawn' : 'Previous version'} · {item.at.slice(0, 10)} · {item.correctionReason || item.url}</p></div>)}</details>}
  </div>;
}
