'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTitleSlot } from '@/lib/os/titleSlot';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import type { ModuleRenderContext } from '@/lib/os/types';
import { RELATIONSHIP_LABEL, type OsCompanyDetail, type OsConnection } from './companyTypes';
import CompanyTeamPanel from './CompanyTeamPanel';
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

export default function CompanyModule({ payload, windowId }: ModuleRenderContext) {
    // The screen can move to another company in place, keeping the tab you are on.
    const [companyId, setCompanyId] = useState(payload?.companyId);
    const [section, setSection] = useState(payload?.section ?? 'performance');
    const [detail, setDetail] = useState<OsCompanyDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activityKey, setActivityKey] = useState(0);
    const [focusJobId, setFocusJobId] = useState<string | undefined>(typeof payload?.jobId === 'string' ? payload.jobId : undefined);
    // In its own desktop window the company picker lives in the title bar, so the page does not repeat the name.
    const titleSlot = useTitleSlot(windowId);
    // Combined numbers for every website until one is chosen; the logo goes back to all of them.
    const [site, setSite] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!companyId) return;
        try {
            const res = await fetch(`/api/os/companies/${companyId}`);
            if (!res.ok) throw new Error(res.status === 404 ? 'Company not found' : `HTTP ${res.status}`);
            setDetail((await res.json()) as OsCompanyDetail);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'unknown');
        }
    }, [companyId]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        window.addEventListener('nucleas:voice-changed', load);
        window.addEventListener('nucleas:voice-generated', load);
        return () => {
            window.removeEventListener('nucleas:voice-changed', load);
            window.removeEventListener('nucleas:voice-generated', load);
        };
    }, [load]);

    if (!companyId) return <div className="p-4 text-sm text-text-secondary">No company selected.</div>;
    if (error) return <div className="p-4 text-sm text-red-400">{error}</div>;
    if (!detail) return <div className="p-4 text-sm text-text-secondary">Loading…</div>;

    const { company, projects, connections } = detail;
    const switcher = (compact: boolean) => <CompanySwitcher compact={compact} current={company} onSwitch={(next) => { setDetail(null); setFocusJobId(undefined); setSite(null); setCompanyId(next.id); }} />;
    const websites = company.websites?.length ? company.websites : company.domain ? [company.domain] : [];
    if (titleSlot && typeof document !== 'undefined') document.title = company.name;

    return (
        <div className="h-full overflow-y-auto p-5 space-y-5 text-text-primary">
            <header className="flex items-start gap-3">
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
                                    ? <button type="button" onClick={() => { setSite(site === host ? null : host); setSection('performance'); }} aria-pressed={site === host} title={site === host ? 'Back to every website' : `Show only ${host}`}
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
                <div className="flex flex-col gap-2">
                    <CompanyContentButton companyId={company.id} companyName={company.name} />
                    <details className="text-xs">
                    <summary className="cursor-pointer text-text-secondary">Brand and planning</summary>
                    <div className="mt-2 flex flex-wrap gap-2">
                    <VoiceButton companyId={company.id} companyName={company.name} status={detail.voiceStatus ?? 'none'} />
                    <PropertyOverviewButton companyId={company.id} companyName={company.name} canManage={detail.canManage} />
                    <MarketingPlanButton companyId={company.id} companyName={company.name} />
                    <AskButton companyId={company.id} companyName={company.name} />
                    </div>
                    </details>
                </div>
            </header>

            <nav aria-label="Company workspace" className="sticky top-0 z-10 flex gap-1 rounded-xl border border-border bg-background p-1">
                {[['performance', 'Performance'], ['team', 'Team'], ['activity', 'Activity'], ['about', 'About'], ['setup', 'Setup']].map(([id, label]) => <button key={id} aria-pressed={section === id} onClick={() => setSection(id)} className={`flex-1 rounded-lg px-3 py-2 text-sm ${section === id ? 'bg-primary/15 text-primary font-medium' : 'text-text-secondary hover:bg-background-card'}`}>{label}</button>)}
            </nav>
            {section === 'about' && <CompanyAbout key={company.id} companyId={company.id} companyName={company.name}
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
                    <WebsitesEditor
                        companyId={company.id}
                        websites={websites}
                        canManage={detail.canManage}
                        onSaved={(sites) => {
                            setDetail((current) => current ? { ...current, company: { ...current.company, domain: sites[0], websites: sites } } : current);
                            setActivityKey((key) => key + 1);
                        }}
                    />
                </>} />}
            {section === 'team' && <CompanyTeamPanel key={`${company.id}:${focusJobId ?? ''}`} companyId={company.id} companyName={company.name} focusJobId={focusJobId} />}
            {section === 'performance' && <CompanySnapshot
                key={company.id}
                companyId={company.id}
                site={site}
                onAllSites={() => setSite(null)}
                connections={connections.filter((c) => c.status === 'connected')}
                aiCitations={detail.stats?.aiCitations ?? 0}
                aiCitationSeries={detail.stats?.aiCitationSeries ?? []}
                onActivity={() => setActivityKey((k) => k + 1)}
            />}
            {section === 'setup' && <section className="ui-card p-3">
            <h3 className="text-sm font-medium">Connections and setup</h3>
            <div className="mt-3 space-y-4">
            <ProjectsSection projects={projects} />
            <CodeRepositories companyId={company.id} compact />
            <AdminAccount companyId={company.id} defaultDomain={company.domain} />
            <WebsiteConnectionPanel companyId={company.id} domain={company.domain} />
            <IntegrationsSummary companyId={company.id} companyName={company.name} connections={connections} />
            <AccountWebsites companyId={company.id} websites={websites} connections={connections} canManage={detail.canManage} onSaved={() => void load()} />
            </div>
            </section>}
            {section === 'activity' && <CompanyTimeline key={company.id} companyId={company.id} refreshKey={activityKey} onOpenJob={(jobId) => { setFocusJobId(jobId); setSection('team'); }} />}
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

const VOICE_INDICATOR = {
    approved: { dot: 'bg-emerald-400', label: 'Voice: approved. Content tools write in it.' },
    draft: { dot: 'bg-red-400', label: 'Voice: a draft exists but is not approved yet, so content tools do not use it.' },
    none: { dot: 'bg-red-400', label: 'Voice: not set up yet. Content tools have no brand voice to write in.' },
} as const;

/** Opens the company's Voice. The dot is green once a Voice is approved, red until then. */
function VoiceButton({ companyId, companyName, status }: { companyId: string; companyName: string; status: 'approved' | 'draft' | 'none' }) {
    const wm = useWindowManager();
    const indicator = VOICE_INDICATOR[status];
    return (
        <button type="button" title={indicator.label} onClick={(e) => { e.stopPropagation(); wm.open('brand-voice', { payload: { companyId, companyName } }); }} className="ui-button flex-shrink-0 inline-flex items-center gap-1.5">
            <span aria-hidden className={`h-2 w-2 rounded-full ${indicator.dot}`} />
            Brand voice
            <span className="sr-only">{indicator.label}</span>
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

function MarketingPlanButton({ companyId, companyName }: { companyId: string; companyName: string }) {
    const wm = useWindowManager();
    return <button type="button" onClick={(e) => { e.stopPropagation(); wm.open('marketing', { payload: { companyId, companyName, kind: 'marketing_plan' } }); }} className="ui-button flex-shrink-0">Marketing plan</button>;
}

function CompanyContentButton({ companyId, companyName }: { companyId: string; companyName: string }) {
    const wm = useWindowManager();
    return <button type="button" className="ui-button-primary" onClick={() => wm.open('content', { payload: { companyId, companyName, tab: 'updates' } })}>Create content</button>;
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
