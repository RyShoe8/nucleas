'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TEAM, TEAM_ROLES, type TeamRole } from '@/lib/companies/teamRoles';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { isQuestion } from '@/lib/ai/orchestrator/responseRouting';
import TeamAnswer, { askTeam, type TeamQuestion } from './TeamAnswer';
import { visibleInterval } from '@/lib/os/visibleInterval';
import BuildCard, { type BuildView } from './building/BuildCard';
import ResponsibilityEditor from './jobs/ResponsibilityEditor';
import JobCard, { scheduleLabel, type JobView } from './jobs/JobCard';
import { STEPS, buildStage, jobStage, type Stage, type StageGroup } from './teamStages';

type Member = { role: TeamRole; name: string; remit: string; process: string; active: boolean; lessons: string; playbook?: { craft: string[]; bar: string[]; avoids: string[]; sources: string } };
type TeamJob = JobView & { teamRole: TeamRole };
type TeamBuild = BuildView & { teamRole?: 'design' | 'engineering' };
type Board = { plan: { point: string; member: TeamRole; about?: string; at: string }[]; evidence: { fact: string; url: string; member: TeamRole; at: string }[] };
type TeamData = { board?: Board; builds: TeamBuild[]; canManage: boolean; members: Member[]; jobs: TeamJob[] };
const shortDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'source'; } };

/** What the team has worked out together so far: the plan it is building and the sourced facts it relies on. */
function SharedBoard({ board }: { board?: Board }) {
  if (!board || (!board.plan.length && !board.evidence.length)) return null;
  return <details className="rounded-2xl border border-border p-4">
    <summary className="cursor-pointer text-sm font-semibold">Working plan and shared evidence <span className="font-normal text-text-secondary">{board.plan.length} plan point{board.plan.length === 1 ? '' : 's'} · {board.evidence.length} sourced fact{board.evidence.length === 1 ? '' : 's'}</span></summary>
    <p className="mt-2 text-xs text-text-secondary">Built by the team as it works and given to every member with the company context. It never overrides your approved marketing plan or a brief.</p>
    {board.plan.length > 0 && <><h5 className="mt-3 text-[11px] uppercase tracking-wider text-text-secondary">Working plan, newest first</h5>
      <ul className="mt-1 space-y-1.5 text-sm">{board.plan.map((item, index) => <li key={index}><span className="text-text-secondary">{TEAM[item.member]?.name ?? item.member} · {shortDay(item.at)} · </span>{item.point}</li>)}</ul></>}
    {board.evidence.length > 0 && <><h5 className="mt-3 text-[11px] uppercase tracking-wider text-text-secondary">Shared evidence, newest first</h5>
      <ul className="mt-1 space-y-1.5 text-sm">{board.evidence.map((item, index) => <li key={index}>{item.fact} <a href={item.url} target="_blank" rel="noreferrer" className="text-xs underline text-text-secondary">{host(item.url)}</a><span className="text-xs text-text-secondary"> · found for {TEAM[item.member]?.name ?? item.member}, {shortDay(item.at)}</span></li>)}</ul></>}
  </details>;
}
type Advice = NonNullable<JobView['teamAdvice']>;
type Row = { id: string; title: string; role: TeamRole; stage: Stage; line: string; advice: Advice; job?: TeamJob; build?: TeamBuild };

type LogEntry = NonNullable<JobView['teamLog']>[number];

/** The team's exchange on one piece of work, as it happens: who asked whom, what an intern read, the facts used, the answer. */
function LiveExchange({ log, live }: { log: LogEntry[]; live: boolean }) {
  if (!log.length) return live ? <p className="text-sm text-text-secondary">Starting…</p> : null;
  const name = (role?: TeamRole) => (role ? TEAM[role]?.name ?? role : '');
  return <div className="rounded-lg border border-border p-3">
    <h5 className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-secondary">{live && <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" aria-hidden />}{live ? 'Happening now' : 'How the team got here'}</h5>
    <ol className="mt-2 space-y-2.5 text-sm" aria-live={live ? 'polite' : undefined}>{log.map((entry, index) => <li key={index} className="flex gap-3">
      <time className="w-14 shrink-0 pt-0.5 text-[11px] tabular-nums text-text-secondary" dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>
      <div className="min-w-0 flex-1">
        {(entry.kind === 'ask' || entry.kind === 'answer') && <p className="text-xs font-medium">{name(entry.from)}{entry.to ? <span className="text-text-secondary"> → {name(entry.to)}</span> : null}</p>}
        <p className={`whitespace-pre-wrap break-words ${entry.kind === 'ask' || entry.kind === 'answer' ? '' : 'text-text-secondary'}`}>{entry.text}</p>
        {entry.facts?.length ? <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">{entry.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul> : null}
        {entry.sources?.length ? <p className="mt-1 text-xs text-text-secondary">Pages read: {entry.sources.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="mr-2 underline">{host(url)}</a>)}</p> : null}
      </div>
    </li>)}</ol>
  </div>;
}

/** Who the owner asked before starting, what each said, and what their intern read on the web. */
function Consulted({ owner, advice }: { owner: TeamRole; advice: Advice }) {
  if (!advice.length) return null;
  return <details className="rounded-lg border border-border p-3 text-sm">
    <summary className="cursor-pointer">{TEAM[owner].name} asked {advice.map(item => TEAM[item.member].name).join(' and ')} before starting</summary>
    <div className="mt-3 space-y-4">{advice.map(item => <div key={item.member}>
      <p className="font-medium">{TEAM[item.member].name} <span className="font-normal text-text-secondary">· asked: {item.question}</span></p>
      <p className="mt-1 whitespace-pre-wrap break-words text-text-secondary">{item.advice}</p>
      {item.sources?.length ? <p className="mt-1 text-xs text-text-secondary">Their intern read {item.sources.length} page{item.sources.length === 1 ? '' : 's'}: {item.sources.slice(0, 6).map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="underline mr-2">{(() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return `source ${index + 1}`; } })()}</a>)}</p> : <p className="mt-1 text-xs text-text-secondary">Their intern found nothing usable on the web.</p>}
    </div>)}</div>
  </details>;
}

const GROUPS: { id: StageGroup; title: string; hint: string }[] = [
  { id: 'you', title: 'Needs you', hint: 'Nothing moves on these until you act.' },
  { id: 'moving', title: 'In progress', hint: 'Your team is working. No action needed.' },
  { id: 'live', title: 'Running', hint: 'Approved and running on its schedule.' },
  { id: 'rest', title: 'Paused and finished', hint: '' },
];
const TOOLS: Partial<Record<TeamRole, [string, string][]>> = {
  marketing: [['marketing', 'Strategy & campaigns'], ['content', 'Content']],
  engineering: [['building', 'Building']],
  design: [['building', 'Building']],
  support: [['mail', 'Communications']],
  creative: [['content', 'Content & assets']],
};

function Steps({ stage }: { stage: Stage }) {
  return <ol className="flex items-center gap-1" aria-label={`Step ${stage.step + 1} of ${STEPS.length}: ${STEPS[stage.step]}`}>
    {STEPS.map((label, index) => <li key={label} className="flex items-center gap-1">
      <span className={`h-1.5 w-6 rounded-full ${index < stage.step ? 'bg-emerald-400/70' : index === stage.step ? (stage.group === 'you' ? 'bg-amber-300' : stage.group === 'moving' ? 'bg-sky-400 animate-pulse' : 'bg-emerald-400') : 'bg-border'}`} />
      {index === stage.step ? <span className="text-[10px] uppercase tracking-wider text-text-secondary">{label}</span> : null}
    </li>)}
  </ol>;
}

export default function CompanyTeamPanel({ companyId, companyName, focusJobId }: { companyId: string; companyName: string; focusJobId?: string }) {
  const wm = useWindowManager();
  const [data, setData] = useState<TeamData | null>(null);
  const [role, setRole] = useState<TeamRole | 'all'>('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [guiding, setGuiding] = useState(false);
  const [remit, setRemit] = useState('');
  const [lessons, setLessons] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(focusJobId ? { [focusJobId]: true } : {});
  const [filter, setFilter] = useState('');
  const [request, setRequest] = useState('');
  const [assignee, setAssignee] = useState<TeamRole | 'auto'>('auto');
  const [questions, setQuestions] = useState<TeamQuestion[]>([]);

  // While the team is working on something, refresh every few seconds so the exchange reads live.
  const working = Boolean(data?.jobs.some(job => jobStage(job).group === 'moving') || data?.builds.some(build => buildStage(build.status).group === 'moving'));
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
    const stop = visibleInterval(() => { void load(controller.signal); }, working ? 4_000 : 30_000);
    return () => { controller.abort(); stop(); };
  }, [load, working]);
  useEffect(() => {
    if (focusJobId && data) document.getElementById(`work-${focusJobId}`)?.scrollIntoView({ block: 'center' });
    // Only on first load of a focused item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusJobId, Boolean(data)]);

  async function act(body: Record<string, unknown>): Promise<{ role?: TeamRole; job?: { id: string }; build?: { id: string } } | null> {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/os/companies/${companyId}/team`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not save.');
      await load();
      return result;
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); return null; }
    finally { setBusy(false); }
  }
  async function handOff() {
    // A question gets an answer with the reasoning behind it. Only work to be done becomes a responsibility to approve.
    if (isQuestion(request)) {
      const id = `q-${Date.now()}`;
      const question = request.trim();
      const asked = assignee === 'auto' ? question : `${question}\n\n(Bring in ${TEAM[assignee].name} in particular.)`;
      const patch = (change: (item: TeamQuestion) => TeamQuestion) => setQuestions(list => list.map(item => item.id === id ? change(item) : item));
      setQuestions(list => [{ id, question, status: 'working', startedAt: Date.now(), progress: [] }, ...list]);
      setRequest(''); setNotice(''); setError('');
      void askTeam(companyId, asked, line => patch(item => ({ ...item, progress: [...item.progress, line].slice(-14) })))
        .then(({ reply, error: failure }) => patch(item => reply?.text && reply.role !== 'status'
          ? { ...item, status: 'done', text: reply.text, stages: reply.stages, evidence: reply.evidence, contextSources: reply.contextSources, costMicros: reply.costMicros }
          : { ...item, status: 'failed', error: failure ?? reply?.text ?? 'The team could not answer. Ask again.' }))
        .catch(() => patch(item => ({ ...item, status: 'failed', error: 'The question did not reach the team. Ask again.' })));
      return;
    }
    const result = await act({ action: 'delegate', request, ...(assignee === 'auto' ? {} : { role: assignee }) });
    if (!result) return;
    const owner = TEAM[result.role ?? (assignee === 'auto' ? 'marketing' : assignee)].name;
    setRequest(''); setRole('all');
    const id = result.job?.id ?? result.build?.id;
    if (id) setExpanded(old => ({ ...old, [id]: true }));
    setNotice(`${owner} has it. Watch the work below as it happens; nothing runs until you approve the plan.`);
  }

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const fromJobs = data.jobs.map((job): Row => ({
      id: job.id, job, advice: job.teamAdvice ?? [], role: job.teamRole, stage: jobStage(job), title: job.design?.title ?? job.request.slice(0, 100),
      line: [job.design ? scheduleLabel(job.design.schedule) : null, job.nextRunAt && ['ready', 'active'].includes(job.status) ? `next ${new Date(job.nextRunAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : null].filter(Boolean).join(' · '),
    }));
    const fromBuilds = data.builds.map((build): Row => ({ id: build.id, build, advice: build.teamAdvice ?? [], role: build.teamRole ?? 'engineering', stage: buildStage(build.status), title: build.title, line: 'Code change' }));
    return [...fromJobs, ...fromBuilds];
  }, [data]);
  const visible = rows.filter(r => (role === 'all' || r.role === role) && `${r.title} ${r.job?.request ?? r.build?.request ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  const selected = role === 'all' ? undefined : data?.members.find(m => m.role === role);
  const openTool = (module: string) => wm.open(module, { payload: { companyId, companyName } });

  return <section className="space-y-5">
    {error && <p role="alert" className="text-amber-300 text-sm">{error} <button className="underline" onClick={() => void load()}>Retry</button></p>}
    {!data ? <p className="text-sm text-text-secondary">Loading team…</p> : <>
      {<form className="rounded-2xl border border-primary/40 bg-primary/5 p-4 space-y-3" onSubmit={e => { e.preventDefault(); if (!data.canManage && !isQuestion(request)) { setError('Only a manager can hand work to the team. You can ask the team a question.'); return; } void handOff(); }}>
        <label className="block"><span className="text-base font-semibold">Ask {companyName}&rsquo;s team, or give them work</span>
          <textarea id="team-request" required minLength={10} maxLength={6000} value={request} onChange={e => setRequest(e.target.value)} rows={3} placeholder="Describe work to be done, or ask a question. Work: every weekday, find three new sites worth a guest post and draft the pitch. Question: what is the one thing we should do to get more subscribers?" className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-sm" /></label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-text-secondary">Who takes it <select aria-label="Who takes it" value={assignee} onChange={e => setAssignee(e.target.value as TeamRole | 'auto')} className="ml-1 rounded-lg border border-border bg-background-card p-2 text-sm text-text-primary"><option value="auto">Nucleas picks the right member</option>{TEAM_ROLES.filter(r => TEAM[r].active).map(r => <option key={r} value={r}>{TEAM[r].name}</option>)}</select></label>
          <button disabled={busy} className="ui-button-primary ml-auto">{busy ? 'Handing off…' : isQuestion(request) ? 'Ask the team' : 'Hand off'}</button>
        </div>
        <p className="text-xs text-text-secondary">{STEPS.join(' → ')}. The member asks teammates where their field matters, each with an intern searching the web, then writes a plan. You approve it, it does one test run for you to check, then it runs on its own. Nothing is posted or changed before your approval.</p>
        {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
      </form>}

      {questions.map(item => <TeamAnswer key={item.id} item={item} companyName={companyName} canManage={data.canManage}
        onHandOff={task => { setRequest(task); document.getElementById('team-request')?.focus(); }}
        onFollowUp={() => document.getElementById('team-request')?.focus()}
        onDismiss={() => setQuestions(list => list.filter(other => other.id !== item.id))} />)}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Team members">
        {(['all', ...data.members.map(m => m.role)] as const).map(key => {
          const member = key === 'all' ? null : data.members.find(m => m.role === key)!;
          const owned = key === 'all' ? rows : rows.filter(r => r.role === key);
          const needs = owned.filter(r => r.stage.group === 'you').length;
          return <button key={key} type="button" disabled={member ? !member.active : false} aria-pressed={role === key} onClick={() => { setRole(key); setGuiding(false); }} className={`rounded-full border px-3 py-1.5 text-sm disabled:opacity-40 ${role === key ? 'border-primary bg-primary/15 text-primary' : 'border-border hover:bg-background-card'}`}>
            {member ? member.name : 'Everyone'} <span className="text-xs text-text-secondary">{member && !member.active ? 'reserved' : owned.length}</span>
            {needs > 0 && <span className="ml-1.5 rounded-full bg-amber-300/20 px-1.5 text-xs text-amber-300">{needs}</span>}
          </button>;
        })}
        <input aria-label="Find work" placeholder="Find work…" value={filter} onChange={e => setFilter(e.target.value)} className="ml-auto w-40 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
      </div>

      {selected && <div className="rounded-2xl border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h4 className="font-semibold">{selected.name}</h4><p className="text-sm text-text-secondary mt-1">{selected.remit}</p></div>
          <div className="flex flex-wrap gap-2">
            {(TOOLS[selected.role] ?? []).map(([module, label]) => <button key={label} type="button" className="ui-button" onClick={() => openTool(module)}>{label}</button>)}
            {data.canManage && <button type="button" className="ui-button" aria-expanded={guiding} onClick={() => { setRemit(selected.remit); setLessons(selected.lessons); setGuiding(!guiding); }}>{guiding ? 'Close guidance' : 'Guide'}</button>}
          </div>
        </div>
        {role === 'operations' && <p className="text-sm text-text-secondary">{data.jobs.filter(j => j.runs[0]?.status === 'failed').length} responsibilities have a failed latest run. Operations advises every member; budget changes stay your decision.</p>}
        {selected.playbook && selected.playbook.craft.length > 0 && <details className="text-sm">
          <summary className="cursor-pointer text-text-secondary">How {selected.name} works and what counts as done</summary>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <div><h5 className="text-[11px] uppercase tracking-wider text-text-secondary">Method</h5><ul className="mt-1 list-disc space-y-1 pl-5">{selected.playbook.craft.map(line => <li key={line}>{line}</li>)}</ul></div>
            <div><h5 className="text-[11px] uppercase tracking-wider text-text-secondary">Not finished until</h5><ul className="mt-1 list-disc space-y-1 pl-5">{selected.playbook.bar.map(line => <li key={line}>{line}</li>)}</ul>
              <h5 className="mt-3 text-[11px] uppercase tracking-wider text-text-secondary">Avoids</h5><p className="mt-1">{selected.playbook.avoids.join(' · ')}</p>
              <h5 className="mt-3 text-[11px] uppercase tracking-wider text-text-secondary">Where their interns look first</h5><p className="mt-1">{selected.playbook.sources}</p></div>
          </div>
          <p className="mt-2 text-xs text-text-secondary">Your guidance below is added on top of this for {companyName}.</p>
        </details>}
        {guiding && <form className="space-y-3 border-t border-border pt-3" onSubmit={e => { e.preventDefault(); void act({ action: 'profile', role, remit, lessons }).then(ok => { if (ok) { setGuiding(false); setNotice(''); } }); }}>
          <label className="block text-xs">What {selected.name} is responsible for, and what good looks like<textarea required minLength={10} maxLength={2000} value={remit} onChange={e => setRemit(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" rows={3} /></label>
          <label className="block text-xs">Lessons and preferences to carry into future work<textarea maxLength={4000} value={lessons} onChange={e => setLessons(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" rows={4} placeholder="What should this member repeat or change?" /></label>
          <p className="text-xs text-text-secondary">How {selected.name} works: {selected.process} Your review notes on results are remembered too. Guidance never changes permissions, budgets or which tools a member can use.</p>
          <button disabled={busy} className="ui-button-primary">{busy ? 'Saving…' : 'Save guidance'}</button>
        </form>}
      </div>}

      <SharedBoard board={data.board} />

      {GROUPS.map(group => {
        const list = visible.filter(r => r.stage.group === group.id);
        if (!list.length) return group.id === 'you' ? <p key={group.id} className="rounded-xl border border-border p-3 text-sm text-text-secondary">Nothing needs you right now.</p> : null;
        const body = <ul className="space-y-2">{list.map(row => {
          const opened = expanded[row.id] ?? false;
          return <li key={row.id} id={`work-${row.id}`} className={`rounded-xl border overflow-hidden ${row.stage.group === 'you' ? 'border-amber-300/40' : 'border-border'}`}>
            <button type="button" className="w-full p-3 text-left hover:bg-background-card flex flex-wrap items-center gap-x-4 gap-y-2" aria-expanded={opened} onClick={() => setExpanded(old => ({ ...old, [row.id]: !opened }))}>
              <span className="min-w-0 flex-1 basis-60">
                <strong className="block text-sm truncate">{row.title}</strong>
                <span className="block mt-0.5 text-xs text-text-secondary">{[TEAM[row.role].name, row.stage.label, row.line, row.advice.length ? `asked ${row.advice.map(item => TEAM[item.member].name).join(', ')}` : null].filter(Boolean).join(' · ')}</span>
              </span>
              <Steps stage={row.stage} />
              <span className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${row.stage.action ? 'bg-amber-300 text-black' : 'border border-border text-text-secondary'}`}>{row.stage.action ?? (opened ? 'Close' : 'Open')}</span>
            </button>
            {opened && <div className="border-t border-border p-3 space-y-3">
              {row.job?.teamLog?.length || row.stage.group === 'moving' ? <LiveExchange log={row.job?.teamLog ?? []} live={row.stage.group === 'moving'} /> : <Consulted owner={row.role} advice={row.advice} />}
              {row.job && <>
                {data.canManage && <label className="block text-xs">Owner <select aria-label={`Owner for ${row.title}`} disabled={busy} value={row.role} onChange={e => void act({ action: 'assign', role: e.target.value, jobId: row.id })} className="ml-2 rounded border border-border bg-background-card p-1">{TEAM_ROLES.filter(r => TEAM[r].active).map(r => <option value={r} key={r}>{TEAM[r].name}</option>)}</select></label>}
                <ResponsibilityEditor job={row.job} onSaved={() => void load()} />
                <JobCard job={row.job} onChange={() => void load()} headerShownAbove />
              </>}
              {row.build && <BuildCard build={row.build} onChange={() => void load()} />}
            </div>}
          </li>;
        })}</ul>;
        return group.id === 'rest'
          ? <details key={group.id}><summary className="cursor-pointer text-sm font-semibold">{group.title} <span className="font-normal text-text-secondary">{list.length}</span></summary><div className="mt-2">{body}</div></details>
          : <section key={group.id} className="space-y-2"><h4 className="text-sm font-semibold">{group.title} <span className="font-normal text-text-secondary">{list.length}{group.hint ? ` · ${group.hint}` : ''}</span></h4>{body}</section>;
      })}
      {!rows.length && <p className="text-sm text-text-secondary">No work yet. {data.canManage ? 'Describe an outcome above and your team takes it from there.' : 'A manager hands work to the team.'}</p>}
      {rows.length > 0 && !visible.length && <p className="text-sm text-text-secondary">Nothing matches. {selected ? `${selected.name} has no work${filter ? ' matching that search' : ''}.` : ''}</p>}
    </>}
  </section>;
}
