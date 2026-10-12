'use client';

import { useCallback, useEffect, useState } from 'react';
import BrandVoicePanel from './jobs/BrandVoicePanel';
import JobCard, { jobIsBusy, type JobView } from './jobs/JobCard';
import type { ModuleRenderContext } from '@/lib/os/types';

/** A company's Voice: the persona every content tool writes in, plus the jobs that build it. Opens from the company window. */
export default function BrandVoiceModule({ payload }: ModuleRenderContext) {
    const companyId = payload?.companyId ?? '';
    const [jobs, setJobs] = useState<JobView[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const reload = useCallback(() => setReloadKey((k) => k + 1), []);

    useEffect(() => {
        window.addEventListener('nucleas:jobs-changed', reload);
        return () => window.removeEventListener('nucleas:jobs-changed', reload);
    }, [reload]);

    useEffect(() => {
        if (!companyId) return;
        let cancelled = false;
        void (async () => {
            const res = await fetch('/api/os/jobs', { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as { jobs?: JobView[]; error?: string };
            if (cancelled) return;
            if (!res.ok) return setError(body.error ?? `Failed (${res.status})`);
            setError(null);
            setJobs((body.jobs ?? []).filter((job) => job.companyId === companyId && job.design?.skill === 'brand_voice'));
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId, reloadKey]);

    const busy = jobs.some(jobIsBusy);
    useEffect(() => {
        if (!busy) return;
        const timer = window.setInterval(reload, 5000);
        return () => window.clearInterval(timer);
    }, [busy, reload]);

    const replace = (next: JobView) => setJobs((list) => list.map((job) => (job.id === next.id ? next : job)));

    if (!companyId) return <div className="p-4 text-sm text-text-secondary">Open Voice from a company.</div>;
    return (
        <div className="h-full overflow-y-auto p-4 space-y-4 text-text-primary">
            <BrandVoicePanel
                key={companyId}
                companyId={companyId}
                onCreated={(job) => {
                    setJobs((list) => [job, ...list.filter((existing) => existing.id !== job.id)]);
                }}
            />
            {error ? <p className="text-xs text-red-400">{error}</p> : null}
            {jobs.length ? (
                <section className="space-y-2">
                    <h3 className="ui-kicker">Voice generation</h3>
                    {jobs.map((job) => (
                        <JobCard key={job.id} job={job} onChange={replace} />
                    ))}
                </section>
            ) : null}
        </div>
    );
}
