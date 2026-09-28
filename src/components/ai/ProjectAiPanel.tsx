'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { PlanDraft } from '@nucleas/ai-contracts';
import { usePageActivity } from '@/hooks/usePageActivity';
import ProjectRepositoryBinding from '@/components/ai/ProjectRepositoryBinding';

type Objective = { _id: string; title: string; outcome: string; acceptanceCriteria: string[] };
type Plan = PlanDraft & { _id: string; digest: string; status: 'draft' | 'approved'; expiresAt: string; source?: string };
type Run = { _id: string; role: string; status: string; model?: string; failureCode?: string;
  inputTokens?: number; outputTokens?: number; latencyMs?: number; costMicros?: number };
type Snapshot = {
  project: { id: string; name: string }; canManage: boolean; objectives: Objective[]; plans: Plan[];
  runs: Run[]; statusMessage: string;
  capabilities: { inference: boolean; execution: boolean };
  planning: { enabled: boolean; model: string | null; reservationMicros: number | null };
};
const field = 'w-full rounded border border-border bg-background p-2 text-text-primary';
const button = 'rounded border border-border px-3 py-2 text-sm disabled:opacity-50';

export default function ProjectAiPanel({ projectId, initialObjectiveId }: { projectId: string; initialObjectiveId?: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [outcome, setOutcome] = useState('');
  const [constraints, setConstraints] = useState('');
  const [criteria, setCriteria] = useState('');
  const [objectiveId, setObjectiveId] = useState(initialObjectiveId ?? '');
  const [summary, setSummary] = useState('');
  const [tasks, setTasks] = useState([{ name: '', criteria: '' }]);
  const activeRequest = useRef<AbortController | null>(null);
  const mutationLock = useRef(false);
  const pendingCreate = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const loadedPlanRuns = useRef(new Set<string>());
  const { isActive } = usePageActivity();
  const hasPendingRun = data?.runs.some(run => ['queued', 'running', 'cancellation_requested'].includes(run.status)) ?? false;
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/ai`;
  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`${endpoint}${initialObjectiveId ? `?objectiveId=${encodeURIComponent(initialObjectiveId)}` : ''}`, { signal, cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Unable to load planning.');
    if (!signal.aborted) {
      // One explicitly selected older objective, not an accumulating history cache.
      if (body.selectedObjective && !body.objectives.some((item: Objective) => item._id === body.selectedObjective.id)) {
        body.objectives = [{ ...body.selectedObjective, _id: body.selectedObjective.id }, ...body.objectives];
      }
      loadedPlanRuns.current = new Set((body.runs as Run[]).filter(run => run.status === 'awaiting_acceptance').map(run => run._id));
      setData(body);
    }
  }, [endpoint, initialObjectiveId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load planning.');
    });
    return () => { controller.abort(); activeRequest.current?.abort(); };
  }, [load]);

  useEffect(() => {
    if (!isActive || !hasPendingRun || busy) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`${endpoint}?view=runs`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to refresh AI status. Use Refresh to retry.');
        const body: { runs: Run[] } = await response.json();
        if (controller.signal.aborted) return;
        if (body.runs.some(run => run.status === 'awaiting_acceptance' && !loadedPlanRuns.current.has(run._id))) await load(controller.signal);
        else setData(current => current && JSON.stringify(current.runs) !== JSON.stringify(body.runs) ? { ...current, runs: body.runs } : current);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to refresh AI status.');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 15000);
      }
    }
    timer = setTimeout(() => void poll(), 15000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [endpoint, load, isActive, hasPendingRun, busy]);

  async function mutate(input: { action: string; [key: string]: unknown }) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true); setError('');
    try {
      let bodyInput = input;
      if (['create_objective', 'create_draft', 'plan_with_ai'].includes(input.action)) {
        const fingerprint = JSON.stringify(input);
        if (pendingCreate.current?.fingerprint !== fingerprint) {
          pendingCreate.current = { fingerprint, requestId: crypto.randomUUID() };
        }
        bodyInput = { ...input, requestId: pendingCreate.current.requestId };
      }
      const response = await fetch(endpoint, { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyInput) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Operation failed.');
      await load(controller.signal);
      pendingCreate.current = null;
      if (input.action === 'create_objective') { setTitle(''); setOutcome(''); setConstraints(''); setCriteria(''); }
      if (input.action === 'create_draft') { setSummary(''); setTasks([{ name: '', criteria: '' }]); }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Operation failed.');
    } finally {
      mutationLock.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);

  return <main className="mx-auto max-w-5xl space-y-6 p-6 text-text-primary">
    <Link href={`/workspace?project=${encodeURIComponent(projectId)}`} className="text-sm underline">Back to workspace</Link>
    <Link href="/workspace/ai-attention" className="ml-4 text-sm underline">AI needs attention</Link>
    <Link href={`/ide?projectId=${encodeURIComponent(projectId)}`} className="ml-4 text-sm underline">IDE</Link>
    <Link href={`/workspace/projects/${encodeURIComponent(projectId)}/ai/runs`} className="ml-4 text-sm underline">AI run history</Link>
    <Link href={`/workspace/projects/${encodeURIComponent(projectId)}/ai/library`} className="ml-4 text-sm underline">All objectives and plans</Link>
    <Link href={`/workspace/projects/${encodeURIComponent(projectId)}/ai/artifacts`} className="ml-4 text-sm underline">Artifacts and reviews</Link>
    <header><h1 className="text-2xl font-semibold">{data?.project.name ?? 'Project'} · AI planning</h1>
      <p className="mt-2 text-sm text-text-secondary">{data?.statusMessage ?? 'Loading planning…'}</p>
      <p className="mt-1 text-sm text-text-secondary">Models run remotely. Status refresh pauses when this page is hidden or idle; queued work continues on the server.</p>
      <button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => {
        activeRequest.current?.abort();
        const controller = new AbortController(); activeRequest.current = controller;
        setError('');
        void load(controller.signal).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Refresh failed.'); });
      }}>Refresh</button>
    </header>
    {error && <p role="alert" className="rounded border border-border p-3">{error}</p>}
    {data && <>
      <ProjectRepositoryBinding projectId={projectId} />
      {data.canManage && <Link className="underline" href={`/workspace/ai-settings?projectId=${encodeURIComponent(projectId)}`}>AI budget settings</Link>}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Create an objective</h2>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void mutate({
          action: 'create_objective',
          objective: { title, outcome, constraints, acceptanceCriteria: lines(criteria) },
        }); }}>
          <label className="block">Title<input className={field} value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} /></label>
          <label className="block">Desired outcome<textarea className={field} value={outcome} onChange={e => setOutcome(e.target.value)} required maxLength={6000} /></label>
          <label className="block">Constraints<textarea className={field} value={constraints} onChange={e => setConstraints(e.target.value)} maxLength={6000} /></label>
          <label className="block">Acceptance criteria (one per line)<textarea className={field} value={criteria} onChange={e => setCriteria(e.target.value)} required /></label>
          <button className={button} disabled={busy}>Save objective</button>
        </form>
      </section>
      {data.objectives.length > 0 && <section className="space-y-3">
        <h2 className="text-lg font-semibold">Draft a plan</h2>
        <p className="text-sm text-text-secondary">Write a draft manually, or request remote AI planning when enabled. Neither action creates tasks until a manager approves the draft.</p>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void mutate({
          action: 'create_draft', objectiveId,
          draft: { summary, tasks: tasks.map((task, index) => ({ key: `task_${index + 1}`, name: task.name,
            acceptanceCriteria: lines(task.criteria), dependsOn: [] })) },
        }); }}>
          <label className="block">Objective<select className={field} value={objectiveId} onChange={e => setObjectiveId(e.target.value)} required>
            <option value="">Select an objective</option>{data.objectives.map(item => <option key={item._id} value={item._id}>{item.title}</option>)}
          </select></label>
          {data.capabilities.inference && <div className="space-y-2 rounded border border-border p-3">
            <p className="text-sm">Plan with {data.planning.model}. Only the selected objective, constraints, and acceptance criteria will be sent to the remote endpoint. No repository files or other project data are included.</p>
            <p className="text-sm">Budget reservation: {data.planning.reservationMicros === null ? 'Not configured' : `$${(data.planning.reservationMicros / 1000000).toFixed(4)}`}. This is a reservation, not a confirmed charge. Scheduled processing is subject to shared daily and spacing limits. Requests may wait until the next UTC day; queued requests can be cancelled.</p>
            <button type="button" className={button} disabled={busy || hasPendingRun || !objectiveId}
              onClick={() => void mutate({ action: 'plan_with_ai', objectiveId })}>Send objective · Plan with AI</button>
          </div>}
          <label className="block">Plan summary<textarea className={field} value={summary} onChange={e => setSummary(e.target.value)} required maxLength={6000} /></label>
          {tasks.map((task, index) => <fieldset key={index} className="space-y-2 border-l border-border pl-3">
            <legend>Task {index + 1}</legend>
            <label className="block">Task name<input className={field} value={task.name} required maxLength={200}
              onChange={e => setTasks(current => current.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} /></label>
            <label className="block">Acceptance criteria (one per line)<textarea className={field} value={task.criteria} required
              onChange={e => setTasks(current => current.map((item, i) => i === index ? { ...item, criteria: e.target.value } : item))} /></label>
            {tasks.length > 1 && <button type="button" className={button} disabled={busy} onClick={() => setTasks(current => current.filter((_, i) => i !== index))}>Remove task</button>}
          </fieldset>)}
          <div className="flex gap-3"><button type="button" className={button} disabled={busy || tasks.length >= 20}
            onClick={() => setTasks(current => [...current, { name: '', criteria: '' }])}>Add task</button>
            <button className={button} disabled={busy}>Save draft for review</button></div>
        </form>
      </section>}
      {data.plans.length > 0 && <section className="space-y-4"><h2 className="text-lg font-semibold">Recent plans</h2>
        <p className="text-sm text-text-secondary">Approval creates unassigned active tasks. It does not start AI execution. Existing tasks and human assignments are preserved.</p>
        {data.plans.map(plan => <article key={plan._id} className="space-y-3 rounded border border-border p-4">
          <h3 className="font-medium">{plan.summary}</h3><p className="text-sm">{plan.source === 'remote-model' ? 'AI-generated' : 'Human-authored'} · {plan.status} · Expires {new Date(plan.expiresAt).toLocaleString()}</p>
          <Link className="text-sm underline" href={`/workspace/projects/${encodeURIComponent(projectId)}/ai/library/plans/${encodeURIComponent(plan._id)}`}>Review this plan version</Link>
          <ol className="list-decimal space-y-3 pl-5">{plan.tasks.map(task => <li key={task.key}><strong>{task.name}</strong>
            {task.description && <p>{task.description}</p>}
            <ul className="list-disc pl-5">{task.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>
            {task.dependsOn.length > 0 && <p className="text-sm">Depends on: {task.dependsOn.join(', ')}</p>}
          </li>)}</ol>
          {plan.status === 'draft' && data.canManage && <button className={button} disabled={busy} onClick={() => void mutate({ action: 'approve_plan', planId: plan._id, digest: plan.digest })}>Approve this version and create {plan.tasks.length} tasks</button>}
        </article>)}
      </section>}
      {data.runs.length > 0 && <section><h2 className="text-lg font-semibold">Recent runs</h2>
        <ul className="space-y-3">{data.runs.map(run => <li key={run._id} className="border-b border-border py-3">
          <p>{run.role} · {run.status}{run.model ? ` · ${run.model}` : ''}</p>
          <Link className="text-sm underline" href={`/workspace/projects/${encodeURIComponent(projectId)}/ai/runs/${encodeURIComponent(run._id)}`}>View run details and events</Link>
          {run.failureCode && <p role="status" className="text-sm">Blocked: {run.failureCode}. Review configuration or update the objective before submitting a new request. No automatic retry.</p>}
          <p className="text-sm text-text-secondary">Input tokens: {run.inputTokens ?? 'Unknown'} · Output tokens: {run.outputTokens ?? 'Unknown'} · Provider cost: {run.costMicros === undefined ? 'Unknown / reservation retained' : `$${(run.costMicros / 1000000).toFixed(4)}`}</p>
          {data.canManage && ['queued', 'running'].includes(run.status) && <button className={button} disabled={busy} onClick={() => void mutate({ action: 'cancel_run', runId: run._id })}>Cancel planning</button>}
        </li>)}</ul>
      </section>}
    </>}
  </main>;
}
