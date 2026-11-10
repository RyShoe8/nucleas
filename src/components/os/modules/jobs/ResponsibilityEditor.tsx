'use client';
import { useState } from 'react';
import type { JobView } from './JobCard';

export default function ResponsibilityEditor({ job, onSaved }: { job: JobView; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(job.design?.title ?? '');
  const [instructions, setInstructions] = useState(job.design?.instructions ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!job.canManage || !job.design) return null;
  if (['social_publish', 'property_overview'].includes(job.design.skill ?? '')) return <p className="text-xs text-text-secondary">Edit sources, channels and schedule using the settings in this responsibility below.</p>;
  async function save() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/os/jobs/${job.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'edit_work', title, instructions }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not update work.');
      setOpen(false); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update work.'); }
    finally { setBusy(false); }
  }
  return <div className="my-3">
    <button className="ui-button" onClick={() => { setTitle(job.design!.title); setInstructions(job.design!.instructions); setOpen(!open); }}>Edit responsibility</button>
    {open && <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label className="block text-xs">Title<input required minLength={3} maxLength={120} value={title} onChange={e => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" /></label>
      <label className="block text-xs">Instructions<textarea required minLength={20} maxLength={6000} rows={8} value={instructions} onChange={e => setInstructions(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" /></label>
      <p className="text-xs text-text-secondary">Saving stops future scheduled runs until you approve and test the revised brief. Finish any pending run or review first. Previous results remain available.</p>
      {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
      <button className="ui-button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save for approval'}</button>
    </form>}
  </div>;
}
