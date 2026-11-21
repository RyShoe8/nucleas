'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTitleSlot } from '@/lib/os/titleSlot';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import { useVoiceWorkspace } from '../voice/VoiceWorkspace';
import type { ModuleRenderContext } from '@/lib/os/types';
import { RELATIONSHIP_LABEL, type OsCompanyDetail, type OsCompanySummary, type OsConnection } from './companyTypes';
import CompanyPeople from './workspace/CompanyPeople';
import CompanySwitcher from './CompanySwitcher';
import CompanyAbout from './CompanyAbout';
import CompanySnapshot from './CompanySnapshot';
import { setAssistantFocus } from '@/lib/os/assistantFocus';
import CompanyTimeline from './CompanyTimeline';
import CodeRepositories from './CodeRepositories';
import WebsiteConnectionPanel from './WebsiteConnectionPanel';
import AdminAccount from './AdminAccount';
import PropertyOverviewButton from './PropertyOverviewReport';
import SocialIcon from '@/components/projects/SocialIcon';
import { SOCIAL_NETWORK_LABELS } from '@/lib/utils/socialUrls';
import type { SocialNetwork } from '@/lib/models/Project';
import { companySection } from '@/lib/os/workspaceRoutes';
import WorkspaceNavigation from './workspace/WorkspaceNavigation';
import RetainedSection from './workspace/RetainedSection';
import CompanyLibrary from './workspace/CompanyLibrary';
import WorkModule from './WorkModule';

export default function CompanyModule({ payload, windowId }: ModuleRenderContext) {
    // The screen can move to another company in place, keeping the tab you are on.
    const [companyId, setCompanyId] = useState(payload?.companyId);
    const [section, setSection] = useState(payload?.jobId ? 'work' : companySection(payload?.section));
    const [detail, setDetail] = useState<OsCompanyDetail | null>(null);
    useVoiceWorkspace({ moduleId: 'company', companyId: companyId ?? '', companyName: detail && detail.company.id === companyId ? detail.company.name : payload?.companyName, section });
    const [error, setError] = useState<string | null>(null);
    const [activityKey, setActivityKey] = useState(0);
    const [focusJobId, setFocusJobId] = useState<string | undefined>(typeof payload?.jobId === 'string' ? payload.jobId : undefined);
    // In its own desktop window the company picker lives in the title bar, so the page does not repeat the name.
    const titleSlot = useTitleSlot(windowId);
    // Combined numbers for every website until one is chosen; the logo goes back to all of them.
    const [site, setSite] = useState<string | null>(null);
    // Set right after this window archives the company, so it can say so and offer to undo.
    const [archived, setArchived] = useState<{ id: string; name: string } | null>(null);
    const auth = useOsAuth();

    const loadVersion = useRef(0);
    const load = useCallback(async () => {
        if (!companyId) return;
        const version = ++loadVersion.current;
        try {
            const res = await fetch(`/api/os/companies/${companyId}`);
            if (!res.ok) throw new Error(res.status === 404 ? 'Company not found' : `HTTP ${res.status}`);
            const next = await res.json() as OsCompanyDetail;
            if (version !== loadVersion.current) return;
            setDetail(next);
            setError(null);
        } catch (err) {
            if (version !== loadVersion.current) return;
            setError(err instanceof Error ? err.message : 'unknown');
        }
    }, [companyId]);

    useEffect(() => {
        void load();
        return () => { loadVersion.current += 1; };
    }, [load]);

    useEffect(() => {
        window.addEventListener('nucleas:voice-changed', load);
        window.addEventListener('nucleas:voice-generated', load);
        window.addEventListener('nucleas:companies-changed', load);
        return () => {
            window.removeEventListener('nucleas:voice-changed', load);
            window.removeEventListener('nucleas:voice-generated', load);
            window.removeEventListener('nucleas:companies-changed', load);
        };
    }, [load]);

    if (!companyId) return <div className="p-4 text-sm text-text-secondary">No company selected.</div>;
    if (archived) return <ArchivedNotice company={archived} onRestored={() => { setArchived(null); setError(null); void load(); }} />;
    if (error) return <div className="p-4 text-sm text-red-400">{error}</div>;
    if (!detail) return <div className="p-4 text-sm text-text-secondary">Loading…</div>;

    const { company, projects, connections } = detail;
    const switcher = (compact: boolean) => <CompanySwitcher compact={compact} current={company} onSwitch={(next) => { setDetail(null); setFocusJobId(undefined); setSite(null); setCompanyId(next.id); }} />;
    const websites = company.websites?.length ? company.websites : company.domain ? [company.domain] : [];
    if (titleSlot && typeof document !== 'undefined') document.title = company.name;

    return (
        <WorkspaceNavigation companyId={company.id} companyName={company.name}><div className="h-full overflow-y-auto p-4 sm:p-5 space-y-5 text-text-primary">
            <header className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-3 sm:flex">
                <button type="button" onClick={() => setSite(null)} title={websites.length > 1 ? 'Show every website together' : company.name} aria-label={websites.length > 1 ? 'Show every website together' : company.name} aria-pressed={websites.length > 1 && !site}
                    className={`mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border ${websites.length > 1 && !site ? 'border-primary' : 'border-border'} bg-background-card hover:border-primary`}>
                    {company.logo
                        // eslint-disable-next-line @next/next/no-img-element -- the company's own logo, any host
                        ? <img src={company.logo} alt="" className="h-full w-full object-contain" />
                        : <span aria-hidden className="h-5 w-5 rounded-full" style={{ backgroundColor: company.color ?? '#64748b' }} />}
                </button>
                <div className="min-w-0 flex-1">
                    {titleSlot ? createPortal(switcher(true), titleSlot) : switcher(false)}
                    {/* The websites, each opening the site: the name is already in the title bar. */}
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        {websites.length ? websites.map((host, i) => (
                            <span key={host} className="inline-flex items-center gap-1">
                                {websites.length > 1
                                    ? <button type="button" onClick={() => { setSite(site === host ? null : host); setSection('overview'); }} aria-pressed={site === host} title={site === host ? 'Back to every website' : `Show only ${host}`}
                                        className={`rounded px-1.5 ${site === host ? 'bg-primary/15 font-medium text-primary' : i === 0 && !site ? 'font-medium text-text-primary' : 'text-text-secondary'} hover:text-primary`}>{host}</button>
                                    : <span className="font-medium">{host}</span>}
                                <a href={`https://${host}`} target="_blank" rel="noreferrer" className="text-xs text-text-secondary hover:text-primary" title={`Open ${host}`} aria-label={`Open ${host}`}>↗</a>
                            </span>
                        )) : <button type="button" className="text-xs text-text-secondary hover:text-text-primary" onClick={() => setSection('about')}>Add a website</button>}
                        <span className="text-xs text-text-secondary">{RELATIONSHIP_LABEL[company.relationship]}{company.devUrl ? ` · dev ${company.devUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : ''}</span>
                    </p>
                    <button type="button" className="mt-1 block text-left text-sm text-text-secondary hover:text-text-primary" onClick={() => setSection('about')} title="Open About: what it does, who it is for, competitors and key facts">
                        <span className="line-clamp-2">{company.description || 'Add what this company does, who it is for and what the team should know.'}</span>
                        <span className="text-xs text-primary">About →</span>
                    </button>
                    <SocialLinks links={company.socialLinks ?? []} />
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-2 sm:flex sm:flex-col">
                    <AskButton companyId={company.id} companyName={company.name} />
                    <button className="ui-button" onClick={() => setSection('work')}>Work →</button>
                </div>
            </header>

            <nav aria-label="Company workspace" className="sticky top-0 z-10 flex gap-1 overflow-x-auto rounded-xl border border-border bg-background p-1">
                {[['overview', 'Overview'], ['work', 'Work'], ['people', 'People'], ['library', 'Library'], ['connections', 'Connections']].map(([id, label]) => <button key={id} aria-pressed={section === id} onClick={() => setSection(id)} className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm sm:flex-1 ${section === id ? 'bg-primary/15 text-primary font-medium' : 'text-text-secondary hover:bg-background-card'}`}>{label}</button>)}
            </nav>
            {['about', 'activity'].includes(section) && <button className="ui-button" onClick={() => setSection('overview')}>← Overview</button>}
            {section === 'overview' && <div className="flex flex-wrap gap-2"><button className="ui-button" onClick={() => setSection('about')}>About & brand</button><button className="ui-button" onClick={() => setSection('activity')}>Activity & receipts</button></div>}
            <RetainedSection key={company.id + 'work'} active={section === 'work'}><WorkModule key={`${company.id}:${focusJobId ?? ''}`} payload={{ companyId: company.id, companyName: company.name, ...(focusJobId ? { jobId: focusJobId } : {}), ...(payload?.runId ? { runId: payload.runId } : {}), ...(payload?.deliveryId ? { deliveryId: payload.deliveryId } : {}) }} /></RetainedSection>
            <RetainedSection key={company.id + 'library'} active={section === 'library'}><CompanyLibrary key={company.id} companyId={company.id} companyName={company.name} /></RetainedSection>
            <RetainedSection key={company.id + 'about'} active={section === 'about'}><CompanyAbout key={company.id} companyId={company.id} companyName={company.name}
                overviewAction={<PropertyOverviewButton companyId={company.id} companyName={company.name} canManage={detail.canManage} />}
                basics={<>
                    <SubredditEditor
                        companyId={company.id}
                        subreddit={company.subreddit}
                        canManage={detail.canManage}
                        onSaved={(subreddit) => {
                            setDetail((current) => current ? { ...current, company: { ...current.company, subreddit: subreddit ?? undefined } } : current);
                            setActivityKey((key) => key + 1);
                        }}
                    />
                    {auth.isAdmin ? <ArchiveCompanyButton companyId={company.id} companyName={company.name} onArchived={() => setArchived({ id: company.id, name: company.name })} /> : null}
                    <RelationshipEditor
                        companyId={company.id}
                        relationship={company.relationship}
                        canManage={detail.canManage}
                        onSaved={() => {
                            void load();
                            setActivityKey((key) => key + 1);
                        }}
                    />
                    <WebsitesEditor
                        companyId={company.id}
                        websites={websites}
                        canManage={detail.canManage}
                        onSaved={(sites) => {
                            setDetail((current) => current ? { ...current, company: { ...current.company, domain: sites[0], websites: sites } } : current);
                            setActivityKey((key) => key + 1);
                        }}
                    />
                </>} /></RetainedSection>
            <RetainedSection key={company.id + 'people'} active={section === 'people'}><CompanyPeople key={company.id} companyId={company.id} companyName={company.name} /></RetainedSection>
            <RetainedSection key={company.id + 'overview'} active={section === 'overview'}><CompanySnapshot
                key={company.id}
                companyId={company.id}
                site={site}
                initialPeriod={Number(payload?.period)}
                onAllSites={() => setSite(null)}
                connections={connections.filter((c) => c.status === 'connected')}
                aiCitations={detail.stats?.aiCitations ?? 0}
                aiCitationSeries={detail.stats?.aiCitationSeries ?? []}
                onActivity={() => setActivityKey((k) => k + 1)}
            /></RetainedSection>
            <RetainedSection key={company.id + 'connections'} active={section === 'connections'}><section className="ui-card p-3">
            <h3 className="text-sm font-medium">Connections and setup</h3>
            <div className="mt-3 space-y-4">
            <ProjectsSection projects={projects} />
            <CodeRepositories companyId={company.id} compact />
            <AdminAccount companyId={company.id} defaultDomain={company.domain} />
            <WebsiteConnectionPanel companyId={company.id} domain={company.domain} />
            <IntegrationsSummary companyId={company.id} companyName={company.name} connections={connections} />
            <AccountWebsites companyId={company.id} websites={websites} connections={connections} canManage={detail.canManage} onSaved={() => void load()} />
            </div>
            </section></RetainedSection>
            <RetainedSection key={company.id + 'activity'} active={section === 'activity'}><CompanyTimeline key={company.id} companyId={company.id} refreshKey={activityKey} onOpenJob={(jobId) => { setFocusJobId(jobId); setSection('work'); }} /></RetainedSection>
        </div></WorkspaceNavigation>
    );
}

async function setArchivedRequest(companyId: string, archived: boolean): Promise<string | null> {
    const res = await fetch(`/api/os/companies/${companyId}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived }) }).catch(() => null);
    if (res?.ok) {
        window.dispatchEvent(new Event('nucleas:companies-changed'));
        return null;
    }
    return ((await res?.json().catch(() => ({}))) as { error?: string } | undefined)?.error ?? 'Something went wrong.';
}

/** Archiving is how a company is deleted: hidden everywhere and nothing runs for it, but every record is kept. */
function ArchiveCompanyButton({ companyId, companyName, onArchived }: { companyId: string; companyName: string; onArchived: () => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const archive = async () => {
        if (!window.confirm(`Archive ${companyName}?\n\nIt disappears from every list, window and Ask, and its jobs, watches and metric syncs stop. Nothing is erased: its connections, history and settings are kept, and an Administrator can restore it from Companies → Archived.`)) return;
        setBusy(true);
        setError(null);
        const failed = await setArchivedRequest(companyId, true);
        setBusy(false);
        if (failed) setError(failed);
        else onArchived();
    };
    return (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <button type="button" className="rounded border border-red-400/50 px-2 py-0.5 text-red-400 hover:bg-red-400/10 disabled:opacity-50" disabled={busy} onClick={() => void archive()}>
                {busy ? 'Archiving…' : 'Archive company'}
            </button>
            <span className="text-text-secondary">Hides it and stops its work; restorable.</span>
            {error ? <span role="alert" className="text-red-400">{error}</span> : null}
        </div>
    );
}

function ArchivedNotice({ company, onRestored }: { company: { id: string; name: string }; onRestored: () => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    return (
        <div className="space-y-2 p-4 text-sm">
            <p><strong>{company.name}</strong> is archived. Its jobs, watches and syncs have stopped, and everything about it is kept.</p>
            <p className="text-xs text-text-secondary">You can restore it any time from Companies → Archived.</p>
            <button type="button" className="ui-button" disabled={busy} onClick={async () => {
                setBusy(true);
                const failed = await setArchivedRequest(company.id, false);
                setBusy(false);
                if (failed) setError(failed);
                else onRestored();
            }}>{busy ? 'Restoring…' : 'Undo: restore it'}</button>
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
        </div>
    );
}

/** Whether this is a client, one of our own businesses, or the operating company. */
function RelationshipEditor({ companyId, relationship, canManage, onSaved }: { companyId: string; relationship: OsCompanySummary['relationship']; canManage: boolean; onSaved: () => void }) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const change = async (next: OsCompanySummary['relationship']) => {
        if (next === relationship || saving) return;
        if (!window.confirm(`Change this company to "${RELATIONSHIP_LABEL[next]}"? It moves to that list, and for our own businesses the profile and team come from its linked hub project when it has one. Nothing is deleted; you can change it back.`)) return;
        setSaving(true);
        setError(null);
        const res = await fetch(`/api/os/companies/${companyId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ relationship: next }) }).catch(() => null);
        setSaving(false);
        if (!res?.ok) return setError(((await res?.json().catch(() => ({}))) as { error?: string } | undefined)?.error ?? 'Could not change the company type.');
        onSaved();
    };
    return (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <label className="text-text-secondary" htmlFor={`relationship-${companyId}`}>Type</label>
            {canManage ? (
                <select id={`relationship-${companyId}`} className="ui-control py-0.5 text-xs" value={relationship} disabled={saving} onChange={(e) => void change(e.target.value as OsCompanySummary['relationship'])}>
                    {(['client', 'owned', 'internal'] as const).map((value) => <option key={value} value={value}>{RELATIONSHIP_LABEL[value]}</option>)}
                </select>
            ) : <span>{RELATIONSHIP_LABEL[relationship]}</span>}
            {saving ? <span className="text-text-secondary">Saving…</span> : null}
            {error ? <span role="alert" className="text-red-400">{error}</span> : null}
        </div>
    );
}

/** The company's websites, one per line; the first is its production domain. */
function WebsitesEditor({ companyId, websites, canManage, onSaved }: { companyId: string; websites: string[]; canManage: boolean; onSaved: (websites: string[]) => void }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(websites.join('\n'));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function save(event: FormEvent) {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError(null);
        const lines = value.split(/[\n,]+/).map((line) => line.trim()).filter(Boolean);
        try {
            const response = await fetch(`/api/os/companies/${companyId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ domain: lines[0] ?? '', websites: lines.slice(1) }),
            });
            const data = await response.json().catch(() => ({})) as { domain?: string | null; websites?: string[]; error?: string };
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            onSaved(data.websites ?? (data.domain ? [data.domain] : []));
            setEditing(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the websites.');
        } finally {
            setSaving(false);
        }
    }

    if (!editing) {
        return (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-text-secondary">Websites</span>
                {websites.length ? websites.map((site, i) => (
                    <a key={site} href={`https://${site}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{site}{i === 0 ? ' (main)' : ''}</a>
                )) : <span className="text-text-secondary">None yet</span>}
                {canManage ? (
                    <button type="button" className="text-[11px] text-text-secondary underline-offset-2 hover:text-text-primary hover:underline" onClick={() => { setValue(websites.join('\n')); setError(null); setEditing(true); }}>
                        {websites.length ? 'Edit' : 'Add websites'}
                    </button>
                ) : null}
            </div>
        );
    }

    return (
        <form onSubmit={save} className="mt-2 max-w-md space-y-1.5">
            <label className="block text-[11px] text-text-secondary" htmlFor={`websites-${companyId}`}>Websites, one per line. The first is the main (production) site.</label>
            <textarea id={`websites-${companyId}`} value={value} onChange={(event) => setValue(event.target.value)} placeholder={'example.com\nshop.example.com'} autoFocus rows={4}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-text-primary" />
            <div className="flex gap-2">
                <button type="submit" disabled={saving} className="rounded bg-primary px-2.5 py-1 text-xs text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
                <button type="button" disabled={saving} className="rounded border border-border px-2.5 py-1 text-xs hover:bg-background-card disabled:opacity-50" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
            </div>
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
        </form>
    );
}

function SubredditEditor({ companyId, subreddit, canManage, onSaved }: { companyId: string; subreddit?: string; canManage: boolean; onSaved: (subreddit: string | null) => void }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(subreddit ? `r/${subreddit}` : '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => setValue(subreddit ? `r/${subreddit}` : ''), [subreddit]);

    async function save(event: FormEvent) {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError(null);
        try {
            const response = await fetch(`/api/os/companies/${companyId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ subreddit: value }),
            });
            const data = await response.json().catch(() => ({})) as { subreddit?: string | null; error?: string };
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            onSaved(data.subreddit ?? null);
            setEditing(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the subreddit.');
        } finally {
            setSaving(false);
        }
    }

    if (!editing) {
        if (!subreddit && !canManage) return null;
        return (
            <div className="mt-1 flex items-center gap-2 text-xs">
                {subreddit ? (
                    <a href={`https://www.reddit.com/r/${subreddit}`} target="_blank" rel="noreferrer" className="text-primary hover:underline" onClick={(event) => event.stopPropagation()}>r/{subreddit}</a>
                ) : (
                    <span className="text-text-secondary">No subreddit</span>
                )}
                {canManage ? (
                    <button type="button" className="text-[11px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline" onClick={() => { setValue(subreddit ? `r/${subreddit}` : ''); setError(null); setEditing(true); }}>
                        {subreddit ? 'Edit' : 'Set subreddit'}
                    </button>
                ) : null}
            </div>
        );
    }

    return (
        <form onSubmit={save} className="mt-2 max-w-md space-y-1.5">
            <label className="block text-[11px] text-text-secondary" htmlFor={`subreddit-${companyId}`}>Subreddit</label>
            <div className="flex gap-2">
                <input
                    id={`subreddit-${companyId}`}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder="r/YourCommunity"
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-text-primary"
                />
                <button type="submit" disabled={saving} className="rounded bg-primary px-2.5 py-1 text-xs text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
                <button type="button" disabled={saving} className="rounded border border-border px-2.5 py-1 text-xs hover:bg-background-card disabled:opacity-50" onClick={() => { setEditing(false); setError(null); setValue(subreddit ? `r/${subreddit}` : ''); }}>Cancel</button>
            </div>
            <p className="text-[11px] text-text-secondary">Reddit posts are made by hand, so there is no connection to set up. Nucleas uses this community when it plans posts and builds the company voice. Paste r/name or the subreddit link.</p>
            {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
        </form>
    );
}

function AskButton({ companyId, companyName }: { companyId: string; companyName: string }) {
    const wm = useWindowManager();
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                setAssistantFocus({ companyId, companyName });
                wm.open('assistant');
            }}
            className="ui-button-primary flex-shrink-0"
        >
            ✨ Ask Nucleas
        </button>
    );
}

/** One button per linked account; each goes straight to that page in a new tab. */
function SocialLinks({ links }: { links: { network: string; url: string }[] }) {
    const seen = new Set<string>();
    const shown = links.filter((link) => {
        if (!/^https?:\/\//i.test(link.url) || seen.has(link.url)) return false;
        seen.add(link.url);
        return true;
    });
    if (!shown.length) return null;
    return (
        <div className="mt-2 flex flex-wrap gap-1.5">
            {shown.map((link) => {
                const network = (link.network in SOCIAL_NETWORK_LABELS ? link.network : 'other') as SocialNetwork;
                const label = SOCIAL_NETWORK_LABELS[network];
                return (
                    <a
                        key={link.url}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={link.url.replace(/^https?:\/\//, '')}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px] hover:bg-background-card"
                    >
                        <SocialIcon network={network} size={14} />
                        {label}
                    </a>
                );
            })}
        </div>
    );
}

/** One line: connection counts, problems highlighted, and a link to the Integrations window. */
function IntegrationsSummary({ companyId, companyName, connections }: { companyId: string; companyName: string; connections: OsConnection[] }) {
    const wm = useWindowManager();
    const connected = connections.filter((c) => c.status === 'connected');
    const problems = connections.filter((c) => c.status === 'needs_reauth' || c.status === 'error');
    const notConnected = connections.filter((c) => c.status === 'declared');
    return (
        <section
            className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 ${problems.length ? 'border-amber-400/50' : 'border-border'}`}
        >
            <p className="text-xs min-w-0 truncate">
                <span className="text-text-secondary">Integrations: </span>
                {problems.length ? (
                    <span className="text-amber-400">
                        {problems.map((p) => p.providerName).join(', ')} need{problems.length === 1 ? 's' : ''} reconnecting ·{' '}
                    </span>
                ) : null}
                <span>{connected.length} connected</span>
                {notConnected.length ? <span className="text-text-secondary"> · {notConnected.length} not connected</span> : null}
            </p>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    wm.open('integrations', { payload: { companyId, companyName } });
                }}
                className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card flex-shrink-0"
            >
                Manage
            </button>
        </section>
    );
}

function ProjectsSection({ projects }: { projects: OsCompanyDetail['projects'] }) {
    return (
        <section>
            <h3 className="ui-kicker mb-2">Projects</h3>
            {projects.length === 0 ? (
                <p className="text-sm text-text-secondary">No projects linked.</p>
            ) : (
                <ul className="ui-card ui-divider-list overflow-hidden">
                    {projects.map((p) => (
                        <li key={p.id} className="px-3 py-2 flex items-center justify-between gap-2">
                            <span className="text-sm truncate">
                                {p.name}
                                {p.isHub ? <span className="ml-2 text-[11px] text-text-secondary">main</span> : null}
                            </span>
                            <span className="text-[11px] text-text-secondary flex-shrink-0">{p.status}</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * Payments and email accounts cannot tell a company's websites apart, so each is assigned to the sites it
 * belongs to; their numbers then show under those sites. An email list may serve several sites.
 */
function AccountWebsites({ companyId, websites, connections, canManage, onSaved }: { companyId: string; websites: string[]; connections: OsConnection[]; canManage: boolean; onSaved: () => void }) {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const accounts = connections.filter((c) => c.scope === 'company' && c.status === 'connected' && ['payments', 'email', 'commerce'].includes(c.domain));
    if (websites.length < 2 || !accounts.length) return null;
    const save = async (account: OsConnection, sites: string[]) => {
        setBusy(account.provider);
        setError(null);
        const res = await fetch(`/api/os/companies/${companyId}/connections`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: account.provider, sites }) }).catch(() => null);
        setBusy(null);
        if (!res?.ok) return setError(((await res?.json().catch(() => ({}))) as { error?: string } | undefined)?.error ?? 'Could not save.');
        onSaved();
    };
    return (
        <section className="space-y-2 rounded-md border border-border px-3 py-2">
            <p className="text-xs"><span className="font-medium">Which website each account is for</span> <span className="text-text-secondary">· numbers from these show under the websites you tick. Leave all unticked for the whole company.</span></p>
            {accounts.map((account) => (
                <div key={account.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="w-28 shrink-0 font-medium">{account.providerName}</span>
                    {websites.map((host) => {
                        const on = (account.sites ?? []).includes(host);
                        const next = on ? (account.sites ?? []).filter((s) => s !== host) : [...(account.sites ?? []), host];
                        // Payments belong to one website; an email list can be shared.
                        const single = account.domain !== 'email';
                        return (
                            <label key={host} className="inline-flex items-center gap-1">
                                <input type={single ? 'radio' : 'checkbox'} name={`sites-${account.id}`} checked={on} disabled={!canManage || busy !== null}
                                    onChange={() => void save(account, single ? (on ? [] : [host]) : next)} />
                                {host}
                            </label>
                        );
                    })}
                    {account.domain !== 'email' && (account.sites ?? []).length ? <button type="button" className="text-text-secondary underline" disabled={!canManage || busy !== null} onClick={() => void save(account, [])}>Whole company</button> : null}
                </div>
            ))}
            {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
        </section>
    );
}
