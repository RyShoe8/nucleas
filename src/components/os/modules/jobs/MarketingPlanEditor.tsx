'use client';
import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
const BUTTON = 'ui-button';
const PRIMARY = 'ui-button-primary';
type MarketingPlanView = {
    companyId: string; companyName: string; status: 'draft' | 'approved'; summary: string; audience: string; goals: string[]; positioning: string; messagingPillars: string[];
    primaryTopics: string[]; competitors: string[]; excludedTopics: string[]; geographicTargets: string[]; priorityPages: { url: string; purpose: string; keywords: string[] }[]; seoStrategy: string;
    aiCitationStrategy: string; aiTargetQuestions: string[]; aiSourceTargets: string[]; socialStrategy: string; socialPlatforms: string[]; socialContentPillars: string[]; socialCadence: string; kpis: string[]; notes: string;
    revision: number; approvedAt: string | null;
};

export default function MarketingPlanEditor({ companyId, updatedAt, hideEmpty = false }: { companyId: string; updatedAt?: string; hideEmpty?: boolean }) {
    const [plan, setPlan] = useState<MarketingPlanView | null>(null);
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        const reload = () => setRefresh((value) => value + 1);
        window.addEventListener('nucleas:jobs-changed', reload);
        return () => window.removeEventListener('nucleas:jobs-changed', reload);
    }, []);
    useEffect(() => {
        let cancelled = false;
        void fetch(`/api/os/marketing-plans/${companyId}`, { cache: 'no-store' }).then(async (res) => {
            const body = (await res.json().catch(() => ({}))) as { plan?: MarketingPlanView | null; error?: string };
            if (!res.ok) throw new Error(body.error ?? 'Could not load the Marketing Plan.');
            if (!cancelled) { setPlan(body.plan ?? null); setError(null); setLoading(false); }
        }).catch((err: Error) => { if (!cancelled) { setError(err.message); setLoading(false); } });
        return () => { cancelled = true; };
    }, [companyId, updatedAt, refresh]);
    const open = () => {
        if (!plan) return;
        setForm({ summary: plan.summary, audience: plan.audience, goals: plan.goals.join('\n'), positioning: plan.positioning, messagingPillars: plan.messagingPillars.join('\n'), primaryTopics: plan.primaryTopics.join('\n'), competitors: plan.competitors.join('\n'), excludedTopics: plan.excludedTopics.join('\n'), geographicTargets: plan.geographicTargets.join('\n'), priorityPages: JSON.stringify(plan.priorityPages, null, 2), seoStrategy: plan.seoStrategy, aiCitationStrategy: plan.aiCitationStrategy, aiTargetQuestions: plan.aiTargetQuestions.join('\n'), aiSourceTargets: plan.aiSourceTargets.join('\n'), socialStrategy: plan.socialStrategy, socialPlatforms: plan.socialPlatforms.join('\n'), socialContentPillars: plan.socialContentPillars.join('\n'), socialCadence: plan.socialCadence, kpis: plan.kpis.join('\n'), notes: plan.notes });
        setEditing(true);
    };
    const save = async (status: 'draft' | 'approved') => {
        setBusy(true); setError(null);
        const list = (key: string) => (form[key] ?? '').split('\n').map((value) => value.trim()).filter(Boolean);
        let priorityPages: unknown = [];
        try { priorityPages = JSON.parse(form.priorityPages || '[]'); } catch { setBusy(false); setError('Priority pages must be valid JSON.'); return; }
        const res = await fetch(`/api/os/marketing-plans/${companyId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, summary: form.summary, audience: form.audience, goals: list('goals'), positioning: form.positioning, messagingPillars: list('messagingPillars'), primaryTopics: list('primaryTopics'), competitors: list('competitors'), excludedTopics: list('excludedTopics'), geographicTargets: list('geographicTargets'), priorityPages, seoStrategy: form.seoStrategy, aiCitationStrategy: form.aiCitationStrategy, aiTargetQuestions: list('aiTargetQuestions'), aiSourceTargets: list('aiSourceTargets'), socialStrategy: form.socialStrategy, socialPlatforms: list('socialPlatforms'), socialContentPillars: list('socialContentPillars'), socialCadence: form.socialCadence, kpis: list('kpis'), notes: form.notes }) });
        const body = (await res.json().catch(() => ({}))) as { plan?: MarketingPlanView; error?: string };
        setBusy(false);
        if (!res.ok || !body.plan) return setError(body.error ?? 'Could not save the Marketing Plan.');
        setPlan(body.plan); setEditing(false);
        window.dispatchEvent(new Event('nucleas:jobs-changed'));
    };
    if (!plan) {
        if (loading) return <p className="text-xs text-text-secondary">Loading marketing plan…</p>;
        if (error) return <p role="alert" className="text-xs text-red-400">{error}</p>;
        if (hideEmpty) return null;
        return <p className="text-xs text-text-secondary">No saved marketing plan yet. Generate a draft and accept its result to view it here.</p>;
    }
    const textarea = (key: string, label: string, rows = 3) => <label className="block space-y-1"><span className="text-xs font-medium">{label}</span><textarea value={form[key] ?? ''} onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))} rows={rows} className="ui-control w-full resize-y" /></label>;
    return <>
        <div className="rounded border border-border p-3 flex items-center gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-medium">Marketing Plan · {plan.companyName}</p><p className="text-[11px] text-text-secondary">{plan.status === 'approved' ? `Approved · revision ${plan.revision} · execution jobs use this strategy` : `Draft · revision ${plan.revision}`}</p></div><button type="button" className={PRIMARY} onClick={open}>{plan.status === 'approved' ? 'View or edit plan' : 'Edit and approve'}</button></div>
        <div className="rounded border border-border p-3 space-y-3 text-sm">
            <p className="whitespace-pre-wrap">{plan.summary}</p>
            <details><summary className="cursor-pointer font-medium">Read full marketing plan</summary><div className="mt-3 space-y-4">
                {[
                    ['Audience', plan.audience], ['Goals', plan.goals.join('\n')], ['Positioning', plan.positioning],
                    ['Messaging pillars', plan.messagingPillars.join('\n')], ['SEO strategy', plan.seoStrategy],
                    ['Primary topics', plan.primaryTopics.join('\n')], ['Competitors', plan.competitors.join('\n')],
                    ['Excluded topics', plan.excludedTopics.join('\n')], ['Geographic targets', plan.geographicTargets.join('\n')],
                    ['Priority pages', plan.priorityPages.map((page) => `${page.url}\n${page.purpose}\n${page.keywords.join(', ')}`).join('\n\n')],
                    ['AI citation strategy', plan.aiCitationStrategy], ['Target questions', plan.aiTargetQuestions.join('\n')],
                    ['Source targets', plan.aiSourceTargets.join('\n')], ['Social strategy', plan.socialStrategy],
                    ['Social platforms', plan.socialPlatforms.join('\n')], ['Social content pillars', plan.socialContentPillars.join('\n')],
                    ['Social cadence', plan.socialCadence], ['KPIs', plan.kpis.join('\n')], ['Risks and evidence gaps', plan.notes],
                ].filter(([, value]) => value).map(([label, value]) => <section key={label}><h4 className="ui-kicker">{label}</h4><p className="whitespace-pre-wrap break-words">{value}</p></section>)}
            </div></details>
        </div>
        <Modal isOpen={editing} onClose={() => setEditing(false)} title={`Marketing Plan · ${plan.companyName}`} maxWidth="5xl" appearance="theme">
            <div className="space-y-5">
                <p className="text-xs text-text-secondary">Approving this plan creates separate proposed jobs for link building, AI-citation opportunities, and social drafts. You still review and approve each job before it runs.</p>
                <section className="space-y-3"><h3 className="ui-kicker">Company strategy</h3>{textarea('summary', 'Company and offering', 4)}{textarea('audience', 'Target audience', 4)}<div className="grid gap-3 sm:grid-cols-2">{textarea('goals', 'Marketing goals (one per line)')}{textarea('messagingPillars', 'Messaging pillars (one per line)')}{textarea('positioning', 'Positioning', 4)}{textarea('kpis', 'KPIs (one per line)', 4)}</div></section>
                <section className="space-y-3"><h3 className="ui-kicker">SEO</h3>{textarea('seoStrategy', 'SEO strategy', 5)}<div className="grid gap-3 sm:grid-cols-2">{textarea('primaryTopics', 'Primary topics (one per line)')}{textarea('competitors', 'Verified competitors (one per line)')}{textarea('excludedTopics', 'Excluded topics (one per line)')}{textarea('geographicTargets', 'Geographic targets (one per line)')}</div>{textarea('priorityPages', 'Priority pages (JSON: url, purpose, keywords[])', 8)}</section>
                <section className="space-y-3"><h3 className="ui-kicker">AI citations</h3>{textarea('aiCitationStrategy', 'AI citation strategy', 5)}<div className="grid gap-3 sm:grid-cols-2">{textarea('aiTargetQuestions', 'Target questions (one per line)', 5)}{textarea('aiSourceTargets', 'Source targets (one per line)', 5)}</div></section>
                <section className="space-y-3"><h3 className="ui-kicker">Social media</h3>{textarea('socialStrategy', 'Social strategy', 5)}<div className="grid gap-3 sm:grid-cols-2">{textarea('socialPlatforms', 'Platforms (one per line)')}{textarea('socialContentPillars', 'Content pillars (one per line)')}{textarea('socialCadence', 'Cadence and channel mix', 4)}</div></section>
                {textarea('notes', 'Risks and evidence gaps', 4)}
                {error ? <p className="text-xs text-red-400">{error}</p> : null}
                <div className="flex gap-2"><button type="button" className={BUTTON} disabled={busy} onClick={() => void save('draft')}>Save draft</button><button type="button" className={PRIMARY} disabled={busy} onClick={() => void save('approved')}>{busy ? 'Saving…' : 'Approve plan and create proposed jobs'}</button></div>
            </div>
        </Modal>
    </>;
}

