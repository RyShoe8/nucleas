'use client';
import { useEffect, useState } from 'react';
import type { ModuleRenderContext } from '@/lib/os/types';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { visibleInterval } from '@/lib/os/visibleInterval';
import { TEAM, TEAM_ROLES, teamRoleFor, type TeamRole } from '@/lib/companies/teamRoles';
import { scheduleLabel } from './jobs/JobCard';
import type { JobView } from '@/components/os/modules/workspace/workTypes';
import { queueFor } from './jobs/workQueue';
import { jobStage } from './teamStages';
import { useActivity } from './jobs/ActivityList';
import WorkspaceNavigation from './workspace/WorkspaceNavigation';
import WorkDetail from './workspace/WorkDetail';
import GiveWork from './workspace/GiveWork';
import Responsibilities from './workspace/Responsibilities';
import type { WorkDraft } from '@/lib/work/drafts';
import { useVoiceWorkspace } from '../voice/VoiceWorkspace';

export default function WorkModule({ payload }: Partial<ModuleRenderContext>) {
    return <WorkspaceNavigation companyId={payload?.companyId} companyName={payload?.companyName}><WorkContent payload={payload} /></WorkspaceNavigation>;
}
function WorkContent({ payload }: Pick<Partial<ModuleRenderContext>, 'payload'>) {
    useVoiceWorkspace({ moduleId: 'work', companyId: payload?.companyId ?? '', companyName: payload?.companyName }, 20);
    const wm = useWindowManager();
    const [jobs, setJobs] = useState<JobView[] | null>(null), [error, setError] = useState('');
    const [query, setQuery] = useState(''), [view, setView] = useState('active'), [creating, setCreating] = useState(payload?.create === '1');
    const [selected, setSelected] = useState(payload?.jobId), [revision, setRevision] = useState(0);
    const activity = useActivity(revision, !selected && !creating);
    const [draft, setDraft] = useState<WorkDraft>();
    useEffect(() => {
        if (!creating || !payload?.draftTurnId) return;
        const c = new AbortController();
        void fetch('/api/os/work/draft?id=' + payload.draftTurnId, { signal: c.signal }).then(async r => { const b = await r.json(); if (!r.ok) throw Error(b.error); return b.draft; }).then(d => { if (!c.signal.aborted) setDraft(d); }).catch(e => { if (!c.signal.aborted) setError(e.message); });
        return () => c.abort();
    }, [creating, payload?.draftTurnId]);
    useEffect(() => {
        if (selected || creating) return;
        const controller = new AbortController();
        const load = async () => { try {
            const params = new URLSearchParams({ all: view === 'history' ? '1' : '0', ...(payload?.companyId ? { companyId: payload.companyId } : {}) });
            const res = await fetch(`/api/os/jobs?${params}`, { signal: controller.signal, cache: 'no-store' });
            const body = await res.json(); if (!res.ok) throw Error(body.error ?? 'Could not load work.');
            if (!controller.signal.aborted) { setJobs(body.jobs); setError(''); }
        } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load work.'); } };
        void load(); const stop = visibleInterval(() => void load(), 30_000);
        const changed = () => void load(); window.addEventListener('nucleas:jobs-changed', changed);
        return () => { controller.abort(); stop(); window.removeEventListener('nucleas:jobs-changed', changed); };
    }, [payload?.companyId, view, selected, creating, revision]);
    if (creating && payload?.draftTurnId && !draft) return <div className="p-5 space-y-3"><p role={error ? 'alert' : 'status'}>{error || 'Loading work agreement…'}</p><button className="ui-button" onClick={() => setCreating(false)}>Back to work</button></div>;
    if (creating) return <div className="h-full overflow-auto p-5"><GiveWork draftTurnId={payload?.draftTurnId} draft={draft} initialAssignedMemberId={payload?.assignedMemberId} initialRole={TEAM_ROLES.includes(payload?.role as TeamRole) ? payload?.role as TeamRole : undefined} companyId={draft?.companyId ?? payload?.companyId} onCancel={() => setCreating(false)} onResponsibility={() => { setCreating(false); setRevision(n => n + 1); }} onCreated={id => { setCreating(false); setSelected(id); }} /></div>;
    if (selected) return <div className="h-full overflow-auto"><div className="px-4 pt-4"><button className="ui-button" onClick={() => { setSelected(undefined); setRevision(n => n + 1); }}>← All work</button></div><WorkDetail jobId={selected} runId={payload?.runId} deliveryId={payload?.deliveryId} opportunityId={payload?.opportunityId} /></div>;
    const matches = (title: string) => title.toLowerCase().includes(query.toLowerCase());
    const filtered = (jobs ?? []).filter(j => (!payload?.role || teamRoleFor(j) === payload.role) && (!payload?.assignedMemberId || j.assignedMemberId === payload.assignedMemberId || (!j.assignedMemberId && payload.ownerKind !== 'additional')) && matches(`${j.companyName} ${j.design?.title ?? j.request} ${TEAM[teamRoleFor(j)].name}`) && (view === 'history' || (view === 'review' ? queueFor(j).length || j.status === 'failed' : !['done', 'archived', 'rejected'].includes(j.status))));
    const other = (activity?.items ?? []).filter(i => (!payload?.assignedMemberId || i.assignedMemberId === payload.assignedMemberId || (!i.assignedMemberId && payload.ownerKind !== 'additional' && i.teamRole === payload.role)) && (!payload?.companyId || i.companyId === payload.companyId) && matches(`${i.companyName} ${i.title}`) && (view !== 'review' || ['you', 'failed'].includes(i.group)));
    const companies = [...new Set([...filtered.map(j => j.companyId), ...other.flatMap(i => i.companyId ? [i.companyId] : [])])].map(id => ({ id, name: filtered.find(j => j.companyId === id)?.companyName ?? other.find(i => i.companyId === id)?.companyName ?? 'Company', jobs: filtered.filter(j => j.companyId === id), activity: other.filter(i => i.companyId === id) })).sort((a, b) => Number(b.jobs.some(j => queueFor(j).length > 0) || b.activity.some(i => i.group === 'you')) - Number(a.jobs.some(j => queueFor(j).length > 0) || a.activity.some(i => i.group === 'you')) || a.name.localeCompare(b.name));
    return <div className="h-full overflow-auto space-y-5 p-5">
        <header className="flex flex-wrap gap-3 justify-between"><div><h2 className="text-xl font-semibold">{payload?.companyName ? `${payload.companyName} · Work` : 'Work'}</h2><p className="text-sm text-text-secondary">Outcomes, owners, and the next meaningful action.</p></div><button className="ui-button-primary" onClick={() => setCreating(true)}>Give work</button></header>
        <div className="flex flex-wrap gap-2"><input className="ui-control min-w-0 flex-1" aria-label="Find work" placeholder="Find work or a company…" value={query} onChange={e => setQuery(e.target.value)} /><select className="ui-control" aria-label="Work view" value={view} onChange={e => setView(e.target.value)}><option value="active">Active work</option><option value="review">Needs a decision</option><option value="history">All work & history</option></select></div>
        {error && <p role="alert" className="text-red-400">{error}</p>}{!jobs && !error && <p>Loading work…</p>}
        {jobs && jobs.length >= 200 && <p className="text-sm text-amber-300">Showing the 200 most recently updated entries. This list may be incomplete. Open a company’s Work section to narrow the scope.</p>}
        {activity?.error && <p role="alert" className="text-amber-300">{activity.error}</p>}
        <Responsibilities assignedMemberId={payload?.assignedMemberId} ownerKind={payload?.ownerKind} role={payload?.role} includeClosed={view === 'history'} focusedId={payload?.responsibilityId} companyId={payload?.companyId} onJob={setSelected} revision={revision} reviewOnly={view === 'review'} />
        <details className="text-sm"><summary className="cursor-pointer text-text-secondary">Specialist workflows</summary><p className="my-2 text-xs text-text-secondary">Use the existing publishing, attachment, code, and integration editors for work that needs a specific delivery setup.</p><div className="flex gap-2 flex-wrap">{[['marketing', 'Marketing & publishing'], ['content', 'Articles & content'], ['building', 'Code & design']].map(([id, label]) => <button key={id} className="ui-button" onClick={() => wm.open(id, { payload: { ...(payload?.companyId ? { companyId: payload.companyId, companyName: payload.companyName ?? '' } : {}) } })}>{label}</button>)}</div></details>
        {companies.map(c => <details key={`${c.id}:${view}:${query}`} open={Boolean(payload?.companyId || c.jobs.some(j => queueFor(j).length) || c.activity.some(i => i.group === 'you'))} className="rounded-xl border border-border p-4">
            <summary className="cursor-pointer font-medium">{c.name} <span className="text-sm text-text-secondary">· {c.jobs.filter(j => !['done', 'rejected', 'archived'].includes(j.status)).length + c.activity.filter(i => i.group === 'working' || i.group === 'set').length} active</span></summary>
            <div className="mt-3 divide-y divide-border">{c.jobs.map(j => <button key={j.id} className="flex w-full flex-wrap items-center gap-3 py-4 text-left hover:text-primary" onClick={() => setSelected(j.id)}><span className="min-w-0 flex-1"><strong className="block text-sm">{j.design?.title ?? j.request}</strong><span className="text-xs text-text-secondary">{j.ownerName ?? TEAM[teamRoleFor(j)].name} · {j.design?.schedule.kind === 'once' ? 'One-off' : 'Repeating'} · {j.design ? scheduleLabel(j.design.schedule) : 'Planning'}</span></span><span className={`text-xs ${queueFor(j).length ? 'text-amber-300' : 'text-text-secondary'}`}>{jobStage(j).label} →</span></button>)}
            {c.activity.map(i => <button key={i.id} className="w-full py-4 text-left" onClick={() => wm.open(i.open.window, { payload: i.open.payload })}><strong className="block text-sm">{i.title}</strong><span className="text-xs text-text-secondary">{i.detail} · {i.status} →</span></button>)}</div>
        </details>)}
        {jobs && !companies.length && !error && <p className="text-sm text-text-secondary">No one-off or repeating work matches this view.</p>}
    </div>;
}
