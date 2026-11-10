'use client';
import { useCallback, useEffect, useState } from 'react';
import { TEAM, TEAM_ROLES, type TeamRole } from '@/lib/companies/teamRoles';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import BuildCard, { type BuildView } from './building/BuildCard';
import ResponsibilityEditor from './jobs/ResponsibilityEditor';
import JobCard, { scheduleLabel, jobIsBusy, type JobView } from './jobs/JobCard';
import { visibleInterval } from '@/lib/os/visibleInterval';

type Member = { role: TeamRole; name: string; remit: string; process: string; active: boolean; lessons: string };
type TeamBuild = BuildView & { teamRole?: 'design' | 'engineering' };
type TeamData = { builds: TeamBuild[]; canManage: boolean; members: Member[]; jobs: (JobView & { teamRole: TeamRole })[] };
export default function CompanyTeamPanel({ companyId, companyName }: { companyId: string; companyName: string }) {
  const wm = useWindowManager();
  const [data, setData] = useState<TeamData | null>(null);
  const [role, setRole] = useState<TeamRole>('marketing');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [remit, setRemit] = useState('');
  const [lessons, setLessons] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const [request, setRequest] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/os/companies/${companyId}/team`, { signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not load team.');
      if (!signal?.aborted) { setData(body); setError(''); }
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Could not load team.'); }
  }, [companyId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const stop = visibleInterval(() => { void load(controller.signal); }, 30_000);
    return () => { controller.abort(); stop(); };
  }, [load]);
  async function act(body: Record<string, unknown>) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/os/companies/${companyId}/team`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not save.');
      await load(); setEditing(false);
      if (body.action === 'delegate') setRequest('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  }
  const selected = data?.members.find(m => m.role === role);
  const jobs = data?.jobs.filter(j => j.teamRole === role) ?? [];
  const attention = (j: JobView) => ['needs_answers', 'proposed', 'failed'].includes(j.status) || j.runs.some(r => r.status === 'needs_review') || j.runs[0]?.status === 'failed' || Boolean(j.publishing?.ready.length);
  const builds = data?.builds?.filter(b => (b.teamRole ?? 'engineering') === role) ?? [];
  const openTool = (module: string) => wm.open(module, { payload: { companyId, companyName } });
  return <section className="space-y-4">
    <header><h3 className="text-lg font-semibold">Your company team</h3><p className="text-sm text-text-secondary">Give a member an outcome. They keep the context, own the responsibilities and learn from reviewed work.</p></header>
    {error && <p role="alert" className="text-amber-300 text-sm">{error} <button className="underline" onClick={() => void load()}>Retry</button></p>}
    {!data ? <p className="text-sm text-text-secondary">Loading team…</p> : <>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">{data.members.map(member => {
        const owned = data.jobs.filter(j => j.teamRole === member.role);
        const built = data.builds?.filter(b => (b.teamRole ?? 'engineering') === member.role) ?? [];
        const needs = owned.filter(attention).length + built.filter(b => ['proposed', 'ready', 'failed'].includes(b.status)).length;
        return <button key={member.role} onClick={() => { setRole(member.role); setEditing(false); setFilter(''); setRequest(''); }} aria-pressed={role === member.role} className={`rounded-2xl border p-3 text-left transition-colors ${role === member.role ? 'border-primary bg-primary/10' : 'border-border hover:bg-background-card'}`}>
          <span className="flex items-center justify-between gap-2"><strong className="text-sm">{member.name}</strong><span className={`h-1.5 w-1.5 rounded-full ${member.active ? 'bg-emerald-400' : 'bg-text-secondary'}`} /></span>
          <span className="block mt-1 text-[11px] text-text-secondary">{!member.active ? 'Reserved · inactive' : `${owned.filter(j => j.status === 'active' || jobIsBusy(j)).length} active · ${owned.length + built.length} responsibilities`}</span>
          {needs > 0 && <span className="block mt-1 text-xs text-amber-300">{needs} need you</span>}
          {member.role === 'operations' && <span className="block mt-1 text-[11px] text-text-secondary">Partners with every member</span>}
        </button>;
      })}</div>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{selected?.name}’s work <span className="text-text-secondary">{jobs.length + builds.length}</span></h4><input aria-label="Find assigned work" placeholder="Find assigned work…" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div>
        {[...jobs].filter(j => `${j.design?.title ?? ''} ${j.request}`.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => Number(attention(b)) - Number(attention(a))).map(job => {
          const opened = expanded[job.id] ?? (attention(job) || jobIsBusy(job));
          return <article key={job.id} className="rounded-xl border border-border overflow-hidden">
            <button className="w-full p-3 text-left hover:bg-background-card flex justify-between items-center gap-3" aria-expanded={opened} onClick={() => setExpanded(old => ({ ...old, [job.id]: !opened }))}>
              <span className="min-w-0"><strong className="block text-sm">{job.design?.title ?? job.request.slice(0, 100)}</strong><span className="block mt-1 text-xs text-text-secondary">{scheduleLabel(job.design?.schedule)} · {job.status}{job.nextRunAt ? ` · Next ${new Date(job.nextRunAt).toLocaleString()}` : ''}</span></span>
              <span className={`shrink-0 text-xs ${attention(job) ? 'text-amber-300' : 'text-primary'}`}>{attention(job) ? 'Review & manage' : 'View & edit'} {opened ? '▾' : '→'}</span>
            </button>
            {opened && <div className="border-t border-border p-3">
              {data.canManage && <label className="block text-xs">Owner <select aria-label={`Owner for ${job.design?.title ?? job.request}`} disabled={busy} value={job.teamRole} onChange={e => void act({ action: 'assign', role: e.target.value, jobId: job.id })} className="ml-2 rounded border border-border bg-background-card p-1">{TEAM_ROLES.filter(r => TEAM[r].active).map(r => <option value={r} key={r}>{TEAM[r].name}</option>)}</select></label>}
              <ResponsibilityEditor job={job} onSaved={() => void load()} />
              <JobCard job={job} onChange={() => void load()} headerShownAbove />
            </div>}
          </article>;
        })}
        {builds.filter(build => `${build.title} ${build.request}`.toLowerCase().includes(filter.toLowerCase())).map(build => <details key={build.id} className="rounded-xl border border-border p-3" open={['proposed', 'ready', 'failed'].includes(build.status)}><summary className="cursor-pointer text-sm font-medium">{build.title} · {build.status} · Review & edit plan</summary><BuildCard build={build} onChange={() => void load()} /></details>)}
        {selected?.active && !jobs.length && !builds.length && <p className="text-sm text-text-secondary">No current responsibilities assigned. Give this member an outcome below.</p>}
      </section>
      {selected && <div className="rounded-2xl border border-border p-4 space-y-4">
        <div className="flex justify-between gap-3"><div><h4 className="font-semibold">{selected.name} · {companyName}</h4><p className="text-sm text-text-secondary mt-1">{selected.remit}</p></div>{selected.active && data.canManage && <button className="ui-button h-fit" onClick={() => { setRemit(selected.remit); setLessons(selected.lessons); setEditing(!editing); }}>Guide member</button>}</div>
        {!selected.active ? <p className="text-sm text-text-secondary">Tester is intentionally blank. No assignments, model calls or scheduled work.</p> : <>
          {editing && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void act({ action: 'profile', role, remit, lessons }); }}>
            <label className="block text-xs">Responsibility and success criteria<textarea required minLength={10} maxLength={2000} value={remit} onChange={e => setRemit(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" rows={3} /></label>
            <label className="block text-xs">Lessons and preferences for future work<textarea maxLength={4000} value={lessons} onChange={e => setLessons(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" rows={4} placeholder="What should this member repeat or change? Save only guidance you have reviewed." /></label>
            <button disabled={busy} className="ui-button-primary">{busy ? 'Saving…' : 'Save guidance'}</button>
          </form>}
          <details className="text-sm"><summary className="cursor-pointer text-text-secondary">Thinking process & memory</summary><div className="mt-3 space-y-2">
            <p>{selected.process}</p>
            <ol className="list-decimal ml-5 space-y-1 text-text-secondary"><li>Resolve company strategy, source evidence, approved Voice and previous work.</li><li>Plan through the shared model engine; brief specialized Rogly workers for bounded tasks.</li><li>Verify evidence and outputs. Escalate unresolved reasoning within the existing cost policy.</li><li>Review results, apply your feedback and carry useful lessons into future responsibilities.</li></ol>
            <p className="text-xs text-text-secondary">Operations guidance accompanies every research and publishing responsibility. Model selection still follows AI Engine settings and each responsibility’s cost level. No new model bindings or extra standing model calls.</p>
            <p className="whitespace-pre-wrap">{selected.lessons || 'No manager-written lessons yet. Human review notes and the company’s approved Voice examples provide additional feedback.'}</p>
            <p className="text-xs text-text-secondary">Access stays scoped to this company’s authorized connections. Tools and publishing permissions are unchanged. This is contextual learning, not model training.</p>
          </div></details>
          {role === 'operations' && <div className="rounded-xl bg-background-card p-3 text-sm space-y-1"><strong>Workflow observations</strong>
            <p>{data.jobs.filter(j => j.runs[0]?.status === 'failed').length} responsibilities have a failed latest run.</p>
            <p>{data.jobs.filter(j => j.monthlyBudgetMicros > 0 && j.spentThisMonthMicros >= j.monthlyBudgetMicros).length} have reached their monthly budget.</p>
            <p className="text-text-secondary">Review failure causes before another retry; reuse verified research and correct the brief. Budget changes remain your decision.</p>
          </div>}
          <div className="flex gap-2 flex-wrap">
            {role === 'marketing' && <><button className="ui-button" onClick={() => openTool('marketing')}>Strategy & campaigns</button><button className="ui-button" onClick={() => openTool('content')}>Content</button></>}
            {['engineering', 'design'].includes(role) && <button className="ui-button" onClick={() => openTool('building')}>Open Building</button>}
            {role === 'support' && <button className="ui-button" onClick={() => openTool('mail')}>Communications</button>}
            {role === 'creative' && <button className="ui-button" onClick={() => openTool('content')}>Content & assets</button>}
          </div>
          {data.canManage && <form className="space-y-2" onSubmit={e => { e.preventDefault(); void act({ action: 'delegate', role, request }); }}><label className="text-sm font-medium block">Give {selected.name} a responsibility<textarea required minLength={10} maxLength={6000} value={request} onChange={e => setRequest(e.target.value)} rows={3} placeholder="Describe the outcome, constraints and how often it should happen…" className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-sm" /></label><button disabled={busy} className="ui-button-primary">{busy ? 'Working…' : 'Prepare a plan'}</button><span className="ml-2 text-xs text-text-secondary">Uses AI Engine routing. You review the plan before execution.</span></form>}
        </>}
      </div>}

    </>}
  </section>;
}
