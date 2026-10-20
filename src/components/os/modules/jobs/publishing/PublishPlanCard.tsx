'use client';

import { useState } from 'react';
import { PLATFORM_LABEL } from '@/lib/publishing/config';
import type { PublishPlan } from '@/lib/publishing/setup';
import type { JobView } from '../JobCard';
import { ChannelPicker, NotifyPicker, type ChannelChoice } from './Pickers';

/**
 * The confirmation Nucleas shows after reading a publishing request: what it will watch, where each
 * post goes (Auto or Manual per platform), and who is told. Confirming starts a dry run; nothing posts.
 */
export default function PublishPlanCard({ companyId, request, plan, onCreated, onCancel }: { companyId: string; request: string; plan: PublishPlan; onCreated: (job: JobView) => void; onCancel: () => void }) {
    const [channels, setChannels] = useState<ChannelChoice[]>(plan.channels);
    const [notify, setNotify] = useState<string[]>(plan.notifyUserIds);
    const [examples, setExamples] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const selected = channels.filter((c) => c.selected);

    const create = async () => {
        setBusy(true);
        setError(null);
        const res = await fetch('/api/os/jobs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                companyId,
                template: 'social_publish',
                config: {
                    request,
                    source: plan.source,
                    channels: selected.map((c) => ({ platform: c.platform, mode: c.mode })),
                    notifyUserIds: notify,
                    ...(plan.admin ? { admin: plan.admin } : {}),
                    examples: Object.fromEntries(Object.entries(examples).filter(([platform, value]) => value.trim() && selected.some((c) => c.platform === platform))),
                },
            }),
        });
        const body = (await res.json().catch(() => ({}))) as { job?: JobView; error?: string };
        setBusy(false);
        if (!res.ok || !body.job) return setError(body.error ?? `Failed (${res.status})`);
        onCreated(body.job);
        window.dispatchEvent(new Event('nucleas:jobs-changed'));
    };

    return (
        <div className="ui-card space-y-4 p-4">
            <div>
                <p className="font-medium">{plan.title}</p>
                <p className="text-xs text-text-secondary">
                    {plan.source.type === 'site' && plan.source.rotation
                        ? `${plan.sourceLabel}. The first one posts at the next hourly check after you accept, then the rest follow in order and the list starts over at the end.`
                        : `${plan.sourceLabel} · checks every hour${plan.newest ? ` · newest now: ${plan.newest.title}` : ''}`}
                </p>
            </div>
            {plan.blocker ? <p className="rounded border border-amber-400/40 bg-amber-400/5 p-2 text-xs text-amber-300">{plan.blocker}</p> : null}

            {plan.admin ? (
                <section className="space-y-2">
                    <h4 className="ui-kicker">Adds to</h4>
                    <p className="text-sm">
                        <a href={plan.admin.formUrl} target="_blank" rel="noreferrer" className="text-primary underline">{new URL(plan.admin.formUrl).host}{new URL(plan.admin.formUrl).pathname}</a>
                        <span className="text-text-secondary"> · saves with “{plan.admin.submit.label}”</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {plan.admin.fields.map((f) => (
                            <span key={f.key} className="rounded-full border border-border px-2 py-0.5 text-xs">{f.label || f.key}{f.required ? ' *' : ''}</span>
                        ))}
                    </div>
                    <p className="text-[11px] text-text-secondary">Nucleas fills these from each {plan.source.noun} and leaves out anything the {plan.source.noun} does not say. If the form changes, it learns it again.</p>
                    <ChannelPicker channels={channels} onChange={setChannels} />
                </section>
            ) : (
                <section className="space-y-2">
                    <h4 className="ui-kicker">Post to</h4>
                    <ChannelPicker channels={channels} onChange={setChannels} />
                </section>
            )}

            <section className="space-y-2">
                <h4 className="ui-kicker">Notify</h4>
                <NotifyPicker people={plan.people} value={notify} onChange={setNotify} />
            </section>

            {selected.length && !plan.admin ? (
                <details className="text-sm">
                    <summary className="cursor-pointer text-xs text-text-secondary">Example posts (optional): shape each platform&rsquo;s structure</summary>
                    <div className="mt-2 space-y-2">
                        {selected.map((c) => (
                            <label key={c.platform} className="block space-y-1">
                                <span className="text-xs">{PLATFORM_LABEL[c.platform]}</span>
                                <textarea
                                    className="ui-control h-16 w-full resize-y text-xs"
                                    value={examples[c.platform] ?? ''}
                                    onChange={(e) => setExamples((v) => ({ ...v, [c.platform]: e.target.value }))}
                                    placeholder={c.platform === 'facebook' ? 'Paste the text of a post you like' : 'Paste a link to a post you like, or its text'}
                                />
                            </label>
                        ))}
                        <p className="text-[11px] text-text-secondary">Nucleas copies the structure (parts, order, length, where the link goes), not the wording. The approved Voice sets the tone.</p>
                    </div>
                </details>
            ) : null}

            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="ui-button-primary" disabled={busy || !selected.length || Boolean(plan.blocker)} onClick={() => void create()}>
                    {busy ? 'Starting…' : 'Run a dry run'}
                </button>
                <button type="button" className="ui-button" onClick={onCancel}>Cancel</button>
                <span className="text-[11px] text-text-secondary">{plan.admin ? `Fills the form for the newest ${plan.source.noun} without saving it.` : `Writes sample posts for the newest ${plan.source.noun} and posts nothing.`}</span>
            </div>
        </div>
    );
}
