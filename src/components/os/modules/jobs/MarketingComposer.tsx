'use client';

import { useState } from 'react';
import type { JobView } from './JobCard';
import JobComposer from './JobComposer';

/**
 * Marketing's request box: the shared job composer (Nucleas says back what it understood before anything
 * is set up), with images for social posts and the specialized discovery jobs.
 */
export default function MarketingComposer({ companyId, companyName, onCreated, renderLinkBuilding, onMarketingPlan, onInboxWatch }: {
    companyId: string;
    companyName: string;
    onCreated: (job: JobView) => void;
    /** The link-building settings form, shown when the request is about backlinks. */
    renderLinkBuilding: (done: () => void) => React.ReactNode;
    onMarketingPlan: () => void;
    onInboxWatch: (brief: string) => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const discovery = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/os/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId, template: 'casino_discovery' }) });
            const body = (await res.json().catch(() => ({}))) as { job?: JobView; error?: string };
            if (!res.ok || !body.job) throw new Error(body.error ?? 'Could not configure discovery.');
            onCreated(body.job);
        } catch (problem) {
            setError(problem instanceof Error ? problem.message : 'Could not configure discovery.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="space-y-2">
            <JobComposer
                companyId={companyId}
                companyName={companyName}
                onCreated={onCreated}
                renderLinkBuilding={renderLinkBuilding}
                onMarketingPlan={onMarketingPlan}
                onInboxWatch={onInboxWatch}
                allowImage
                placeholder={`What should Nucleas do for ${companyName}? e.g. “When something new is published on our site, post it to Facebook and Bluesky” or “Add the best deals from our email to our admin.”`}
            />
            <details className="text-xs text-text-secondary">
                <summary className="cursor-pointer">Specialized jobs</summary>
                <button type="button" className="ui-button mt-2" disabled={busy} onClick={() => void discovery()}>Casino / sports betting discovery</button>
                {error ? <p role="alert" className="mt-1 text-red-400">{error}</p> : null}
            </details>
        </div>
    );
}
