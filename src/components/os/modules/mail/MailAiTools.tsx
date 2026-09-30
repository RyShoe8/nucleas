'use client';

import { useState } from 'react';
import { useOsCompanies } from '../CompaniesModule';
import type { AiToolsContext } from './Reader';
import { post } from './types';

/** AI help for one conversation: a summary, a drafted reply, or turning it into a job. */
export default function MailAiTools({ thread, note, draftInto, compact }: AiToolsContext) {
    const { companies } = useOsCompanies();
    const [busy, setBusy] = useState<'summarize' | 'draft' | 'job' | null>(null);
    const [choosingCompany, setChoosingCompany] = useState(false);
    const [companyId, setCompanyId] = useState('');
    const base = { accountId: thread.accountId, threadId: thread.threadId };
    const btn = 'h-7 px-2 rounded border border-border text-[12px] hover:bg-background-card disabled:opacity-50';

    const summarize = async () => {
        setBusy('summarize');
        note(null);
        const res = await post<{ summary: string }>('/api/os/mail/ai', { action: 'summarize', ...base });
        setBusy(null);
        note(res.ok ? { kind: 'info', text: `Summary: ${res.data.summary}` } : { kind: 'error', text: res.error });
    };

    const draft = async () => {
        const instruction = window.prompt('Anything you want the reply to say? (optional)\nFor example: "Offer Thursday at 2pm" or "Decline politely".') ?? '';
        setBusy('draft');
        note(null);
        const res = await post<{ text: string }>('/api/os/mail/ai', { action: 'draft', instruction, ...base });
        setBusy(null);
        if (!res.ok) return note({ kind: 'error', text: res.error });
        draftInto(res.data.text);
        note({ kind: 'info', text: 'Draft written into the reply box. Read it and edit before you send: nothing has been sent.' });
    };

    const makeJob = async () => {
        setBusy('job');
        note(null);
        const res = await post<{ jobId: string; title: string | null; status: string }>('/api/os/mail/ai', { action: 'job', companyId: companyId || undefined, ...base });
        setBusy(null);
        if (!res.ok) {
            if (/which company/i.test(res.error)) setChoosingCompany(true);
            return note({ kind: 'error', text: res.error });
        }
        setChoosingCompany(false);
        note({ kind: 'info', text: `Job started${res.data.title ? `: ${res.data.title}` : ''}. Nucleas is designing it; find it in Jobs and approve it there.` });
    };

    if (compact) {
        return (
            <button type="button" className={btn} disabled={busy !== null} onClick={() => void draft()}>
                {busy === 'draft' ? 'Drafting…' : '✨ Draft with AI'}
            </button>
        );
    }
    return (
        <>
            <button type="button" className={btn} disabled={busy !== null} onClick={() => void summarize()}>
                {busy === 'summarize' ? 'Summarizing…' : '✨ Summarize'}
            </button>
            <button type="button" className={btn} disabled={busy !== null} onClick={() => void draft()}>
                {busy === 'draft' ? 'Drafting…' : '✨ Draft reply'}
            </button>
            {choosingCompany ? (
                <select aria-label="Company for the job" value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="h-7 px-1 rounded border border-border bg-background-elevated text-[12px]">
                    <option value="">Company…</option>
                    {(companies ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
            ) : null}
            <button type="button" className={btn} disabled={busy !== null || (choosingCompany && !companyId)} onClick={() => void makeJob()}>
                {busy === 'job' ? 'Creating…' : '✨ Make a job'}
            </button>
        </>
    );
}
