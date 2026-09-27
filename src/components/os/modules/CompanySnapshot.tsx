'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useOsAuth } from '@/hooks/os/useOsAuth';
import type { OsConnection } from './companyTypes';

/** Mirrors the server InvocationView fields the UI needs. */
export interface OsInvocation {
    id: string;
    capabilityId: string;
    title: string;
    kind: 'read' | 'write';
    providerName: string;
    status: string;
    summary?: string;
    error?: string;
    output?: unknown;
    resource?: { label?: string; externalUrl?: string };
    verified?: boolean;
    approvalId?: string;
    requestedBy: 'user' | 'ai';
    createdAt: string;
    cached?: boolean;
}

export async function invoke(companyId: string, capabilityId: string, input: unknown = {}): Promise<OsInvocation | { error: string }> {
    const res = await fetch(`/api/os/companies/${companyId}/capabilities/${capabilityId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input }),
    });
    const data = (await res.json().catch(() => ({}))) as { invocation?: OsInvocation; error?: string };
    return data.invocation ?? { error: data.error ?? `Failed (${res.status})` };
}

const nf = new Intl.NumberFormat('en-US');
function num(n: number | null | undefined) {
    return n == null ? '–' : nf.format(Math.round(n));
}
function money(minorByCurrency: Record<string, number> | undefined): string {
    const entries = Object.entries(minorByCurrency ?? {}).filter(([, v]) => v !== 0);
    if (entries.length === 0) return '$0';
    return entries
        .map(([cur, v]) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: 0 }).format(v / 100))
        .join(' + ');
}

const STATUS_MESSAGE: Record<string, string> = {
    needs_setup: 'Needs setup',
    plan_limited: 'Limited by provider plan',
    needs_reauth: 'Reconnect needed',
    failed: 'Could not load',
};

function useCapability(companyId: string, capabilityId: string, input: unknown, enabled: boolean) {
    const [state, setState] = useState<OsInvocation | { error: string } | null>(null);
    const key = JSON.stringify(input);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        void invoke(companyId, capabilityId, JSON.parse(key)).then((result) => {
            if (!cancelled) setState(result);
        });
        return () => {
            cancelled = true;
        };
    }, [enabled, companyId, capabilityId, key]);
    return { state };
}

function Tile({ title, source, children, action }: { title: string; source: string; children: ReactNode; action?: ReactNode }) {
    return (
        <div className="rounded-md border border-border p-3 min-w-0">
            <div className="flex items-baseline justify-between gap-2 mb-2">
                <h4 className="text-xs font-medium text-text-primary">{title}</h4>
                <span className="text-[10px] text-text-secondary">{source}</span>
            </div>
            {children}
            {action ? <div className="mt-2">{action}</div> : null}
        </div>
    );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="min-w-0">
            <div className="text-lg font-semibold tabular-nums leading-tight truncate" title={hint}>
                {value}
            </div>
            <div className="text-[11px] text-text-secondary truncate">{label}</div>
        </div>
    );
}

function Body<O>({ state, render }: { state: OsInvocation | { error: string } | null; render: (output: O) => ReactNode }) {
    if (state === null) return <p className="text-xs text-text-secondary">Loading…</p>;
    if ('error' in state && !('id' in state)) return <p className="text-xs text-red-400">{state.error}</p>;
    const inv = state as OsInvocation;
    if (inv.status !== 'succeeded' && inv.status !== 'verified') {
        return (
            <p className={`text-xs ${inv.status === 'failed' ? 'text-red-400' : 'text-amber-400'}`}>
                {STATUS_MESSAGE[inv.status] ?? inv.status}
                {inv.error ? <span className="text-text-secondary">: {inv.error}</span> : null}
            </p>
        );
    }
    return <>{render(inv.output as O)}</>;
}

type Traffic = { totals: { sessions: number; users: number; pageViews: number }; topChannels: { channel: string; sessions: number }[] };
type Search = { totals: { clicks: number; impressions: number; ctr: number; position: number }; topQueries: { query: string; clicks: number }[] };
type Email = { totalContacts: number; newContacts: number };
type Revenue = { net: Record<string, number>; payments: number; newCustomers: number; activeSubscriptions: number; mrr: Record<string, number>; truncated: boolean };
type Cash = { totalAvailable: number; accounts: { name: string; available: number }[] };
type Seo = { domainRating: number | null; organicTraffic: number | null; organicKeywords: number | null; top3Keywords: number | null };

const DAYS = 28;

export default function CompanySnapshot({
    companyId,
    connections,
    onActivity,
}: {
    companyId: string;
    connections: OsConnection[];
    onActivity: () => void;
}) {
    const auth = useOsAuth();
    const has = (provider: string) => connections.some((c) => c.provider === provider);
    const traffic = useCapability(companyId, 'analytics.traffic.read', { days: DAYS }, has('ga4'));
    const search = useCapability(companyId, 'search.performance.read', { days: DAYS }, has('gsc'));
    const email = useCapability(companyId, 'email.audience.read', { days: DAYS }, has('brevo'));
    const revenue = useCapability(companyId, 'payments.revenue.read', { days: DAYS }, has('stripe'));
    const seo = useCapability(companyId, 'seo.overview.read', {}, has('ahrefs'));
    const [showCash, setShowCash] = useState(false);
    const cash = useCapability(companyId, 'finance.cash.read', {}, has('mercury') && showCash);
    const [seoSetup, setSeoSetup] = useState<string | null>(null);

    if (!['ga4', 'gsc', 'brevo', 'stripe', 'ahrefs', 'mercury'].some(has)) return null;

    const setUpSeo = async () => {
        setSeoSetup('Working…');
        const res = await invoke(companyId, 'seo.project.create');
        setSeoSetup('error' in res && !('id' in res) ? res.error : ((res as OsInvocation).summary ?? (res as OsInvocation).error ?? (res as OsInvocation).status));
        onActivity();
    };

    return (
        <section>
            <h3 className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">Last {DAYS} days</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {has('ga4') ? (
                    <Tile title="Traffic" source="Google Analytics">
                        <Body<Traffic>
                            state={traffic.state}
                            render={(o) => (
                                <>
                                    <div className="grid grid-cols-3 gap-2">
                                        <Stat label="Sessions" value={num(o.totals.sessions)} />
                                        <Stat label="Users (daily sum)" value={num(o.totals.users)} hint="Sum of daily users; returning visitors count once per day" />
                                        <Stat label="Page views" value={num(o.totals.pageViews)} />
                                    </div>
                                    {o.topChannels.length ? (
                                        <p className="mt-2 text-[11px] text-text-secondary truncate">
                                            {o.topChannels.slice(0, 3).map((c) => `${c.channel} ${num(c.sessions)}`).join(' · ')}
                                        </p>
                                    ) : null}
                                </>
                            )}
                        />
                    </Tile>
                ) : null}
                {has('gsc') ? (
                    <Tile title="Search" source="Search Console">
                        <Body<Search>
                            state={search.state}
                            render={(o) => (
                                <>
                                    <div className="grid grid-cols-4 gap-2">
                                        <Stat label="Clicks" value={num(o.totals.clicks)} />
                                        <Stat label="Impressions" value={num(o.totals.impressions)} />
                                        <Stat label="CTR" value={`${o.totals.ctr}%`} />
                                        <Stat label="Avg position" value={String(o.totals.position || '–')} />
                                    </div>
                                    {o.topQueries.length ? (
                                        <p className="mt-2 text-[11px] text-text-secondary truncate">
                                            Top: {o.topQueries.slice(0, 3).map((q) => q.query).join(' · ')}
                                        </p>
                                    ) : null}
                                </>
                            )}
                        />
                    </Tile>
                ) : null}
                {has('brevo') ? (
                    <Tile title="Email audience" source="Brevo">
                        <Body<Email>
                            state={email.state}
                            render={(o) => (
                                <div className="grid grid-cols-2 gap-2">
                                    <Stat label="Contacts" value={num(o.totalContacts)} />
                                    <Stat label={`New in ${DAYS} days`} value={num(o.newContacts)} />
                                </div>
                            )}
                        />
                    </Tile>
                ) : null}
                {has('stripe') ? (
                    <Tile title="Revenue" source="Stripe">
                        <Body<Revenue>
                            state={revenue.state}
                            render={(o) => (
                                <>
                                    <div className="grid grid-cols-3 gap-2">
                                        <Stat label="Net revenue" value={money(o.net)} />
                                        <Stat label="MRR" value={money(o.mrr)} />
                                        <Stat label="Active subs" value={num(o.activeSubscriptions)} />
                                    </div>
                                    <p className="mt-2 text-[11px] text-text-secondary">
                                        {num(o.payments)} payments · {num(o.newCustomers)} new customers
                                        {o.truncated ? ' · partial (very high volume)' : ''}
                                    </p>
                                </>
                            )}
                        />
                    </Tile>
                ) : null}
                {has('ahrefs') ? (
                    <Tile
                        title="SEO"
                        source="Ahrefs"
                        action={
                            auth.isManagerOrAdmin ? (
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={setUpSeo}
                                        className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card"
                                    >
                                        Set up SEO tracking
                                    </button>
                                    {seoSetup ? <span className="text-[11px] text-text-secondary truncate">{seoSetup}</span> : null}
                                </div>
                            ) : null
                        }
                    >
                        <Body<Seo>
                            state={seo.state}
                            render={(o) => (
                                <div className="grid grid-cols-4 gap-2">
                                    <Stat label="Domain rating" value={o.domainRating == null ? '–' : String(o.domainRating)} />
                                    <Stat label="Organic traffic" value={num(o.organicTraffic)} />
                                    <Stat label="Keywords" value={num(o.organicKeywords)} />
                                    <Stat label="Top 3" value={num(o.top3Keywords)} />
                                </div>
                            )}
                        />
                    </Tile>
                ) : null}
                {has('mercury') ? (
                    <Tile title="Cash" source="Mercury">
                        {showCash ? (
                            <Body<Cash>
                                state={cash.state}
                                render={(o) => (
                                    <>
                                        <Stat label="Available across accounts" value={money({ usd: Math.round(o.totalAvailable * 100) })} />
                                        <p className="mt-2 text-[11px] text-text-secondary truncate">
                                            {o.accounts.map((a) => `${a.name} ${money({ usd: Math.round(a.available * 100) })}`).join(' · ')}
                                        </p>
                                        <button type="button" onClick={() => setShowCash(false)} className="mt-1 text-[11px] text-text-secondary hover:text-text-primary">
                                            Hide
                                        </button>
                                    </>
                                )}
                            />
                        ) : (
                            <button
                                type="button"
                                onClick={() => setShowCash(true)}
                                className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-background-card"
                            >
                                Show balances
                            </button>
                        )}
                    </Tile>
                ) : null}
            </div>
        </section>
    );
}
