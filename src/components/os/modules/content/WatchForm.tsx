'use client';

import { useState } from 'react';
import type { MailboxView, WatchView } from '@/lib/watches/types-client';
import { useOsCompanies } from '../CompaniesModule';

const split = (value: string) => value.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
const join = (values: string[]) => values.join(', ');

/** Add or change a watch: which mailbox, what to flag, and how strong it must be. Everything else is under "More options". */
export default function WatchForm({ watch, mailboxes, onSaved, onCancel }: { watch?: WatchView; mailboxes: MailboxView[]; onSaved: (w: WatchView) => void; onCancel: () => void }) {
    const { companies } = useOsCompanies();
    const [name, setName] = useState(watch?.name ?? '');
    const [mailboxId, setMailboxId] = useState(watch?.mailboxId ?? mailboxes[0]?.id ?? '');
    const [mode, setMode] = useState<'match' | 'deal'>(watch?.mode ?? 'match');
    const [description, setDescription] = useState(watch?.description ?? '');
    const [threshold, setThreshold] = useState(watch?.threshold ?? 60);
    const [keywords, setKeywords] = useState(join(watch?.keywords ?? []));
    const [senders, setSenders] = useState(join([...(watch?.senderAddresses ?? []), ...(watch?.senderDomains ?? [])]));
    const [labels, setLabels] = useState(join(watch?.labels ?? []));
    const [units, setUnits] = useState(join(watch?.dealUnitTokens ?? []));
    const [companyId, setCompanyId] = useState(watch?.companyId ?? '');
    const [autoPosts, setAutoPosts] = useState(watch?.autoPosts ?? false);
    const [aiSummary, setAiSummary] = useState(watch?.aiSummary ?? true);
    const [lookbackHours, setLookbackHours] = useState(watch?.lookbackHours ?? 168);
    const [intervalMinutes, setIntervalMinutes] = useState(watch?.intervalMinutes ?? 60);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        setBusy(true);
        setError(null);
        const senderList = split(senders);
        const body = {
            name,
            mailboxId,
            mode,
            description: mode === 'match' ? description : '',
            threshold,
            keywords: split(keywords),
            senderAddresses: senderList.filter((s) => s.includes('@') && !s.startsWith('@')),
            senderDomains: senderList.filter((s) => !s.includes('@') || s.startsWith('@')),
            labels: split(labels),
            dealUnitTokens: mode === 'deal' ? split(units) : [],
            companyId: companyId || null,
            autoPosts: Boolean(companyId) && autoPosts,
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

    const field = 'ui-control w-full';
    return (
        <div className="ui-card space-y-3 p-4">
            <h3 className="text-sm font-semibold">{watch ? 'Change watch' : 'New watch'}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                    <span className="ui-kicker">Name</span>
                    <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Competitor launches" maxLength={120} />
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

            <div className="space-y-1">
                <span className="ui-kicker">What should be flagged?</span>
                <div className="flex gap-1">
                    <button type="button" className={mode === 'match' ? 'ui-button-primary' : 'ui-button'} onClick={() => setMode('match')}>Anything that fits a description</button>
                    <button type="button" className={mode === 'deal' ? 'ui-button-primary' : 'ui-button'} onClick={() => setMode('deal')}>Strong deals</button>
                </div>
            </div>

            {mode === 'match' ? (
                <label className="block space-y-1">
                    <span className="ui-kicker">Describe it in plain words</span>
                    <textarea className={`${field} h-20 resize-y`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Announcements of new products or major feature launches from other companies in our space." maxLength={1000} />
                </label>
            ) : (
                <p className="text-xs text-text-secondary">Each email is checked for what it costs against what you get, and scored by how strong the deal is (the larger of the savings and the bonus).</p>
            )}

            <label className="block space-y-1">
                <span className="ui-kicker">{mode === 'deal' ? 'Flag deals at least this strong' : 'Flag emails that score at least'}: {threshold}{mode === 'deal' ? '%' : ' / 100'}</span>
                <input type="range" min={0} max={100} step={5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-full" aria-label="Threshold" />
                <span className="block text-[11px] text-text-secondary">{mode === 'deal' ? 'A 30% deal means you get about 30% more than you pay. Raise it to see only the best.' : 'Higher means fewer, closer matches. Around 60 is a good start.'}</span>
            </label>

            <label className="block space-y-1">
                <span className="ui-kicker">Write social posts for (optional)</span>
                <select className={field} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                    <option value="">No company</option>
                    {(companies ?? []).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
                {companyId ? (
                    <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={autoPosts} onChange={(e) => setAutoPosts(e.target.checked)} />
                        Draft posts automatically for new flagged emails, in that company’s Voice
                    </label>
                ) : null}
            </label>

            <details className="space-y-3 text-sm">
                <summary className="cursor-pointer text-xs text-text-secondary">More options</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1"><span className="ui-kicker">Only emails mentioning (comma separated)</span><input className={field} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="launch, beta, release" /></label>
                    <label className="space-y-1"><span className="ui-kicker">Only from (addresses or domains)</span><input className={field} value={senders} onChange={(e) => setSenders(e.target.value)} placeholder="news@example.com, example.org" /></label>
                    <label className="space-y-1"><span className="ui-kicker">Only in Gmail labels</span><input className={field} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="Newsletters" /></label>
                    {mode === 'deal' ? <label className="space-y-1"><span className="ui-kicker">Credit units to recognize</span><input className={field} value={units} onChange={(e) => setUnits(e.target.value)} placeholder="e.g. SC, GC" /></label> : null}
                    <label className="space-y-1"><span className="ui-kicker">Look back (hours)</span><input type="number" min={6} max={720} className={field} value={lookbackHours} onChange={(e) => setLookbackHours(Number(e.target.value))} /></label>
                    <label className="space-y-1"><span className="ui-kicker">Scan every (minutes)</span><input type="number" min={15} max={1440} step={15} className={field} value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} /></label>
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={aiSummary} onChange={(e) => setAiSummary(e.target.checked)} />Write a short summary of each email</label>
            </details>

            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
            <div className="flex gap-2">
                <button type="button" className="ui-button-primary" disabled={busy || !name.trim() || !mailboxId} onClick={() => void save()}>{busy ? 'Saving…' : watch ? 'Save changes' : 'Create watch'}</button>
                <button type="button" className="ui-button" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}
