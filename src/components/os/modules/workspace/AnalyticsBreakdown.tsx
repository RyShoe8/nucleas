'use client';
import { useState } from 'react';
import type { TrafficOutput, SearchOutput } from '@/lib/capabilities/adapters/google';
import type { SearchOpportunitiesOutput } from '@/lib/capabilities/adapters/searchOpportunities';
export default function AnalyticsBreakdown({ companyId, days, traffic, search }: { companyId: string; days: number; traffic: boolean; search: boolean }) {
    const [result, setResult] = useState<TrafficOutput | SearchOutput | SearchOpportunitiesOutput | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    async function load(capability: string) {
        setBusy(true); setResult(null); setError('');
        try {
            const r = await fetch(`/api/os/companies/${companyId}/capabilities/${capability}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: { days } }) });
            const body = await r.json(); const receipt = body.invocation;
            if (!r.ok || !['succeeded', 'verified'].includes(receipt?.status)) throw Error(receipt?.error ?? body.error ?? 'The provider could not return this breakdown.');
            setResult(receipt.output);
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }
    const table = (title: string, headers: string[], rows: (string | number)[][]) => <section className="space-y-2"><h4 className="font-medium">{title}</h4>{!rows.length ? <p className="text-xs text-text-secondary">No rows returned for this report.</p> : <div className="overflow-auto max-h-96 border border-border rounded-xl"><table className="w-full text-sm"><thead><tr>{headers.map(h => <th key={h} className="sticky top-0 bg-background text-left p-2">{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-t border-border">{row.map((v, j) => <td key={j} className="p-2 break-words max-w-96 tabular-nums">{typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v}</td>)}</tr>)}</tbody></table></div>}</section>;
    return <section className="space-y-4 rounded-xl border border-border p-4"><div><h3 className="font-medium">Explore the underlying performance</h3><p className="text-xs text-text-secondary">Read the connected provider on demand. Search Console can lag behind traffic reporting; the returned dates below are authoritative. These are top rows, not a full export of the provider.</p></div>
        <div className="flex gap-2 flex-wrap">{traffic && <button disabled={busy} className="ui-button" onClick={() => void load('analytics.traffic.read')}>Acquisition channels</button>}{search && <><button disabled={busy} className="ui-button" onClick={() => void load('search.performance.read')}>Search queries</button><button disabled={busy} className="ui-button" onClick={() => void load('search.opportunities.read')}>Pages & SEO opportunities</button></>}</div>
        {busy && <p>Reading connected data…</p>}{error && <p role="alert" className="text-amber-300">{error}</p>}
        {result && <p className="text-xs text-text-secondary">{result.startDate} → {result.endDate} · {'propertyId' in result ? `GA4 property ${result.propertyId}` : `Search Console · ${result.siteUrl}`}</p>}
        {result && 'topChannels' in result && table('Acquisition channels', ['Channel', 'Sessions'], result.topChannels.map(r => [r.channel, r.sessions]))}
        {result && 'topQueries' in result && table('Search queries', ['Query', 'Clicks', 'Impressions', 'Average position'], result.topQueries.map(r => [r.query, r.clicks, r.impressions, r.position]))}
        {result && 'strikingDistance' in result && <>{table('Queries with an opportunity to improve', ['Query', 'Page', 'Position', 'Impressions', 'Clicks'], result.strikingDistance.map(r => [r.query, r.page, r.position, r.impressions, r.clicks]))}{table('Pages losing clicks', ['Page', 'Clicks', 'Previous clicks', 'Change %'], result.decliningPages.map(r => [r.page, r.clicks, r.previousClicks, r.changePct]))}{table('Queries split across pages', ['Query', 'Page', 'Impressions', 'Clicks'], result.competingPages.flatMap(r => r.pages.map(p => [r.query, p.page, p.impressions, p.clicks])))}</>}
    </section>;
}
