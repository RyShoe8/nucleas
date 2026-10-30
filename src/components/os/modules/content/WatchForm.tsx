'use client';

import { useState } from 'react';
import type { MailboxView, WatchView } from '@/lib/watches/types-client';
import { FIELD_KINDS, MAX_FIELDS, RANK_LABELS, WATCH_RANKS, type FieldKind, type WatchField, type WatchRank } from '@/lib/watches/settings';
import { useOsCompanies } from '../CompaniesModule';

const split = (value: string) => value.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
const join = (values: string[]) => values.join(', ');

const KIND_LABELS: Record<FieldKind, string> = { text: 'Text', number: 'Number', money: 'Price or amount', date: 'Date', url: 'Link' };

type Design = { name: string; description: string; noun: string; fields: WatchField[]; rank: WatchRank; threshold: number; minDiscountPct: number; dealUnitTokens: string[]; keywords: string[]; designed: boolean };
type FieldRow = { label: string; kind: FieldKind };

/**
 * Add or change a watch. A new watch starts from one sentence: Nucleas proposes what counts, the fields to
 * collect and how to rank them (steered by the company's overview and marketing plan), and the person edits
 * that before saving. Mailbox filters and timing are under "More options".
 */
export default function WatchForm({ watch, mailboxes, onSaved, onCancel, initialCompanyId, initialBrief }: { watch?: WatchView; mailboxes: MailboxView[]; onSaved: (w: WatchView) => void; onCancel: () => void; initialCompanyId?: string; /** A request understood elsewhere (Marketing's request box), ready for Set it up. */ initialBrief?: string }) {
    const { companies } = useOsCompanies();
    const [brief, setBrief] = useState(watch?.brief ?? initialBrief ?? '');
    const [designing, setDesigning] = useState(false);
    const [designNote, setDesignNote] = useState<string | null>(null);
    const [shown, setShown] = useState(Boolean(watch));
    const [name, setName] = useState(watch?.name ?? '');
    const [mailboxId, setMailboxId] = useState(watch?.mailboxId ?? mailboxes[0]?.id ?? '');
    const [description, setDescription] = useState(watch?.description ?? '');
    const [noun, setNoun] = useState(watch?.noun ?? '');
    const [fields, setFields] = useState<FieldRow[]>(watch?.fields.map((f) => ({ label: f.label, kind: f.kind })) ?? []);
    const [rank, setRank] = useState<WatchRank>(watch?.rank ?? 'fit');
    const [threshold, setThreshold] = useState(watch?.threshold ?? 60);
    const [minDiscountPct, setMinDiscountPct] = useState(watch?.minDiscountPct ?? 30);
    const [keywords, setKeywords] = useState(join(watch?.keywords ?? []));
    const [senders, setSenders] = useState(join([...(watch?.senderAddresses ?? []), ...(watch?.senderDomains ?? [])]));
    const [labels, setLabels] = useState(join(watch?.labels ?? []));
    const [units, setUnits] = useState(join(watch?.dealUnitTokens ?? []));
    const [companyId, setCompanyId] = useState(watch?.companyId ?? initialCompanyId ?? '');
    const [autoPosts, setAutoPosts] = useState(watch?.autoPosts ?? false);
    const [digestOn, setDigestOn] = useState(watch?.digest.enabled ?? false);
    const [cadence, setCadence] = useState<'daily' | 'weekly'>(watch?.digest.cadence ?? 'weekly');
    const [maxItems, setMaxItems] = useState(watch?.digest.maxItems ?? 10);
    const [aiSummary, setAiSummary] = useState(watch?.aiSummary ?? true);
    const [lookbackHours, setLookbackHours] = useState(watch?.lookbackHours ?? 168);
    const [intervalMinutes, setIntervalMinutes] = useState(watch?.intervalMinutes ?? 60);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const design = async () => {
        setDesigning(true);
        setError(null);
        setDesignNote(null);
        const res = await fetch('/api/os/content/watches/design', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: brief, companyId: companyId || null }) });
        const data = (await res.json().catch(() => ({}))) as { design?: Design; error?: string };
        setDesigning(false);
        if (!res.ok || !data.design) return setError(data.error ?? `Failed (${res.status})`);
        const d = data.design;
        setName(d.name);
        setDescription(d.description);
        setNoun(d.noun);
        setFields(d.fields.map((f) => ({ label: f.label, kind: f.kind })));
        setRank(d.rank);
        setThreshold(d.threshold);
        setMinDiscountPct(d.minDiscountPct);
        setUnits(join(d.dealUnitTokens));
        if (d.keywords.length) setKeywords(join(d.keywords));
        setShown(true);
        setDesignNote(d.designed ? 'Here is a starting setup. Check each part, then create it.' : 'No model was available, so this is a generic starting point. Adjust it before creating.');
    };

    const save = async () => {
        setBusy(true);
        setError(null);
        const senderList = split(senders);
        const body = {
            name,
            mailboxId,
            brief,
            description,
            noun: noun.trim() || null,
            fields: fields.filter((f) => f.label.trim()).map((f) => ({ label: f.label.trim(), kind: f.kind })),
            rank,
            threshold,
            minDiscountPct,
            keywords: split(keywords),
            senderAddresses: senderList.filter((s) => s.includes('@') && !s.startsWith('@')),
            senderDomains: senderList.filter((s) => !s.includes('@') || s.startsWith('@')),
            labels: split(labels),
            dealUnitTokens: rank === 'discount' ? split(units) : [],
            companyId: companyId || null,
            autoPosts: Boolean(companyId) && !watch?.socialJobId && autoPosts,
            digest: { enabled: Boolean(companyId) && digestOn, cadence, maxItems },
            aiSummary,
            lookbackHours,
            intervalMinutes,
        };
        const res = await fetch(watch ? `/api/os/content/watches/${watch.id}` : '/api/os/content/watches', { method: watch ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const data = (await res.json().catch(() => ({}))) as { watch?: WatchView; error?: string };
        setBusy(false);
        if (!res.ok || !data.watch) return setError(data.error ?? `Failed (${res.status})`);
        onSaved(data.watch);
    };

    const setField = (i: number, patch: Partial<FieldRow>) => setFields((list) => list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    const field = 'ui-control w-full';
    return (
        <div className="ui-card space-y-3 p-4">
            <h3 className="text-sm font-semibold">{watch ? 'Change watch' : 'New watch'}</h3>

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 sm:col-span-2">
                    <span className="ui-kicker">What should this watch collect?</span>
                    <textarea className={`${field} h-16 resize-y`} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={500} placeholder="e.g. AI industry news worth a weekly newsletter · new game releases and trailers · the biggest discounts on camping gear" />
                </label>
                <label className="space-y-1">
                    <span className="ui-kicker">For company (optional)</span>
                    <select className={field} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                        <option value="">No company</option>
                        {(companies ?? []).map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <span className="block text-[11px] text-text-secondary">Its overview and marketing plan guide the setup, and its Voice writes posts and digests.</span>
                </label>
                <label className="space-y-1">
                    <span className="ui-kicker">Mailbox</span>
                    <select className={field} value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
                        {mailboxes.map((m) => (
                            <option key={m.id} value={m.id}>{m.emailAddress}</option>
                        ))}
                    </select>
                </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={shown ? 'ui-button' : 'ui-button-primary'} disabled={designing || brief.trim().length < 8} onClick={() => void design()}>{designing ? 'Setting it up…' : shown ? 'Set it up again' : 'Set it up'}</button>
                {!shown ? <button type="button" className="touch-link text-[11px] text-text-secondary" onClick={() => setShown(true)}>or set it up by hand</button> : null}
                {designNote ? <span className="text-[11px] text-text-secondary">{designNote}</span> : null}
            </div>

            {shown ? (
                <>
                    <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                        <label className="space-y-1">
                            <span className="ui-kicker">Name</span>
                            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AI industry news" maxLength={120} />
                        </label>
                        <label className="space-y-1">
                            <span className="ui-kicker">One item is a…</span>
                            <input className={field} value={noun} onChange={(e) => setNoun(e.target.value)} placeholder="story, deal, release" maxLength={30} />
                        </label>
                    </div>

                    <label className="block space-y-1">
                        <span className="ui-kicker">Which emails count</span>
                        <textarea className={`${field} h-20 resize-y`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="e.g. Announcements and analysis about AI models, funding and regulation. Not webinars, job posts or generic tool promotions." />
                    </label>

                    <div className="space-y-1">
                        <span className="ui-kicker">Collect from each email</span>
                        {fields.length ? (
                            <ul className="space-y-1">
                                {fields.map((f, i) => (
                                    <li key={i} className="flex gap-1">
                                        <input className="ui-control min-w-0 flex-1" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} maxLength={60} aria-label={`Field ${i + 1} name`} />
                                        <select className="ui-control" value={f.kind} onChange={(e) => setField(i, { kind: e.target.value as FieldKind })} aria-label={`Field ${i + 1} type`}>
                                            {FIELD_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                                        </select>
                                        <button type="button" className="ui-button px-2" onClick={() => setFields((list) => list.filter((_, j) => j !== i))} aria-label={`Remove ${f.label || 'field'}`}>×</button>
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="text-[11px] text-text-secondary">No fields: each email keeps only its summary and key points.</p>}
                        {fields.length < MAX_FIELDS ? <button type="button" className="touch-link text-[11px]" onClick={() => setFields((list) => [...list, { label: '', kind: 'text' }])}>Add field</button> : null}
                    </div>

                    <div className="space-y-1">
                        <span className="ui-kicker">Rank by</span>
                        <div className="flex flex-wrap gap-1">
                            {WATCH_RANKS.map((r) => <button key={r} type="button" className={rank === r ? 'ui-button-primary' : 'ui-button'} onClick={() => setRank(r)}>{RANK_LABELS[r].label}</button>)}
                        </div>
                        <span className="block text-[11px] text-text-secondary">{RANK_LABELS[rank].help}</span>
                    </div>

                    {description.trim() || rank !== 'discount' ? (
                        <label className="block space-y-1">
                            <span className="ui-kicker">How closely it must fit: {threshold} / 100</span>
                            <input type="range" min={0} max={100} step={5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-full" aria-label="Fit threshold" />
                            <span className="block text-[11px] text-text-secondary">Higher keeps fewer, closer matches. Around 60 is a good start.</span>
                        </label>
                    ) : null}
                    {rank === 'discount' ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1">
                                <span className="ui-kicker">Smallest offer worth keeping (%)</span>
                                <input type="number" min={0} max={1000} step={5} className={field} value={minDiscountPct} onChange={(e) => setMinDiscountPct(Number(e.target.value))} />
                                <span className="block text-[11px] text-text-secondary">30 means you save 30%, or get 30% more than you pay. Bonuses can go past 100.</span>
                            </label>
                            <label className="space-y-1">
                                <span className="ui-kicker">Credit units besides money</span>
                                <input className={field} value={units} onChange={(e) => setUnits(e.target.value)} placeholder="e.g. SC, GC, points" />
                            </label>
                        </div>
                    ) : null}

                    {companyId ? (
                        <div className="space-y-2 rounded border border-border p-3">
                            <label className="flex items-center gap-2 text-xs">
                                <input type="checkbox" disabled={Boolean(watch?.socialJobId)} checked={watch?.socialJobId ? false : autoPosts} onChange={(e) => setAutoPosts(e.target.checked)} />
                                {watch?.socialJobId ? 'Social posts are managed by the Marketing job (one queue)' : 'Legacy: draft social posts here instead of using a Marketing job'}
                            </label>
                            <label className="flex items-center gap-2 text-xs">
                                <input type="checkbox" checked={digestOn} onChange={(e) => setDigestOn(e.target.checked)} />
                                Write a digest newsletter from what was flagged
                            </label>
                            {digestOn ? (
                                <div className="flex flex-wrap items-center gap-2 pl-5 text-xs">
                                    <select className="ui-control" value={cadence} onChange={(e) => setCadence(e.target.value as 'daily' | 'weekly')} aria-label="Digest cadence">
                                        <option value="daily">Every day</option>
                                        <option value="weekly">Every week</option>
                                    </select>
                                    <span>with up to</span>
                                    <input type="number" min={3} max={25} className="ui-control w-16" value={maxItems} onChange={(e) => setMaxItems(Number(e.target.value))} aria-label="Most items per digest" />
                                    <span>items, top ranked. It lands in Content → Articles as a draft.</span>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    <details className="space-y-3 text-sm">
                        <summary className="cursor-pointer text-xs text-text-secondary">More options</summary>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1"><span className="ui-kicker">Only emails mentioning (comma separated)</span><input className={field} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="launch, beta, release" /></label>
                            <label className="space-y-1"><span className="ui-kicker">Only from (addresses or domains)</span><input className={field} value={senders} onChange={(e) => setSenders(e.target.value)} placeholder="news@example.com, example.org" /></label>
                            <label className="space-y-1"><span className="ui-kicker">Only in Gmail labels</span><input className={field} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="Newsletters" /></label>
                            <label className="space-y-1"><span className="ui-kicker">Look back (hours)</span><input type="number" min={6} max={720} className={field} value={lookbackHours} onChange={(e) => setLookbackHours(Number(e.target.value))} /></label>
                            <label className="space-y-1"><span className="ui-kicker">Scan every (minutes)</span><input type="number" min={15} max={1440} step={15} className={field} value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} /></label>
                        </div>
                        <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={aiSummary} onChange={(e) => setAiSummary(e.target.checked)} />Write a short summary of each email</label>
                    </details>
                </>
            ) : null}

            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            <div className="flex gap-2">
                {shown ? <button type="button" className="ui-button-primary" disabled={busy || !name.trim() || !mailboxId} onClick={() => void save()}>{busy ? 'Saving…' : watch ? 'Save changes' : 'Create watch'}</button> : null}
                <button type="button" className="ui-button" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}
