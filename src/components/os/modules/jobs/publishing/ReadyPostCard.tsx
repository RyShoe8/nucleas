'use client';

import { useState } from 'react';
import { PLATFORM_RULES, manualPostText } from '@/lib/publishing/compose';
import { PLATFORM_LABEL, MANUAL_ONLY } from '@/lib/publishing/config';
import type { DeliveryView } from '@/lib/publishing/engine';
import type { JobView } from '../JobCard';

async function act(jobId: string, body: Record<string, unknown>): Promise<{ job?: JobView; error?: string }> {
    const res = await fetch(`/api/os/jobs/${jobId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { job?: JobView; error?: string };
    return res.ok ? data : { error: data.error ?? `Failed (${res.status})` };
}

/** Where a person goes to post this by hand, prefilled where the platform allows it. */
function openUrl(delivery: DeliveryView, subreddit: string | null): string | null {
    if (delivery.platform === 'reddit') {
        if (!subreddit) return null;
        const url = new URL(`https://www.reddit.com/r/${subreddit}/submit`);
        url.searchParams.set('type', 'TEXT');
        if (delivery.title) url.searchParams.set('title', delivery.title);
        if (delivery.body.length < 6000) url.searchParams.set('text', delivery.body);
        return url.toString();
    }
    if (delivery.platform === 'bluesky') return `https://bsky.app/intent/compose?text=${encodeURIComponent(manualPostText(delivery.platform, delivery.body, delivery.link))}`;
    return 'https://www.facebook.com/';
}

/**
 * One post waiting for a person: the copy to paste, the images to upload, a button that opens the
 * platform, and "Mark as posted" so the rest of the team sees it is done.
 */
export default function ReadyPostCard({ jobId, companyName, delivery, subreddit, formUrl = null, onChange }: { jobId: string; companyName?: string; delivery: DeliveryView; subreddit: string | null; formUrl?: string | null; onChange: (job: JobView) => void }) {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(delivery.title ?? '');
    const [body, setBody] = useState(delivery.body);
    const [marking, setMarking] = useState(false);
    const [postedUrl, setPostedUrl] = useState('');

    const run = async (label: string, payload: Record<string, unknown>) => {
        setBusy(label);
        setError(null);
        const res = await act(jobId, { deliveryId: delivery.id, ...payload });
        setBusy(null);
        if (res.error || !res.job) return setError(res.error ?? 'Failed');
        setEditing(false);
        setMarking(false);
        onChange(res.job);
        window.dispatchEvent(new Event('nucleas:jobs-changed'));
    };
    const copy = async (label: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(label);
            window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
        } catch {
            setCopied('failed');
        }
    };

    const isReddit = delivery.platform === 'reddit';
    const open = openUrl(delivery, subreddit);
    const canPostNow = !MANUAL_ONLY.includes(delivery.platform) && delivery.status === 'ready';
    const images = delivery.assets.filter((a) => a.kind === 'image');
    const video = delivery.assets.find((a) => a.kind === 'video');
    const fullText = isReddit ? delivery.body : manualPostText(delivery.platform, delivery.body, delivery.link);
    const limit = delivery.platform === 'admin' ? 0 : PLATFORM_RULES[delivery.platform].maxChars;
    const length = Array.from(delivery.platform === 'bluesky' ? manualPostText('bluesky', body, delivery.link) : body).length;
    const over = limit > 0 && length > limit;
    const cancelEdit = () => { setEditing(false); setTitle(delivery.title ?? ''); setBody(delivery.body); };
    const saveEdit = () => run('edit', { action: 'edit_post', body, ...(isReddit ? { title } : {}) });

    if (delivery.status === 'publishing') {
        return <div className="ui-card p-3 text-xs text-sky-400">{delivery.platform === 'admin' ? `Adding “${delivery.itemTitle}” to the admin…` : `Posting “${delivery.itemTitle}” to ${PLATFORM_LABEL[delivery.platform]}…`}</div>;
    }

    // An admin record: the values to enter, each copyable, and the form as Nucleas filled it.
    if (delivery.platform === 'admin') {
        return (
            <article className="ui-card space-y-2 p-3 text-sm">
                <header className="flex items-center gap-2">
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Admin</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{companyName ? `${companyName} · ` : ''}{delivery.itemTitle}</span>
                </header>
                {delivery.error ? <p className="rounded border border-amber-400/40 bg-amber-400/5 p-2 text-xs text-amber-300">{delivery.error}</p> : null}
                <dl className="divide-y divide-border rounded border border-border">
                    {(delivery.fields ?? []).map((f) => (
                        <div key={f.label} className="flex items-start gap-3 px-2 py-1.5">
                            <dt className="w-32 shrink-0 text-xs text-text-secondary">{f.label}</dt>
                            <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words">{f.value}</dd>
                            <button type="button" className="shrink-0 text-[11px] text-text-secondary hover:text-text-primary" onClick={() => void copy(f.label, f.value)}>{copied === f.label ? 'Copied' : 'Copy'}</button>
                        </div>
                    ))}
                </dl>
                {delivery.screenshot ? (
                    <details className="text-xs">
                        <summary className="cursor-pointer text-text-secondary">How Nucleas filled the form</summary>
                        {/* eslint-disable-next-line @next/next/no-img-element -- a screenshot taken by the browser worker */}
                        <img src={`data:image/jpeg;base64,${delivery.screenshot}`} alt="The admin form as Nucleas filled it" className="mt-2 max-h-[480px] w-full rounded border border-border object-contain object-top" />
                    </details>
                ) : null}
                {marking ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <input className="ui-control min-w-0 flex-1" value={postedUrl} onChange={(e) => setPostedUrl(e.target.value)} placeholder="Link to the record (optional)" aria-label="Link to the record" />
                        <button type="button" className="ui-button-primary" disabled={busy !== null} onClick={() => void run('posted', { action: 'mark_posted', postedUrl })}>{busy === 'posted' ? 'Saving…' : 'Done'}</button>
                        <button type="button" className="ui-button" onClick={() => setMarking(false)}>Cancel</button>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {formUrl ? <a href={formUrl} target="_blank" rel="noreferrer" className="ui-button">Open the form ↗</a> : null}
                        <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void run('now', { action: 'post_now' })}>{busy === 'now' ? 'Adding…' : 'Add it for me'}</button>
                        <button type="button" className="ui-button-primary" onClick={() => setMarking(true)}>Mark as added</button>
                        <span className="flex-1" />
                        <button type="button" className="text-[11px] text-text-secondary hover:text-text-primary" disabled={busy !== null} onClick={() => window.confirm('Skip this one? Nobody will be asked to add it.') && void run('skip', { action: 'skip_post' })}>Skip</button>
                    </div>
                )}
                {copied === 'failed' ? <p className="text-[11px] text-red-400">Could not copy. Select the text and copy it by hand.</p> : null}
                {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            </article>
        );
    }

    return (
        <article className="ui-card space-y-2 p-3 text-sm">
            <header className="flex items-center gap-2">
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">{PLATFORM_LABEL[delivery.platform]}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{companyName ? `${companyName} · ` : ''}{delivery.itemTitle}{isReddit && subreddit ? ` · r/${subreddit}` : ''}</span>
            </header>
            {delivery.error ? <p className="rounded border border-amber-400/40 bg-amber-400/5 p-2 text-xs text-amber-300">{delivery.error}</p> : null}

            {editing ? (
                <div className="space-y-2" onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) void saveEdit(); }}>
                    {isReddit ? <input autoFocus className="ui-control w-full font-semibold" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} aria-label="Title" /> : null}
                    <textarea autoFocus={!isReddit} className="ui-control h-36 w-full resize-y leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Post" />
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" className="ui-button-primary" disabled={busy !== null || !body.trim()} onClick={() => void saveEdit()}>{busy === 'edit' ? 'Saving…' : 'Save'}</button>
                        <button type="button" className="ui-button" onClick={cancelEdit}>Cancel</button>
                        <span className="flex-1" />
                        {limit ? <span className={`text-[11px] tabular-nums ${over ? 'text-red-400' : 'text-text-secondary'}`} aria-live="polite">{length} / {limit}{over ? ' · too long for this platform' : ''}</span> : null}
                    </div>
                </div>
            ) : (
                <div
                    className={`space-y-1 rounded ${marking ? '' : 'cursor-text hover:bg-background-elevated/50'}`}
                    title={marking ? undefined : 'Click to edit'}
                    onClick={(e) => { if (!marking && !(e.target instanceof HTMLAnchorElement)) setEditing(true); }}
                >
                    {delivery.title ? <p className="font-semibold leading-snug">{delivery.title}</p> : null}
                    <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">{delivery.body}</p>
                    {delivery.link && !isReddit ? <a href={delivery.link} target="_blank" rel="noreferrer" className="block truncate text-xs text-primary underline">{delivery.link}</a> : null}
                </div>
            )}

            {images.length || video ? (
                <div className="flex flex-wrap items-end gap-2">
                    {images.map((image) => (
                        <a key={image.url} href={`/api/os/jobs/${jobId}/asset?url=${encodeURIComponent(image.url)}`} className="group block" title="Download image">
                            {/* eslint-disable-next-line @next/next/no-img-element -- remote images from the company's own pages */}
                            <img src={image.url} alt="" className="h-16 w-24 rounded border border-border object-cover group-hover:opacity-80" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                            <span className="block text-center text-[10px] text-text-secondary">Download image</span>
                        </a>
                    ))}
                    {video ? <a href={video.url} target="_blank" rel="noreferrer" className="ui-button text-xs">Video ↗</a> : null}
                </div>
            ) : null}

            {marking ? (
                <div className="flex flex-wrap items-center gap-2">
                    <input className="ui-control min-w-0 flex-1" value={postedUrl} onChange={(e) => setPostedUrl(e.target.value)} placeholder="Link to the live post (optional)" aria-label="Link to the live post" />
                    <button type="button" className="ui-button-primary" disabled={busy !== null} onClick={() => void run('posted', { action: 'mark_posted', postedUrl })}>{busy === 'posted' ? 'Saving…' : 'Done'}</button>
                    <button type="button" className="ui-button" onClick={() => setMarking(false)}>Cancel</button>
                </div>
            ) : !editing ? (
                <div className="flex flex-wrap gap-1.5">
                    {isReddit && delivery.title ? <button type="button" className="ui-button" onClick={() => void copy('title', delivery.title!)}>{copied === 'title' ? 'Copied' : 'Copy title'}</button> : null}
                    <button type="button" className="ui-button" onClick={() => void copy('body', fullText)}>{copied === 'body' ? 'Copied' : isReddit ? 'Copy body' : 'Copy post'}</button>
                    {open ? <a href={open} target="_blank" rel="noreferrer" className="ui-button">{isReddit ? `Open r/${subreddit}` : `Open ${PLATFORM_LABEL[delivery.platform]}`} ↗</a> : null}
                    {canPostNow ? <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void run('now', { action: 'post_now' })}>{busy === 'now' ? 'Posting…' : 'Post it for me'}</button> : null}
                    <button type="button" className="ui-button-primary" onClick={() => setMarking(true)}>Mark as posted</button>
                    <span className="flex-1" />
                    <button type="button" className="ui-button" onClick={() => setEditing(true)}>Edit</button>
                    <button type="button" className="text-[11px] text-text-secondary hover:text-text-primary" disabled={busy !== null} onClick={() => window.confirm('Skip this post? Nobody will be asked to post it.') && void run('skip', { action: 'skip_post' })}>Skip</button>
                </div>
            ) : null}
            {isReddit && !subreddit ? <p className="text-[11px] text-text-secondary">No subreddit is set for this company. Add it in the Company window.</p> : null}
            {copied === 'failed' ? <p className="text-[11px] text-red-400">Could not copy. Select the text and copy it by hand.</p> : null}
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
        </article>
    );
}
