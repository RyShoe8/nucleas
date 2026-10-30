'use client';

import { useState } from 'react';
import type { PublishPlan } from '@/lib/publishing/setup';
import type { Understanding } from '@/lib/jobs/understand-client';
import type { JobView } from './JobCard';
import PublishPlanCard from './publishing/PublishPlanCard';
import PublishingImagePicker, { type SocialImage } from './publishing/PublishingImagePicker';

type Answers = Record<string, { option?: string; text?: string }>;

const NEED_TONE: Record<'ready' | 'action' | 'missing', { mark: string; tone: string; label: string }> = {
    ready: { mark: '✓', tone: 'text-emerald-300', label: 'Ready' },
    action: { mark: '→', tone: 'text-amber-300', label: 'Set up' },
    missing: { mark: '!', tone: 'text-red-300', label: 'Not available yet' },
};

/**
 * Where any job starts: describe it in a sentence, Nucleas says back what it understood (the kind of job,
 * what will happen, what is needed, and only the questions it must ask), the person confirms or corrects
 * it, and only then is the job set up: a publishing plan, link building, an inbox rule, the Marketing Plan,
 * or a custom job Nucleas designs from the confirmed brief.
 */
export default function JobComposer({ companyId, companyName, onCreated, renderLinkBuilding, onMarketingPlan, onInboxWatch, allowImage = false, placeholder }: {
    companyId: string;
    companyName: string;
    onCreated: (job: JobView) => void;
    /** The link-building settings form, for requests about backlinks. */
    renderLinkBuilding: (done: () => void) => React.ReactNode;
    onMarketingPlan: () => void;
    /** Inbox rules and digests are set up in Marketing → Inboxes, starting from the understood brief. */
    onInboxWatch: (brief: string) => void;
    /** Marketing only: attach an image to a social publishing job. */
    allowImage?: boolean;
    placeholder?: string;
}) {
    const [image, setImage] = useState<SocialImage | null>(null);
    const [uploading, setUploading] = useState(false);
    const [request, setRequest] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [understanding, setUnderstanding] = useState<Understanding | null>(null);
    const [answers, setAnswers] = useState<Answers>({});
    const [plan, setPlan] = useState<PublishPlan | null>(null);
    const [linkBuilding, setLinkBuilding] = useState(false);

    const reset = () => {
        setImage(null);
        setUnderstanding(null);
        setAnswers({});
        setPlan(null);
        setLinkBuilding(false);
        setRequest('');
        setError(null);
    };

    const understand = async (withAnswers?: Answers) => {
        if (busy || uploading) return;
        setBusy(withAnswers ? 'Updating…' : 'Reading…');
        setError(null);
        try {
            const res = await fetch('/api/os/jobs/understand', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ companyId, request, ...(withAnswers ? { answers: withAnswers, previous: { questions: understanding?.questions ?? [] } } : {}) }),
            });
            const body = (await res.json().catch(() => ({}))) as { understanding?: Understanding; error?: string };
            if (!res.ok || !body.understanding) throw new Error(body.error ?? (res.status === 504 ? 'The server ran out of time (504). Try again.' : `Failed (${res.status})`));
            setUnderstanding(body.understanding);
            if (!withAnswers) setAnswers({});
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.');
        } finally {
            setBusy(null);
        }
    };

    const proceed = async () => {
        if (!understanding || busy) return;
        const u = understanding;
        setError(null);
        try {
            if (image && u.kind !== 'social_publish') throw new Error('An image can only be attached to a social publishing job. Remove it to continue.');
            if (u.kind === 'social_publish' || u.kind === 'admin_publish') {
                setBusy('Preparing the plan…');
                const res = await fetch('/api/os/jobs/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId, request: u.brief, kind: u.kind }) });
                const body = (await res.json().catch(() => ({}))) as { plan?: PublishPlan | { kind: string }; error?: string };
                if (!res.ok || !body.plan) throw new Error(body.error ?? `Failed (${res.status})`);
                if (body.plan.kind !== 'social_publish') throw new Error('Nucleas could not prepare a publishing plan for this. Try rewording it.');
                setPlan(body.plan as PublishPlan);
            } else if (u.kind === 'link_building') setLinkBuilding(true);
            else if (u.kind === 'marketing_plan') {
                onMarketingPlan();
                reset();
            } else if (u.kind === 'inbox_watch' || u.kind === 'digest') {
                onInboxWatch(u.brief);
                reset();
            } else {
                setBusy('Starting the design…');
                const res = await fetch('/api/os/jobs', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ companyId, request, understanding: { kind: u.kind, summary: u.summary, brief: u.brief, needs: u.needs } }),
                });
                const body = (await res.json().catch(() => ({}))) as { job?: JobView; error?: string };
                if (!res.ok || !body.job) throw new Error(body.error ?? `Failed (${res.status})`);
                onCreated(body.job);
                window.dispatchEvent(new Event('nucleas:jobs-changed'));
                reset();
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.');
        } finally {
            setBusy(null);
        }
    };

    if (plan && understanding) return <PublishPlanCard initialImage={image} companyId={companyId} request={understanding.brief} plan={plan} onCreated={(job) => { onCreated(job); reset(); }} onCancel={reset} />;
    if (linkBuilding) return <>{renderLinkBuilding(reset)}</>;

    if (understanding) {
        const u = understanding;
        const open = u.questions.filter((q) => !answers[q.id]?.option && !answers[q.id]?.text?.trim());
        const answeredAny = Object.keys(answers).length > 0;
        const blocked = u.needs.some((n) => n.status === 'missing');
        return (
            <div className="ui-card space-y-3 p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">Here’s what I understood</h3>
                    <span className="rounded border border-sky-400/40 px-1.5 py-0.5 text-[10px] text-sky-300">{u.kindLabel}</span>
                    {!u.understood ? <span className="text-[11px] text-amber-300">A guess from the wording: check it</span> : u.confidence < 0.7 ? <span className="text-[11px] text-amber-300">Not sure: check it</span> : null}
                </div>
                <p className="text-sm leading-relaxed">{u.summary}</p>
                {u.needs.length ? (
                    <div className="space-y-1">
                        <span className="ui-kicker">What it needs</span>
                        <ul className="space-y-1 text-xs">
                            {u.needs.map((n, i) => (
                                <li key={i} className="flex gap-2">
                                    <span className={`w-3 shrink-0 text-center ${NEED_TONE[n.status].tone}`} aria-label={NEED_TONE[n.status].label}>{NEED_TONE[n.status].mark}</span>
                                    <span><span className="font-medium">{n.label}</span>{n.detail ? <span className="text-text-secondary"> · {n.detail}</span> : null}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
                {u.questions.length ? (
                    <div className="space-y-3">
                        {u.questions.map((q) => (
                            <div key={q.id} className="space-y-1">
                                <p className="text-sm font-medium">{q.question}</p>
                                {q.why ? <p className="text-[11px] text-text-secondary">{q.why}</p> : null}
                                <div className="flex flex-wrap gap-1">
                                    {q.options.map((o) => (
                                        <button key={o.id} type="button" className={answers[q.id]?.option === o.id ? 'ui-button-primary' : 'ui-button'} onClick={() => setAnswers((a) => ({ ...a, [q.id]: { option: o.id } }))}>
                                            {o.label}{q.recommended === o.id ? ' (recommended)' : ''}
                                        </button>
                                    ))}
                                </div>
                                <input className="ui-control w-full text-xs" placeholder="Or answer in your own words" value={answers[q.id]?.text ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: { text: e.target.value } }))} aria-label={`Answer: ${q.question}`} />
                            </div>
                        ))}
                    </div>
                ) : null}
                {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                    {u.questions.length ? (
                        <button type="button" className="ui-button-primary" disabled={Boolean(busy) || open.length > 0} onClick={() => void understand(answers)} title={open.length ? 'Answer each question first' : undefined}>{busy ?? 'Use these answers'}</button>
                    ) : (
                        <button type="button" className="ui-button-primary" disabled={Boolean(busy)} onClick={() => void proceed()}>{busy ?? (u.kind === 'custom' ? 'Yes, design this job' : u.kind === 'inbox_watch' || u.kind === 'digest' ? 'Yes, set up the inbox rule' : u.kind === 'marketing_plan' ? 'Yes, generate it' : 'Yes, continue')}</button>
                    )}
                    <button type="button" className="ui-button" disabled={Boolean(busy)} onClick={() => { setUnderstanding(null); setAnswers({}); }}>Not quite: change the request</button>
                    {!u.questions.length && answeredAny ? <span className="text-[11px] text-text-secondary">Updated with your answers.</span> : null}
                    {blocked && !u.questions.length ? <span className="text-[11px] text-amber-300">Part of this needs something Nucleas cannot do yet; the design will say what.</span> : null}
                </div>
            </div>
        );
    }

    return (
        <div className="ui-card space-y-2 p-3">
            <textarea
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && request.trim().length >= 10) void understand();
                }}
                placeholder={placeholder ?? `What should Nucleas do for ${companyName}? e.g. “When something new is published on our site, post it to Facebook and Bluesky” or “Every Monday, report last week’s ad revenue per site.”`}
                className="ui-control h-16 w-full resize-y"
                aria-label="Describe a job"
            />
            {allowImage ? <PublishingImagePicker companyId={companyId} image={image} onChange={setImage} onBusy={setUploading} /> : null}
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="ui-button-primary" disabled={Boolean(busy) || uploading || request.trim().length < 10} onClick={() => void understand()}>
                    {busy ?? 'Continue'}
                </button>
                <span className="text-[11px] text-text-secondary">Nucleas says back what it understood before anything is set up.</span>
            </div>
        </div>
    );
}
