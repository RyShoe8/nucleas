'use client';

import { useEffect, useState } from 'react';
import type { ItemView, PostView, WatchView } from '@/lib/watches/types-client';
import { formatDealLine } from '@/lib/watches/dealFormat';
import type { DealMetrics } from '@/lib/watches/types';
import { getSocialPlatform, type SocialPlatformId } from '@/lib/watches/socialPlatforms';
import { valueLines } from '@/lib/watches/settings';

type Filter = 'flagged' | 'scored' | 'all';
type Detail = { text: string; html: string };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
    const res = await fetch(url, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `Failed (${res.status})`, status: res.status };
}

function ScorePill({ item, watch }: { item: ItemView; watch: WatchView }) {
    if (item.skipReason) return <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-secondary">skipped</span>;
    const tone = item.flagged ? 'border-emerald-400/50 text-emerald-300' : 'border-border text-text-secondary';
    const discount = watch.rank === 'discount';
    return <span className={`rounded border px-1.5 py-0.5 text-[10px] tabular-nums ${tone}`} title={discount ? `Flagged at offers of ${watch.minDiscountPct}% or more` : `Flagged at a fit of ${watch.threshold} or more`}>{item.flagged ? 'flagged · ' : ''}{item.score}{discount ? '%' : ''}</span>;
}

function PostCard({ post, onChange }: { post: PostView; onChange: (p: PostView | null) => void }) {
    const [editing, setEditing] = useState<SocialPlatformId | null>(null);
    const [draft, setDraft] = useState('');
    const [copied, setCopied] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const entries = Object.entries(post.copyByPlatform) as [SocialPlatformId, string][];
    const copy = async (platform: string, text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(platform);
            window.setTimeout(() => setCopied((c) => (c === platform ? null : c)), 1500);
        } catch {
            setError('Could not copy. Select the text and copy it by hand.');
        }
    };
    const save = async (platform: SocialPlatformId) => {
        const res = await api<{ post: PostView }>(`/api/os/content/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ platform, copy: draft }) });
        if (!res.ok) return setError(res.error);
        setError(null);
        setEditing(null);
        onChange(res.data.post);
    };
    const archive = async () => {
        const res = await api<{ post: PostView }>(`/api/os/content/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
        if (res.ok) onChange(null);
        else setError(res.error);
    };
    return (
        <li className="ui-card space-y-2 p-3">
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 break-words text-sm font-medium">{post.title}</p>
                    {post.dealSummary ? <p className="text-[11px] text-text-secondary">{post.dealSummary}</p> : null}
                </div>
                <button type="button" className="touch-link text-[11px] text-text-secondary" onClick={() => void archive()}>Archive</button>
            </div>
            {entries.map(([platform, text]) => (
                <div key={platform} className="space-y-1">
                    <div className="flex items-center gap-2 text-[11px] text-text-secondary">
                        <span className="font-medium text-text-primary">{getSocialPlatform(platform).label}</span>
                        <span>{text.length} / {getSocialPlatform(platform).maxChars}</span>
                        <span className="flex-1" />
                        <button type="button" className="touch-link" onClick={() => (editing === platform ? setEditing(null) : (setEditing(platform), setDraft(text)))}>{editing === platform ? 'Cancel' : 'Edit'}</button>
                        <button type="button" className="ui-button px-2 py-0.5" onClick={() => void copy(platform, text)}>{copied === platform ? 'Copied' : 'Copy'}</button>
                    </div>
                    {editing === platform ? (
                        <div className="space-y-1">
                            <textarea className="ui-control h-24 w-full resize-y" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={5000} aria-label={`${getSocialPlatform(platform).label} copy`} />
                            <button type="button" className="ui-button-primary" onClick={() => void save(platform)}>Save</button>
                        </div>
                    ) : (
                        <p className="whitespace-pre-wrap rounded bg-background-elevated/50 p-2 text-sm leading-relaxed">{text}</p>
                    )}
                </div>
            ))}
            {post.link ? <a href={post.link} target="_blank" rel="noopener noreferrer" className="touch-link block break-all text-[11px] text-primary">{post.link}</a> : null}
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
        </li>
    );
}

/** One watch: its flagged emails, any email in full, and the social post drafts. */
export default function WatchFeed({ watch, onScanned }: { watch: WatchView; onScanned: () => void }) {
    const [tab, setTab] = useState<'emails' | 'posts'>('emails');
    const [filter, setFilter] = useState<Filter>('flagged');
    const [items, setItems] = useState<ItemView[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [scanning, setScanning] = useState(false);
    const [open, setOpen] = useState<string | null>(null);
    const [detail, setDetail] = useState<Detail | null>(null);
    const [original, setOriginal] = useState(false);
    const [posts, setPosts] = useState<PostView[]>([]);
    const [drafting, setDrafting] = useState<string | null>(null);
    const [digesting, setDigesting] = useState(false);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            setLoading(true);
            const res = await api<{ items: ItemView[]; hasMore: boolean }>(`/api/os/content/watches/${watch.id}/items?filter=${filter}`);
            if (cancelled) return;
            setLoading(false);
            if (!res.ok) return setError(res.error);
            setError(null);
            setItems(res.data.items);
            setHasMore(res.data.hasMore);
        })();
        return () => {
            cancelled = true;
        };
    }, [watch.id, filter, reload]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await api<{ posts: PostView[] }>(`/api/os/content/watches/${watch.id}/posts`);
            if (!cancelled && res.ok) setPosts(res.data.posts);
        })();
        return () => {
            cancelled = true;
        };
    }, [watch.id, reload]);

    const more = async () => {
        const last = items.at(-1);
        if (!last?.sentAt) return;
        const res = await api<{ items: ItemView[]; hasMore: boolean }>(`/api/os/content/watches/${watch.id}/items?filter=${filter}&before=${encodeURIComponent(last.sentAt)}`);
        if (!res.ok) return setError(res.error);
        setItems((list) => [...list, ...res.data.items]);
        setHasMore(res.data.hasMore);
    };

    const scan = async () => {
        setScanning(true);
        setError(null);
        setNotice(null);
        const res = await api<{ stats: { fresh: number; scored: number; flagged: number; partial: boolean } }>(`/api/os/content/watches/${watch.id}/scan`, { method: 'POST' });
        setScanning(false);
        if (!res.ok) return setError(res.status === 409 ? `${res.error} Use Connect mailbox above to sign in again.` : res.error);
        const s = res.data.stats;
        setNotice(s.fresh === 0 ? 'No new emails.' : `Checked ${s.fresh} new email${s.fresh === 1 ? '' : 's'}: ${s.flagged} flagged${s.partial ? '. More remain; scan again to continue.' : '.'}`);
        setReload((n) => n + 1);
        onScanned();
    };

    const openItem = async (id: string) => {
        if (open === id) return setOpen(null);
        setOpen(id);
        setDetail(null);
        setOriginal(false);
        const res = await api<Detail>(`/api/os/content/items/${id}`);
        if (res.ok) setDetail(res.data);
        else setError(res.error);
    };

    const draft = async (id: string) => {
        setDrafting(id);
        setError(null);
        const res = await api<{ posts: PostView[]; created: number }>(`/api/os/content/items/${id}/posts`, { method: 'POST' });
        setDrafting(null);
        if (!res.ok) return setError(res.error);
        setNotice(res.data.posts.length ? `${res.data.created ? 'Drafted' : 'Already drafted'}: see Post drafts.` : 'No deal at or above the threshold to post about.');
        setReload((n) => n + 1);
        if (res.data.posts.length) setTab('posts');
    };

    const digest = async () => {
        setDigesting(true);
        setError(null);
        setNotice(null);
        const res = await api<{ articleId: string; items: number }>(`/api/os/content/watches/${watch.id}/digest`, { method: 'POST' });
        setDigesting(false);
        if (!res.ok) return setError(res.error);
        setNotice(`Writing a digest of ${res.data.items} item${res.data.items === 1 ? '' : 's'}. It will appear in Content → Articles in a few minutes.`);
        onScanned();
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1">
                    <button type="button" className={tab === 'emails' ? 'ui-button-primary' : 'ui-button'} onClick={() => setTab('emails')}>Emails</button>
                    <button type="button" className={tab === 'posts' ? 'ui-button-primary' : 'ui-button'} onClick={() => setTab('posts')}>Post drafts{posts.length ? ` · ${posts.length}` : ''}</button>
                </div>
                {tab === 'emails' ? (
                    <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="ui-control" aria-label="Show">
                        <option value="flagged">Flagged</option>
                        <option value="scored">All scored</option>
                        <option value="all">Everything, including skipped</option>
                    </select>
                ) : null}
                <span className="flex-1" />
                {watch.companyId ? <button type="button" className="ui-button" disabled={digesting} onClick={() => void digest()} title={watch.digest.lastRunAt ? `Covers what was flagged since ${when(watch.digest.lastRunAt)}` : 'Covers what was flagged in the last period'}>{digesting ? 'Starting…' : 'Write digest now'}</button> : null}
                <button type="button" className="ui-button-primary" disabled={scanning || watch.scanning} onClick={() => void scan()}>{scanning || watch.scanning ? 'Scanning…' : 'Scan now'}</button>
            </div>
            {notice ? <p role="status" className="text-xs text-emerald-400">{notice}</p> : null}
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            {watch.lastScanError ? <p className="text-xs text-amber-400">Last scan failed: {watch.lastScanError}</p> : null}
            {watch.digest.lastError ? <p className="text-xs text-amber-400">Last digest: {watch.digest.lastError}</p> : null}

            {tab === 'posts' ? (
                posts.length ? (
                    <ul className="space-y-2">{posts.map((p) => <PostCard key={p.id} post={p} onChange={(next) => setPosts((list) => (next ? list.map((x) => (x.id === next.id ? next : x)) : list.filter((x) => x.id !== p.id)))} />)}</ul>
                ) : (
                    <p className="text-sm text-text-secondary">{watch.companyId ? 'No post drafts yet. Use “Draft posts” on a flagged email.' : 'Link this watch to a company (Change watch) to draft posts in its Voice.'}</p>
                )
            ) : loading ? (
                <p className="text-sm text-text-secondary">Loading…</p>
            ) : items.length === 0 ? (
                <p className="text-sm text-text-secondary">{filter === 'flagged' ? 'Nothing flagged yet. Scan now, or lower the threshold.' : 'No emails yet. Scan now.'}</p>
            ) : (
                <ul className="space-y-2">
                    {items.map((item) => {
                        const deal = item.bestDeal ? formatDealLine(item.bestDeal as unknown as DealMetrics) : null;
                        return (
                            <li key={item.id} className="ui-card p-3">
                                <div className="flex items-start gap-2">
                                    <div className="min-w-0 flex-1">
                                        <button type="button" onClick={() => void openItem(item.id)} className="block w-full break-words py-1 text-left text-sm font-medium hover:underline">{item.subject || '(no subject)'}</button>
                                        <p className="break-words text-[11px] text-text-secondary">{item.fromName || item.fromEmail} · {when(item.sentAt)}</p>
                                    </div>
                                    <ScorePill item={item} watch={watch} />
                                </div>
                                {item.skipReason ? <p className="mt-1 text-[11px] text-text-secondary">Skipped: {item.skipReason.replace(/_/g, ' ').replace(/:\d+$/, '')}</p> : null}
                                {item.reason ? <p className="mt-1 text-xs italic text-text-secondary">{item.reason}</p> : null}
                                {deal ? <p className="mt-1 text-xs font-medium">{deal}</p> : null}
                                {Object.keys(item.values).length ? (
                                    <ul className="mt-1 grid gap-x-3 text-xs sm:grid-cols-2">
                                        {valueLines(item.values, watch.fields).map((line) => <li key={line} className="break-words">{line}</li>)}
                                    </ul>
                                ) : null}
                                {item.summary ? <p className="mt-1 text-sm leading-relaxed">{item.summary}</p> : null}
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                                    {item.link ? <a href={item.link} target="_blank" rel="noopener noreferrer" className="touch-link text-primary">Open link</a> : null}
                                    {item.flagged && watch.companyId ? <button type="button" className="ui-button px-2 py-0.5" disabled={drafting === item.id} onClick={() => void draft(item.id)}>{drafting === item.id ? 'Drafting…' : item.hasPost ? 'Posts drafted' : 'Draft posts'}</button> : null}
                                </div>
                                {open === item.id ? (
                                    <div className="mt-3 space-y-2 border-t border-border pt-3">
                                        {item.keyPoints.length ? (
                                            <ul className="space-y-0.5 text-xs">
                                                {item.keyPoints.map((p, i) => <li key={i}><span className="mr-1 text-text-secondary">{p.category}</span>{p.text}</li>)}
                                            </ul>
                                        ) : null}
                                        {!detail ? <p className="text-xs text-text-secondary">Loading…</p> : (
                                            <>
                                                <button type="button" className="touch-link text-[11px]" onClick={() => setOriginal((v) => !v)}>{original ? 'Show text' : 'Show original email'}</button>
                                                {original && detail.html ? (
                                                    <iframe title="Original email" sandbox="" srcDoc={detail.html} className="h-80 w-full rounded border border-border bg-white" />
                                                ) : (
                                                    <p className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-background-elevated/50 p-2 text-xs leading-relaxed">{detail.text || 'No text.'}</p>
                                                )}
                                            </>
                                        )}
                                    </div>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            )}
            {tab === 'emails' && hasMore ? <button type="button" className="ui-button" onClick={() => void more()}>Show older</button> : null}
        </div>
    );
}
