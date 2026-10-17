'use client';

import { useState } from 'react';
import type { PublishPlan } from '@/lib/publishing/setup';
import type { JobView } from './JobCard';
import PublishPlanCard from './publishing/PublishPlanCard';

type Recognized = { kind: 'social_publish'; plan: PublishPlan } | { kind: 'link_building' | 'marketing_plan' | 'custom' };

/**
 * The one place to start marketing work: describe it in a sentence and Nucleas works out what kind of
 * job it is. Publishing requests get a short plan to confirm; link building gets its settings; anything
 * else is designed by Nucleas as a custom job.
 */
export default function MarketingComposer({ companyId, companyName, onCreated, renderLinkBuilding, onMarketingPlan }: {
    companyId: string;
    companyName: string;
    onCreated: (job: JobView) => void;
    /** The link-building settings form, shown when the request is about backlinks. */
    renderLinkBuilding: (done: () => void) => React.ReactNode;
    onMarketingPlan: () => void;
}) {
    const [request, setRequest] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recognized, setRecognized] = useState<Recognized | null>(null);

    const reset = () => {
        setRecognized(null);
        setRequest('');
        setError(null);
    };

    const designCustom = async () => {
        const res = await fetch('/api/os/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId, request }) });
        const body = (await res.json().catch(() => ({}))) as { job?: JobView; error?: string };
        if (!res.ok || !body.job) throw new Error(body.error ?? `Failed (${res.status})`);
        onCreated(body.job);
        window.dispatchEvent(new Event('nucleas:jobs-changed'));
        reset();
    };

    const submit = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/os/jobs/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId, request }) });
            const body = (await res.json().catch(() => ({}))) as { plan?: PublishPlan | { kind: 'link_building' | 'marketing_plan' | 'custom' }; error?: string };
            if (!res.ok || !body.plan) throw new Error(body.error ?? `Failed (${res.status})`);
            if (body.plan.kind === 'custom') await designCustom();
            else if (body.plan.kind === 'marketing_plan') {
                onMarketingPlan();
                reset();
            } else setRecognized(body.plan.kind === 'social_publish' ? { kind: 'social_publish', plan: body.plan as PublishPlan } : { kind: body.plan.kind });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.');
        } finally {
            setBusy(false);
        }
    };

    if (recognized?.kind === 'social_publish') {
        return <PublishPlanCard companyId={companyId} request={request} plan={recognized.plan} onCreated={(job) => { onCreated(job); reset(); }} onCancel={reset} />;
    }
    if (recognized?.kind === 'link_building') return <>{renderLinkBuilding(reset)}</>;

    return (
        <div className="ui-card space-y-2 p-3">
            <textarea
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && request.trim().length >= 10 && !busy) void submit();
                }}
                placeholder={`What should Nucleas do for ${companyName}? e.g. “When something new is published on our site, post it to Facebook and Bluesky” or “Add the best deals from our email to our admin.”`}
                className="ui-control h-16 w-full resize-y"
                aria-label="Describe a marketing job"
            />
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            <div className="flex items-center gap-2">
                <button type="button" className="ui-button-primary" disabled={busy || request.trim().length < 10} onClick={() => void submit()}>
                    {busy ? 'Reading…' : 'Continue'}
                </button>
                <span className="text-[11px] text-text-secondary">Nucleas works out the details and shows you a plan before anything runs.</span>
            </div>
        </div>
    );
}
