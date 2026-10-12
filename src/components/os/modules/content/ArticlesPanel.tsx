'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ArticleView } from '@/lib/articles/types-client';
import { useOsCompanies } from '../CompaniesModule';
import ArticleEditor from './ArticleEditor';

const LENGTHS = [
    { id: 'short', label: 'Short', hint: '~600 words' },
    { id: 'standard', label: 'Standard', hint: '~1,000 words' },
    { id: 'long', label: 'Long', hint: '~1,800 words' },
] as const;

const lines = (value: string) => value.split('\n').map((v) => v.trim()).filter(Boolean);

const STATUS_LABEL: Record<ArticleView['status'], string> = { queued: 'Waiting', running: 'Writing', done: 'Ready', failed: 'Stopped' };

/** Articles: pick a company, say what to write about, and get a draft in that company's Voice. */
export default function ArticlesPanel() {
    const { companies } = useOsCompanies();
    const [articles, setArticles] = useState<ArticleView[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const [reload, setReload] = useState(0);
    const refresh = useCallback(() => setReload((n) => n + 1), []);

    const working = (articles ?? []).some((a) => a.status === 'queued' || a.status === 'running');
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch('/api/os/content/articles', { cache: 'no-store' });
            const body = (await res.json().catch(() => ({}))) as { articles?: ArticleView[]; error?: string };
            if (cancelled) return;
            if (!res.ok) return setError(body.error ?? `Failed (${res.status})`);
            setError(null);
            setArticles(body.articles ?? []);
        })();
        return () => {
            cancelled = true;
        };
    }, [reload]);

    useEffect(() => {
        if (!working) return;
        const timer = window.setInterval(refresh, 4000);
        return () => window.clearInterval(timer);
    }, [working, refresh]);

    if (error && !articles) return <p className="p-4 text-sm text-red-400">{error}</p>;
    if (!articles) return <p className="p-4 text-sm text-text-secondary">Loading…</p>;
    if (openId) return <ArticleEditor id={openId} onBack={() => { setOpenId(null); refresh(); }} />;

    const nameOf = (id: string) => (companies ?? []).find((c) => c.id === id)?.name ?? '';
    return (
        <div className="space-y-3 p-3">
            <div className="flex items-center gap-2">
                <h3 className="ui-kicker flex-1">Articles</h3>
                {!creating ? <button type="button" className="ui-button-primary" onClick={() => setCreating(true)}>New article</button> : null}
            </div>
            {creating ? <NewArticle onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} /> : null}
            {articles.length === 0 && !creating ? <p className="text-sm text-text-secondary">No articles yet. Nucleas researches the topic, writes it in the company’s approved Voice, and checks that it sounds like them.</p> : null}
            <ul className="space-y-2">
                {articles.map((a) => (
                    <li key={a.id}>
                        <button type="button" className="ui-card block w-full p-3 text-left" onClick={() => setOpenId(a.id)}>
                            <span className="line-clamp-2 break-words text-sm font-medium">{a.title || a.topic}</span>
                            <span className="mt-0.5 block break-words text-[11px] text-text-secondary">{nameOf(a.companyId)} · {STATUS_LABEL[a.status]}{a.status === 'done' && a.fidelityMeasured && a.fidelity !== null ? ` · voice match ${a.fidelity}/100` : ''}{a.status === 'queued' || a.status === 'running' ? ` · ${a.progress}` : ''}{a.status === 'failed' && a.error ? ` · ${a.error}` : ''}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function NewArticle({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
    const { companies } = useOsCompanies();
    const [companyId, setCompanyId] = useState('');
    const [topic, setTopic] = useState('');
    const [length, setLength] = useState<(typeof LENGTHS)[number]['id']>('standard');
    const [notes, setNotes] = useState('');
    const [faq, setFaq] = useState(false);
    const [refs, setRefs] = useState('');
    const [links, setLinks] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const chosen = companyId || (companies ?? [])[0]?.id || '';

    const start = async () => {
        setBusy(true);
        setError(null);
        // "url" or "url | anchor text", one per line.
        const linkList = lines(links).map((l) => {
            const [url, anchor] = l.split('|').map((p) => p.trim());
            return anchor ? { url, anchor } : { url };
        });
        const res = await fetch('/api/os/content/articles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId: chosen, topic, notes, length, faq, referenceUrls: lines(refs), links: linkList }) });
        const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        setBusy(false);
        if (!res.ok || !body.id) return setError(body.error ?? `Failed (${res.status})`);
        onCreated(body.id);
    };

    const field = 'ui-control w-full';
    return (
        <div className="ui-card space-y-3 p-4">
            <label className="block space-y-1">
                <span className="ui-kicker">Company</span>
                <select className={field} value={chosen} onChange={(e) => setCompanyId(e.target.value)}>
                    {(companies ?? []).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
            </label>
            <label className="block space-y-1">
                <span className="ui-kicker">What should it be about?</span>
                <input className={field} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} placeholder="e.g. How sweepstakes casino bonuses actually work" />
            </label>
            <div className="space-y-1">
                <span className="ui-kicker">Length</span>
                <div className="flex gap-1">
                    {LENGTHS.map((l) => (
                        <button key={l.id} type="button" title={l.hint} className={length === l.id ? 'ui-button-primary' : 'ui-button'} onClick={() => setLength(l.id)}>{l.label}</button>
                    ))}
                </div>
            </div>
            <details className="space-y-3 text-sm">
                <summary className="cursor-pointer text-xs text-text-secondary">More options</summary>
                <div className="mt-3 space-y-3">
                    <label className="block space-y-1"><span className="ui-kicker">Direction (angle, audience, points to cover)</span><textarea className={`${field} h-20 resize-y`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={3000} /></label>
                    <label className="block space-y-1"><span className="ui-kicker">Pages to use as sources (one per line)</span><textarea className={`${field} h-16 resize-y`} value={refs} onChange={(e) => setRefs(e.target.value)} placeholder="https://…" /></label>
                    <label className="block space-y-1"><span className="ui-kicker">Links to work in (one per line, optional “| anchor text”)</span><textarea className={`${field} h-16 resize-y`} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://example.com/page | the full terms" /></label>
                    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={faq} onChange={(e) => setFaq(e.target.checked)} />Finish with an FAQ</label>
                </div>
            </details>
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            <div className="flex gap-2">
                <button type="button" className="ui-button-primary" disabled={busy || !chosen || topic.trim().length < 3} onClick={() => void start()}>{busy ? 'Starting…' : 'Write it'}</button>
                <button type="button" className="ui-button" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}
