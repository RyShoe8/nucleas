'use client';

import { useEffect, useState } from 'react';
import { CONTENT_GRADING, type ContentGrade } from '@/lib/ai/eval/contentCases';

type Model = { profileId: string; profileLabel: string; model: string; free: boolean; status: string };
type Case = { id: string; title: string; brief: string; source: string; criteria: string; flawed: string };
type Run = { id: string; model: string; need: string; status: string; score?: number; costMicros: number; costUnknown?: boolean; error?: string; results: { caseId: string; text: string }[]; grades?: ContentGrade[] };
const endpoint = '/api/os/ai-engine/content-evaluations';
const emptyGrade = (caseId: string): ContentGrade => ({ caseId, factuality: 0, coverage: 0, voice: 0, originality: 0, criticalError: false, notes: '' });

export default function ContentEvaluations({ models, onReviewed }: { models: Model[]; onReviewed?: () => void }) {
  const [data, setData] = useState<{ cases: Case[]; runs: Run[] } | null>(null);
  const [profile, setProfile] = useState('');
  const [model, setModel] = useState('');
  const [need, setNeed] = useState('write');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [grades, setGrades] = useState<Record<string, ContentGrade[]>>({});
  const [open, setOpen] = useState(false);
  const available = models.filter(m => m.status !== 'excluded');
  const profiles = [...new Map(available.map(m => [m.profileId, m.profileLabel])).entries()];
  const reload = async () => {
    try {
      const response = await fetch(endpoint);
      const body = await response.json();
      if (!response.ok) throw Error(body.error ?? 'Could not load evaluations.');
      setData(body);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load evaluations.'); }
  };
  const post = async (body: unknown) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? 'Request failed.');
      await reload();
      if ((body as { action?: string }).action === 'grade') onReviewed?.();
    } catch (e) { setError(e instanceof Error ? e.message : 'Request failed.'); }
    finally { setBusy(false); }
  };
  // No polling or model calls while the panel is closed. Running checks continue on the server.
  useEffect(() => { if (open) void reload(); }, [open]);
  return <details className="space-y-3 rounded-lg border border-border p-3" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-semibold">Content evaluations · Nucleas tasks</summary>
    <p className="text-sm text-text-secondary">Compare writing and fact review on three recorded failure patterns. The source packets are fixtures, not live business claims. Only your completed scores influence routing; no model grades itself. Scores remain current for 90 days. A critical factual error excludes that model from automatic selection for this task until a later evaluation passes; manual choices still apply.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm">Provider<select className="mt-1 w-full rounded border border-border bg-background p-2" value={profile} onChange={e => { setProfile(e.target.value); setModel(''); }}><option value="">Choose provider</option>{profiles.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
      <label className="text-sm">Model<select className="mt-1 w-full rounded border border-border bg-background p-2" value={model} onChange={e => setModel(e.target.value)}><option value="">Choose model</option>{available.filter(m => m.profileId === profile).map(m => <option key={m.model} value={m.model}>{m.model}{m.free ? ' · free' : ' · paid'}</option>)}</select></label>
      <label className="text-sm">Task<select className="mt-1 w-full rounded border border-border bg-background p-2" value={need} onChange={e => setNeed(e.target.value)}><option value="write">Write useful content</option><option value="review">Find unsupported claims</option></select></label>
    </div>
    <div className="flex flex-wrap items-center gap-3"><button type="button" className="ui-button" disabled={busy || !model || data?.runs.some(r => r.status === 'running')} onClick={() => void post({ action: 'run', profileId: profile, model, need })}>Run three cases</button><button type="button" className="ui-button" disabled={busy} onClick={() => void reload()}>Refresh results</button><span className="text-xs text-text-secondary">Paid models use the organization’s normal budget and per-work cap.</span></div>
    {error && <p role="alert" className="text-sm text-amber-400">{error}</p>}
    {data?.runs.map(run => <details key={run.id} className="border-t border-border pt-3">
      <summary className="cursor-pointer break-words text-sm">{run.model} · {run.need} · {run.status.replaceAll('_', ' ')}{run.score !== undefined ? ` · ${Math.round(run.score * 100)}%` : ''} · ${(run.costMicros / 1e6).toFixed(3)}{run.costUnknown ? ' + unpriced usage' : ''}</summary>
      {run.error && <p className="mt-2 text-amber-400">{run.error}</p>}
      <p className="my-2 text-xs text-text-secondary">0 = failed, 1 = major corrections, 2 = substantive edits, 3 = minor edits, 4 = ready. For review tasks, score coverage of errors and usefulness of feedback.</p>
      {run.results.map(result => {
        const item = data.cases.find(c => c.id === result.caseId);
        const grade = grades[run.id]?.find(g => g.caseId === result.caseId) ?? emptyGrade(result.caseId);
        const change = (patch: Partial<ContentGrade>) => setGrades(old => ({ ...old, [run.id]: data.cases.map(c => c.id === result.caseId ? { ...grade, ...patch } : old[run.id]?.find(g => g.caseId === c.id) ?? emptyGrade(c.id)) }));
        return <section key={result.caseId} className="my-4 space-y-2 border-t border-border pt-3">
          <h4 className="font-medium">{item?.title}</h4><p className="text-sm">{item?.criteria}</p>
          <details><summary className="cursor-pointer text-sm">Original evidence and task</summary><p className="mt-2 whitespace-pre-wrap text-sm">{item?.brief}{'\n\n'}{item?.source}{run.need === 'review' ? '\n\nDraft: ' + item?.flawed : ''}</p></details>
          <p className="whitespace-pre-wrap break-words text-sm">{result.text}</p>
          {run.status === 'reviewed' && run.grades?.find(g => g.caseId === result.caseId) && <p className="text-xs text-text-secondary">Human review: {CONTENT_GRADING.map(field => `${field} ${run.grades!.find(g => g.caseId === result.caseId)![field]}/4`).join(' · ')}. {run.grades.find(g => g.caseId === result.caseId)?.notes}</p>}
          {run.status === 'awaiting_review' && <><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{CONTENT_GRADING.map(field => <label className="text-xs capitalize" key={field}>{field}<select className="mt-1 w-full rounded border border-border bg-background p-2" value={grade[field]} onChange={e => change({ [field]: Number(e.target.value) })}>{[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select></label>)}</div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={grade.criticalError} onChange={e => change({ criticalError: e.target.checked })} />Critical factual error</label>
            <label className="block text-sm">Review notes<textarea className="mt-1 w-full rounded border border-border bg-background p-2" value={grade.notes} maxLength={1500} onChange={e => change({ notes: e.target.value })} /></label></>}
        </section>;
      })}
      {run.status === 'awaiting_review' && <button type="button" className="ui-button" disabled={busy || !data.cases.every(c => (grades[run.id]?.find(g => g.caseId === c.id)?.notes.trim().length ?? 0) >= 3)} onClick={() => void post({ action: 'grade', id: run.id, grades: grades[run.id] })}>Save human review for routing</button>}
    </details>)}
  </details>;
}
