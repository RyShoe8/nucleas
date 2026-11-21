'use client';
import { useEffect, useState } from 'react';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { useOsCompanies } from '../CompaniesModule';
import { TEAM, TEAM_ROLES, type TeamRole } from '@/lib/companies/teamRoles';
import WorkResources from './WorkResources';
import type { WorkDraft } from '@/lib/work/drafts';
import type { WorkAgreement } from '@/lib/work/agreements';
import { useVoiceWorkspace } from '../../voice/VoiceWorkspace';

export default function GiveWork({ companyId: initial, initialRole, initialAssignedMemberId, onCancel, onCreated, onResponsibility, draft, draftTurnId }: { draftTurnId?: string; draft?: WorkDraft; companyId?: string; initialRole?: TeamRole; initialAssignedMemberId?: string; onCancel: () => void; onCreated: (id: string) => void; onResponsibility?: (id: string) => void }) {
    const { companies } = useOsCompanies();
    const wm = useWindowManager();
    const [companyId, setCompanyId] = useState(initial ?? ''), [mode, setMode] = useState<WorkAgreement['mode']>(draft?.mode ?? 'once');
    const [role, setRole] = useState<TeamRole>(initialRole ?? draft?.role ?? 'marketing'), [outcome, setOutcome] = useState(draft?.outcome ?? ''), [standard, setStandard] = useState(draft?.standard ?? '');
    const [targets, setTargets] = useState(''), [frequency, setFrequency] = useState<'daily' | 'weekly'>(draft?.schedule?.kind === 'daily' ? 'daily' : 'weekly'), [time, setTime] = useState(draft?.schedule?.time ?? '09:00'), [weekdays, setWeekdays] = useState(draft?.schedule?.weekdays ?? [draft?.schedule?.weekday ?? 1]);
    const [level, setLevel] = useState<WorkAgreement['level']>(draft?.level);
    const [assetIds, setAssetIds] = useState<string[]>(draft?.assetIds ?? []), [sources, setSources] = useState(''), [uploading, setUploading] = useState(false);
    const [timezone, setTimezone] = useState(draft?.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    const [gates, setGates] = useState(''), [threshold, setThreshold] = useState(85), [maxPending, setMaxPending] = useState(3);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [inventory, setInventory] = useState<{ source: string; targets: { key: string; name: string; url: string; status: string }[] } | null>(null);
    const [owner, setOwner] = useState(initialAssignedMemberId ?? '');
    const [people, setPeople] = useState<{ id: string; role: TeamRole; active: boolean; name: string; specialty?: string }[]>([]);
    useVoiceWorkspace({ moduleId: 'work', companyId, companyName: companies?.find(c => c.id === companyId)?.name }, 30);
    useEffect(() => {
        if (!companyId) return;
        const c = new AbortController();
        void fetch(`/api/os/companies/${companyId}/team`, { signal: c.signal }).then(async r => { if (!r.ok) throw Error('Could not load the company team.'); return r.json(); }).then(b => { if (!c.signal.aborted) setPeople([...(b.members ?? []), ...(b.specialists ?? [])].filter(p => p.active)); }).catch(e => { if (!c.signal.aborted) setError(e.message); });
        return () => c.abort();
    }, [companyId]);
    const openCreated = (created: NonNullable<WorkDraft['created']>) => {
        if (created.kind === 'build') { onCancel(); wm.open('team', { payload: { companyId, jobId: created.id } }); }
        else if (created.kind === 'responsibility') { if (onResponsibility) onResponsibility(created.id); else onCancel(); }
        else onCreated(created.id);
    };
    const submit = async () => {
        setBusy(true); setError('');
        try {
            const response = await fetch('/api/os/work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId, draftTurnId, agreement: { mode, role, level, assetIds, sources: sources.split('\n').map(s => s.trim()).filter(Boolean), ...(owner ? { assignedMemberId: owner } : {}), outcome, standard, threshold, maxPending, gates: gates.split('\n').map(s => s.trim()).filter(Boolean), targets: targets.split('\n').map(s => s.trim()).filter(Boolean), ...(mode === 'repeating' ? { schedule: { kind: frequency, time, weekdays, timezone } } : {}) } }) });
            const body = await response.json(); if (!response.ok) throw Error(body.error ?? 'Could not create work.');
            window.dispatchEvent(new Event('nucleas:jobs-changed'));
            openCreated(body.created);
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not create work.'); } finally { setBusy(false); }
    };
    if (draft?.created) return <div className="space-y-3"><h2 className="text-xl font-semibold">Work already prepared</h2><p>This agreement is linked to existing work.</p><button className="ui-button-primary" onClick={() => openCreated(draft.created!)}>Open work</button></div>;
    if (draft?.submission) return <div className="space-y-3"><p>This agreement is being prepared. Reopen it shortly to see the result.</p><button className="ui-button" onClick={onCancel}>Back to work</button></div>;
    return <form className="mx-auto max-w-3xl space-y-5" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <header className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-semibold">Give work</h2><p className="text-sm text-text-secondary">An outcome, an owner, and a clear definition of done.</p></div><button type="button" className="ui-button" onClick={onCancel}>Cancel</button></header>
        <div className="flex gap-2 flex-wrap">{([['once', 'One-off'], ['repeating', 'Repeating'], ['ongoing', 'Ongoing']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={mode === id} className={mode === id ? 'ui-button-primary' : 'ui-button'} onClick={() => setMode(id)}>{label}</button>)}</div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Company<select required value={companyId} disabled={Boolean(initial) || uploading || busy} onChange={e => { setCompanyId(e.target.value); setOwner(''); setPeople([]); setInventory(null); setTargets(''); setAssetIds([]); }} className="ui-control mt-1 w-full"><option value="">Choose a company</option>{companies?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="text-sm">Owner’s field<select value={role} onChange={e => { setRole(e.target.value as TeamRole); setOwner(''); }} className="ui-control mt-1 w-full">{TEAM_ROLES.filter(r => TEAM[r].active).map(r => <option key={r} value={r}>{TEAM[r].name}</option>)}</select></label></div>
        <label className="block text-sm">Employee<select className="ui-control mt-1 w-full" value={owner} onChange={e => setOwner(e.target.value)}><option value="">{TEAM[role].name} lead</option>{people.filter(p => p.role === role && p.id).map(p => <option key={p.id} value={p.id}>{p.name}{p.specialty ? ' · ' + p.specialty : ''}</option>)}</select></label>
        <label className="block text-sm">What should be achieved?<textarea required minLength={10} maxLength={3000} value={outcome} onChange={e => setOutcome(e.target.value)} className="ui-control mt-1 min-h-24 w-full" /></label>
        <label className="block text-sm">What counts as done?<textarea required minLength={10} maxLength={2000} value={standard} onChange={e => setStandard(e.target.value)} placeholder="Required evidence, quality checks, and the result you expect." className="ui-control mt-1 min-h-20 w-full" /></label>
        {draft?.attachmentWarnings?.map((warning, i) => <p key={i} role="alert" className="text-sm text-amber-300">{warning}</p>)}
        <WorkResources key={companyId} companyId={companyId} ids={assetIds} onChange={setAssetIds} onBusy={setUploading} />
        <label className="block text-sm">Source links · optional, one per line<textarea value={sources} onChange={e => setSources(e.target.value)} className="ui-control mt-1 min-h-16 w-full" placeholder="https://…" /></label>
        {mode === 'repeating' && <div className="flex gap-3 flex-wrap"><label>Schedule<select className="ui-control block" value={frequency} onChange={e => setFrequency(e.target.value as typeof frequency)}><option value="weekly">Weekly</option><option value="daily">Daily</option></select></label>{frequency === 'weekly' && <fieldset><legend className="text-sm">Days</legend><div className="flex flex-wrap gap-1">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => <button type="button" key={d} aria-pressed={weekdays.includes(i)} className={weekdays.includes(i) ? 'ui-button-primary' : 'ui-button'} onClick={() => setWeekdays(old => old.includes(i) ? old.filter(day => day !== i) : [...old, i].sort())}>{d}</button>)}</div></fieldset>}<label>Time<input type="time" className="ui-control block" required value={time} onChange={e => setTime(e.target.value)} /></label><label>Timezone<input required className="ui-control block" value={timezone} onChange={e => setTimezone(e.target.value)} /></label></div>}
        {mode === 'ongoing' && <><button type="button" disabled={busy || !companyId} className="ui-button" onClick={async () => { setBusy(true); setError(''); try { const res = await fetch('/api/os/work/inventory?companyId=' + companyId); const b = await res.json(); if (!res.ok) throw Error(b.error); setInventory(b); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Choose from connected catalog</button>
        {inventory && <fieldset className="max-h-60 overflow-auto rounded-xl border border-border p-3"><legend>Canonical inventory · choose pilot pages</legend><p className="text-xs">Read from {inventory.source}. These selections authorize drafting only.</p>{inventory.targets.map(t => <label key={t.key} className="block text-sm py-1"><input type="checkbox" checked={targets.split('\n').includes(t.url)} onChange={e => setTargets(old => (e.target.checked ? [...new Set([...old.split('\n').filter(Boolean), t.url])] : old.split('\n').filter(u => u !== t.url)).join('\n'))} /> {t.name} · {t.status}</label>)}</fieldset>}
        <label className="block text-sm">Target pages · one URL per line<textarea required value={targets} onChange={e => setTargets(e.target.value)} className="ui-control mt-1 min-h-24 w-full" placeholder="https://your-company.example/review-page" /></label><p className="rounded-xl border border-border p-4 text-sm">Prepare reviewed page audits and improvement drafts for this collection, then monitor for changes. The agreement and quality standard are reviewed before work starts. Missing inventory blocks activation.</p></>}
        <label className="block text-sm">Model level<select className="ui-control ml-2" value={level ?? ''} onChange={e => setLevel((e.target.value || undefined) as WorkAgreement['level'])}><option value="">Organization default</option><option value="free">Free</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <p className="text-xs text-text-secondary">Uses the shared model engine. Review before external publication. Existing budget limits and company permissions apply.</p>
        {mode === 'ongoing' && <div className="space-y-3"><label className="block text-sm">Mandatory checks · one per line<textarea required minLength={5} maxLength={3000} className="ui-control mt-1 min-h-20 w-full" value={gates} onChange={e => setGates(e.target.value)} placeholder="For example: every factual claim has dated primary evidence." /></label><div className="flex flex-wrap gap-4"><label>Quality threshold /100<input type="number" min="1" max="100" required className="ui-control ml-2 w-20" value={threshold} onChange={e => setThreshold(Number(e.target.value))} /></label><label>Maximum pending reviews<input type="number" min="1" max="10" required className="ui-control ml-2 w-20" value={maxPending} onChange={e => setMaxPending(Number(e.target.value))} /></label></div></div>}
        {error && <p role="alert" className="text-red-400">{error}</p>}<button disabled={busy || uploading || !companyId || (mode === 'repeating' && frequency === 'weekly' && !weekdays.length)} className="ui-button-primary">{busy ? 'Preparing…' : 'Prepare work agreement'}</button>
    </form>;
}
