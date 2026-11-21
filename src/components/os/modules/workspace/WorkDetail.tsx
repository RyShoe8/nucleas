'use client';
import { useEffect, useRef, useState } from 'react';
import JobCard from '../jobs/JobCard';
import type { JobView } from '@/components/os/modules/workspace/workTypes';
import { visibleInterval } from '@/lib/os/visibleInterval';
import { TEAM, type TeamRole } from '@/lib/companies/teamRoles';
import WorkReferences from './WorkReferences';
/** Shared result view; native IDs and historical review targets stay intact. */
export default function WorkDetail({ jobId, runId, deliveryId, opportunityId }: { jobId: string; runId?: string; deliveryId?: string; opportunityId?: string }) {
    const [job, setJob] = useState<JobView | null>(null);
    const [error, setError] = useState('');
    const [people, setPeople] = useState<{ id: string; role: TeamRole; name: string; active: boolean }[]>([]);
    const [assigning, setAssigning] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const mutation = useRef(0);
    useEffect(() => {
        const controller = new AbortController();
        const query = new URLSearchParams();
        if (runId) query.set('runId', runId);
        if (deliveryId) query.set('deliveryId', deliveryId);
        if (opportunityId) query.set('opportunityId', opportunityId);
        const load = async () => {
            const version = mutation.current;
            try {
                const response = await fetch(`/api/os/jobs/${jobId}?${query}`, { signal: controller.signal, cache: 'no-store' });
                const body = await response.json();
                if (!response.ok || !body.job) throw Error(body.error ?? 'This work could not be loaded.');
                if (!controller.signal.aborted && version === mutation.current) { setJob(body.job); setError(''); }
            } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load work.'); }
        };
        void load(); const stop = visibleInterval(() => void load(), 30_000);
        return () => { controller.abort(); stop(); };
    }, [jobId, runId, deliveryId, opportunityId]);
    useEffect(() => {
        if (!job?.companyId) return;
        const c = new AbortController();
        void fetch(`/api/os/companies/${job.companyId}/team`, { signal: c.signal }).then(async r => r.ok ? r.json() : null).then(b => { if (b && !c.signal.aborted) setPeople([...(b.members ?? []), ...(b.specialists ?? [])].filter(m => m.active)); }).catch(() => {});
        return () => c.abort();
    }, [job?.companyId]);
    useEffect(() => {
        const selector = deliveryId ? `[data-delivery-id="${CSS.escape(deliveryId)}"]` : opportunityId ? `[data-opportunity-id="${CSS.escape(opportunityId)}"]` : null;
        if (selector && job) root.current?.querySelector(selector)?.scrollIntoView({ block: 'center' });
        // Focus a historical delivery once; refreshes must not move the reader.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deliveryId, opportunityId, Boolean(job)]);
    return <div ref={root} className="space-y-4 p-4">
        {error && <p role="alert" className="text-red-400">{error}</p>}
        {job?.workAgreement && <WorkReferences companyId={job.companyId} agreement={job.workAgreement} />}
        {job?.canManage && people.length > 0 && <label className="block text-sm">Accountable employee<select aria-label="Accountable employee" className="ui-control ml-2" disabled={assigning} value={job.assignedMemberId ?? ''} onChange={async e => {
            const member = people.find(p => p.id === e.target.value); if (!member) return;
            setAssigning(true); setError('');
            try {
                const r = await fetch(`/api/os/companies/${job.companyId}/team`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'assign', jobId: job.id, role: member.role, assignedMemberId: member.id }) });
                const body = await r.json(); if (!r.ok) throw Error(body.error);
                mutation.current += 1; setJob({ ...job, teamRole: member.role, assignedMemberId: member.id, ownerName: member.name }); window.dispatchEvent(new Event('nucleas:jobs-changed'));
            } catch (e) { setError((e as Error).message); } finally { setAssigning(false); }
        }}><option value="">{job.teamRole ? TEAM[job.teamRole].name : 'Assigned field'} lead</option>{people.map(p => <option key={p.id} value={p.id}>{p.name} · {TEAM[p.role].name}</option>)}</select><small className="block text-text-secondary">Changes apply to future work; the current result and its evidence are retained.</small></label>}
        {job ? <JobCard key={job.id} job={job} focusRunId={runId} onChange={next => { mutation.current += 1; setJob(next); window.dispatchEvent(new Event('nucleas:jobs-changed')); }} /> : !error && <p className="text-text-secondary">Loading work…</p>}
    </div>;
}
