'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CompanyFactsView, Competitor, FactKey, FactValues } from '@/lib/companies/companyFacts';

const PARTS: { key: FactKey; title: string; hint: string; empty: string }[] = [
    { key: 'description', title: 'What it does', hint: 'The product or service, in plain words.', empty: 'Not described yet.' },
    { key: 'audience', title: 'Who it is for', hint: 'The people it serves and what they want from it.', empty: 'No audience described yet.' },
    { key: 'keywords', title: 'Topics it should be found for', hint: 'One per line. Search and content work aim at these.', empty: 'No topics yet.' },
    { key: 'competitors', title: 'Competitors', hint: 'One per line: Name, website, and optionally why they matter. Example: Wisestamp, wisestamp.com, largest free generator', empty: 'No competitors listed yet.' },
    { key: 'keyFacts', title: 'Key facts', hint: 'What the website does not say: pricing, what is off limits, what is coming. The team treats these as true.', empty: 'Nothing added. Add what the team should always know.' },
];

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/** Text a person edits for one part, and back again. */
export function toDraft(key: FactKey, values: FactValues): string {
    if (key === 'keywords') return values.keywords.join('\n');
    if (key === 'competitors') return values.competitors.map((c) => [c.name, c.domain, c.note].filter(Boolean).join(', ')).join('\n');
    return values[key];
}
export function fromDraft(key: FactKey, draft: string): FactValues[FactKey] {
    const lines = draft.split('\n').map((line) => line.trim()).filter(Boolean);
    if (key === 'keywords') return [...new Set(lines.map((line) => line.replace(/^[-*•]\s*/, '').slice(0, 80)))].slice(0, 30);
    if (key === 'competitors') return lines.slice(0, 12).map((line): Competitor => {
        const [name, second, ...rest] = line.split(',').map((part) => part.trim());
        const isDomain = Boolean(second && /^[\w-]+(\.[\w-]+)+/.test(second.replace(/^https?:\/\//, '')));
        const domain = isDomain ? second!.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : undefined;
        const note = [isDomain ? null : second, ...rest].filter(Boolean).join(', ');
        return { name: name.slice(0, 120), ...(domain ? { domain } : {}), ...(note ? { note: note.slice(0, 400) } : {}) };
    }).filter((c) => c.name);
    return draft.trim();
}

function Shown({ part, values }: { part: (typeof PARTS)[number]; values: FactValues }) {
    if (part.key === 'keywords') return values.keywords.length ? <ul className="flex flex-wrap gap-1.5">{values.keywords.map((k) => <li key={k} className="rounded-full border border-border px-2.5 py-1 text-xs">{k}</li>)}</ul> : <p className="text-sm text-text-secondary">{part.empty}</p>;
    if (part.key === 'competitors') return values.competitors.length ? <ul className="grid gap-2 sm:grid-cols-2">{values.competitors.map((c) => <li key={`${c.name}-${c.domain ?? ''}`} className="rounded-lg border border-border p-2.5">
        <p className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium">{c.name}</span>{c.domain ? <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-primary hover:underline">{c.domain}</a> : null}</p>
        {c.note ? <p className="mt-1 text-xs text-text-secondary">{c.note}</p> : null}
    </li>)}</ul> : <p className="text-sm text-text-secondary">{part.empty}</p>;
    const text = values[part.key];
    return text ? <p className="whitespace-pre-wrap text-sm leading-6">{text}</p> : <p className="text-sm text-text-secondary">{part.empty}</p>;
}

export default function CompanyAbout({ companyId, companyName, basics, overviewAction }: { companyId: string; companyName: string; basics?: ReactNode; overviewAction?: ReactNode }) {
    const [view, setView] = useState<CompanyFactsView | null>(null);
    const [error, setError] = useState('');
    const [editing, setEditing] = useState<FactKey | null>(null);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async (signal?: AbortSignal) => {
        try {
            const res = await fetch(`/api/os/companies/${companyId}/facts`, { signal, cache: 'no-store' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error ?? `Could not load company information (${res.status}).`);
            if (!signal?.aborted) { setView(body as CompanyFactsView); setError(''); }
        } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Could not load company information.'); }
    }, [companyId]);
    useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

    const save = async (key: FactKey, value: FactValues[FactKey] | null) => {
        setBusy(true); setError('');
        try {
            const res = await fetch(`/api/os/companies/${companyId}/facts`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error ?? `Could not save (${res.status}).`);
            setView(body as CompanyFactsView); setEditing(null);
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
        finally { setBusy(false); }
    };

    if (!view) return <p className="text-sm text-text-secondary">{error || 'Loading company information…'}</p>;
    const o = view.overview;
    const analysing = o && ['queued', 'dispatching', 'crawling'].includes(o.status);

    return <section className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="text-lg font-semibold">About {companyName}</h3><p className="text-sm text-text-secondary">What your team and Ask work from. The Company Overview drafts it from the live site; correct anything and your version stands.</p></div>
        </header>
        {error ? <p role="alert" className="text-sm text-amber-300">{error}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div className="min-w-0 text-sm">
                <p className="font-medium">Company Overview</p>
                <p className="text-xs text-text-secondary">{!o ? 'Not run yet. It reads the live site and drafts everything below.'
                    : analysing ? `Reading ${o.rootUrl} now. This page fills in when it finishes.`
                    : o.status === 'failed' ? 'The last attempt failed. Run it again to refresh what is below.'
                    : `${o.rootUrl} · ${o.pageCount.toLocaleString()} pages read · ${o.issueCount.toLocaleString()} thing${o.issueCount === 1 ? '' : 's'} to fix · analysed ${day(o.completedAt)}`}</p>
            </div>
            {overviewAction}
        </div>

        {PARTS.map((part) => {
            const source = view.sources[part.key];
            const fromOverview = view.overviewValues[part.key];
            const isEditing = editing === part.key;
            return <article key={part.key} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="font-semibold">{part.title}</h4>
                    <p className="text-[11px] text-text-secondary">
                        {source.source === 'you' ? `Set by your team · ${day(source.at)}` : source.source === 'overview' ? `From the Company Overview · ${day(source.at)}` : source.source === 'profile' ? 'From the company profile' : 'Not set'}
                        {view.canManage && !isEditing ? <button type="button" className="ml-3 underline text-primary" onClick={() => { setDraft(toDraft(part.key, view.values)); setEditing(part.key); }}>{source.source === 'none' ? 'Add' : 'Edit'}</button> : null}
                    </p>
                </div>
                {isEditing ? <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); void save(part.key, fromDraft(part.key, draft)); }}>
                    <label className="block text-xs text-text-secondary">{part.hint}
                        <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={part.key === 'description' || part.key === 'audience' ? 5 : 7} maxLength={part.key === 'keyFacts' ? 4000 : 2400} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm text-text-primary" /></label>
                    <div className="flex flex-wrap items-center gap-2">
                        <button className="ui-button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                        <button type="button" className="ui-button" onClick={() => setEditing(null)}>Cancel</button>
                        {source.source === 'you' && fromOverview !== undefined ? <button type="button" className="text-xs underline text-text-secondary" disabled={busy} onClick={() => void save(part.key, null)}>Use the Company Overview&rsquo;s version instead</button> : null}
                    </div>
                </form> : <div className="mt-2"><Shown part={part} values={view.values} /></div>}
                {!isEditing && source.source === 'you' && fromOverview !== undefined ? <details className="mt-2 text-xs text-text-secondary"><summary className="cursor-pointer">What the Company Overview says</summary><div className="mt-2 opacity-80"><Shown part={part} values={{ ...view.values, [part.key]: fromOverview } as FactValues} /></div></details> : null}
            </article>;
        })}

        {basics ? <article className="rounded-xl border border-border p-4"><h4 className="font-semibold">Basics</h4><div className="mt-2 space-y-2 text-sm">{basics}</div></article> : null}
    </section>;
}
