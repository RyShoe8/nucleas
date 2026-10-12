'use client';

import { useEffect, useRef, useState } from 'react';
import type { ArticleView } from '@/lib/articles/types-client';

/** One article: progress while it is written, then the text to edit, copy and check. */
export default function ArticleEditor({ id, onBack }: { id: string; onBack: () => void }) {
    const [article, setArticle] = useState<ArticleView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reload, setReload] = useState(0);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [meta, setMeta] = useState('');
    const [saved, setSavedState] = useState(true);
    // Mirrors `saved` for the fetch callback, so a poll never overwrites typing in progress.
    const savedRef = useRef(true);
    const setSaved = (value: boolean) => {
        savedRef.current = value;
        setSavedState(value);
    };
    const [copied, setCopied] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const res = await fetch(`/api/os/content/articles/${id}`, { cache: 'no-store' });
            const data = (await res.json().catch(() => ({}))) as { article?: ArticleView; error?: string };
            if (cancelled) return;
            if (!res.ok || !data.article) return setError(data.error ?? `Failed (${res.status})`);
            setError(null);
            setArticle(data.article);
            if (savedRef.current && data.article.status === 'done') {
                setTitle(data.article.title);
                setBody(data.article.body);
                setMeta(data.article.metaDescription);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [id, reload]);

    const active = article?.status === 'queued' || article?.status === 'running';
    useEffect(() => {
        if (!active) return;
        const timer = window.setInterval(() => setReload((n) => n + 1), 3000);
        return () => window.clearInterval(timer);
    }, [active]);

    const post = async (action: 'continue' | 'restart') => {
        const res = await fetch(`/api/os/content/articles/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(res.ok ? null : data.error ?? `Failed (${res.status})`);
        setSaved(true);
        setReload((n) => n + 1);
    };

    const save = async () => {
        const res = await fetch(`/api/os/content/articles/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, body, metaDescription: meta }) });
        const data = (await res.json().catch(() => ({}))) as { article?: ArticleView; error?: string };
        if (!res.ok || !data.article) return setError(data.error ?? `Failed (${res.status})`);
        setError(null);
        setSaved(true);
        setArticle(data.article);
    };

    const copy = async (label: string, text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(label);
            window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
        } catch {
            setError('Copy failed. Select the text and copy it by hand.');
        }
    };

    const remove = async () => {
        if (!window.confirm('Delete this article?')) return;
        await fetch(`/api/os/content/articles/${id}`, { method: 'DELETE' });
        onBack();
    };

    if (!article) return <p className="p-4 text-sm text-text-secondary">{error ?? 'Loading…'}</p>;
    const field = 'ui-control w-full';
    return (
        <div className="space-y-3 p-3">
            <div className="flex items-center gap-2">
                <button type="button" className="ui-button" onClick={onBack}>Back</button>
                <h3 className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-semibold">{article.title || article.topic}</h3>
            </div>
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}

            {active ? (
                <div className="ui-card space-y-1 p-4" role="status">
                    <p className="text-sm">{article.progress || 'Working'}…</p>
                    <p className="text-[11px] text-text-secondary">Researching, outlining, writing, then checking the draft against the company’s Voice. You can close this window; it keeps going.</p>
                    {article.status === 'queued' ? <button type="button" className="ui-button" onClick={() => void post('continue')}>Continue now</button> : null}
                </div>
            ) : null}

            {article.status === 'failed' ? (
                <div className="ui-card space-y-2 p-4">
                    <p role="alert" className="text-sm text-red-300">{article.error ?? 'The run stopped.'}</p>
                    <div className="flex gap-2">
                        <button type="button" className="ui-button-primary" onClick={() => void post('continue')}>Try again from where it stopped</button>
                        <button type="button" className="ui-button" onClick={() => void post('restart')}>Start over</button>
                    </div>
                </div>
            ) : null}

            {article.status === 'done' ? (
                <>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                        {article.fidelityMeasured && article.fidelity !== null ? <span className={`rounded px-2 py-0.5 ${article.fidelity >= 72 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>Voice match {article.fidelity}/100</span> : <span className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-300">Voice match not measured</span>}
                        {article.genericity !== null ? <span className={`rounded px-2 py-0.5 ${article.genericity <= 25 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>Machine-sounding {article.genericity}/100 (lower is better)</span> : null}
                        {article.researchNote ? <span className="rounded bg-white/5 px-2 py-0.5 text-text-secondary">{article.researchNote}</span> : null}
                    </div>
                    {article.warnings.length ? (
                        <ul className="space-y-1 text-xs text-amber-300">
                            {article.warnings.map((w) => (
                                <li key={w} className="break-words">• {w}</li>
                            ))}
                        </ul>
                    ) : null}
                    <label className="block space-y-1"><span className="ui-kicker">Title</span><input className={field} value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} maxLength={300} /></label>
                    <label className="block space-y-1"><span className="ui-kicker">Article (markdown)</span><textarea className={`${field} h-[55vh] min-h-64 resize-y font-mono text-xs leading-relaxed`} value={body} onChange={(e) => { setBody(e.target.value); setSaved(false); }} /></label>
                    <label className="block space-y-1"><span className="ui-kicker">Meta description</span><input className={field} value={meta} onChange={(e) => { setMeta(e.target.value); setSaved(false); }} maxLength={400} /><span className="block text-[11px] text-text-secondary">{meta.length} characters</span></label>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className="ui-button-primary" disabled={saved} onClick={() => void save()}>{saved ? 'Saved' : 'Save changes'}</button>
                        <button type="button" className="ui-button" onClick={() => void copy('article', body)}>{copied === 'article' ? 'Copied' : 'Copy article'}</button>
                        <button type="button" className="ui-button" onClick={() => void copy('meta', meta)}>{copied === 'meta' ? 'Copied' : 'Copy meta description'}</button>
                        <button type="button" className="ui-button" onClick={() => window.confirm('Write this again from scratch? Your edits will be replaced.') && void post('restart')}>Write again</button>
                        <button type="button" className="ui-button text-red-300" onClick={() => void remove()}>Delete</button>
                    </div>
                    {article.sources.length ? (
                        <details className="text-xs">
                            <summary className="cursor-pointer text-text-secondary">Sources used ({article.sources.length})</summary>
                            <ul className="mt-2 space-y-1">
                                {article.sources.map((s) => (
                                    <li key={s}><a className="touch-link break-all" href={s} target="_blank" rel="noreferrer noopener">{s}</a></li>
                                ))}
                            </ul>
                        </details>
                    ) : null}
                    {article.modelPath.length ? <p className="text-[11px] text-text-secondary">Models used: {article.modelPath.join(' → ')}</p> : null}
                </>
            ) : null}
        </div>
    );
}
