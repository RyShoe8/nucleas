'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';

type Overview = { id: string; rootUrl: string; status: 'queued' | 'crawling' | 'complete' | 'failed'; progress?: string; error?: string; pageCount: number; edgeCount: number; issueCount: number; clusters: { templateKey: string; count: number; sampleRoutes: string[] }[]; summary: { orphanPages?: number; errorPages?: number; templates?: number }; createdAt: string; completedAt?: string };
type Page = { id: string; url: string; routePattern: string; statusCode?: number; title?: string; description?: string; canonical?: string; robots?: string; language?: string; h1?: string[]; h2?: string[]; h3?: string[]; wordCount?: number; internalLinks?: string[]; externalLinks?: string[]; incomingLinks?: number; imageCount?: number; imagesMissingAlt?: number; structuredDataTypes?: string[]; templateKey?: string; issues?: string[]; indexable?: boolean; datePublished?: string; dateModified?: string; renderMode?: 'html' | 'rendered'; renderedText?: string };

export default function PropertyOverviewButton({ companyId, companyName, canManage }: { companyId: string; companyName: string; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={(event) => { event.stopPropagation(); setOpen(true); }} className="ui-button flex-shrink-0">Property overview</button>{open ? <PropertyOverviewModal companyId={companyId} companyName={companyName} canManage={canManage} onClose={() => setOpen(false)} /> : null}</>;
}

function PropertyOverviewModal({ companyId, companyName, canManage, onClose }: { companyId: string; companyName: string; canManage: boolean; onClose: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'summary' | 'pages' | 'templates' | 'links'>('summary');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Page | null>(null);
  const load = useCallback(async () => {
    const response = await fetch(`/api/os/companies/${companyId}/property-overview`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({})) as { overview?: Overview | null; pages?: Page[]; error?: string };
    if (!response.ok) return setError(data.error ?? `Failed (${response.status})`);
    setOverview(data.overview ?? null); setPages(data.pages ?? []); setError(null);
  }, [companyId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!overview || !['queued', 'crawling'].includes(overview.status)) return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [overview, load]);
  async function run() {
    setBusy(true); setError(null);
    const response = await fetch(`/api/os/companies/${companyId}/property-overview`, { method: 'POST' });
    const data = await response.json().catch(() => ({})) as { overview?: Overview; error?: string };
    setBusy(false);
    if (!response.ok || !data.overview) return setError(data.error ?? `Failed (${response.status})`);
    setOverview(data.overview); setPages([]);
  }
  const filtered = useMemo(() => pages.filter((page) => `${page.url} ${page.title ?? ''} ${(page.issues ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase())), [pages, query]);
  const issuePages = pages.filter((page) => page.issues?.length).length;
  return <Modal isOpen onClose={onClose} title={`Property overview · ${companyName}`} maxWidth="6xl" appearance="theme">
    <div className="space-y-4 text-text-primary">
      <div className="flex flex-wrap items-center gap-2">
        {(['summary', 'pages', 'templates', 'links'] as const).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={tab === item ? 'ui-button-primary' : 'ui-button'}>{item === 'summary' ? 'Overview' : item[0].toUpperCase() + item.slice(1)}</button>)}
        <span className="flex-1" />
        {canManage ? <button type="button" onClick={() => void run()} disabled={busy || overview?.status === 'queued' || overview?.status === 'crawling'} className="ui-button-primary">{overview ? 'Run new crawl' : 'Generate report'}</button> : null}
      </div>
      {error ? <p className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}
      {!overview ? <div className="ui-card p-8 text-center"><h3 className="font-medium">No property report yet</h3><p className="mt-2 text-sm text-text-secondary">Crawl the production website to archive its pages, audit technical SEO, group templates, and map internal links.</p></div> : null}
      {overview && ['queued', 'crawling'].includes(overview.status) ? <div className="ui-card p-5"><p className="font-medium">Crawling {overview.rootUrl}</p><p className="mt-1 text-sm text-text-secondary">{overview.progress ?? 'Starting…'}</p><div className="mt-3 h-1.5 overflow-hidden rounded bg-background"><div className="h-full w-2/3 animate-pulse rounded bg-primary" /></div></div> : null}
      {overview?.status === 'failed' ? <div className="ui-card p-4"><p className="font-medium text-red-300">Crawl failed</p><p className="mt-1 text-sm text-text-secondary">{overview.error}</p></div> : null}
      {overview?.status === 'complete' && tab === 'summary' ? <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{[[overview.pageCount, 'Pages archived'], [overview.edgeCount, 'Internal links'], [overview.issueCount, 'SEO findings'], [overview.summary.templates ?? 0, 'Templates'], [overview.summary.orphanPages ?? 0, 'Orphan pages']].map(([value, label]) => <div key={String(label)} className="ui-card p-4"><p className="text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-text-secondary">{label}</p></div>)}</div>
        <div className="ui-card p-4"><h3 className="ui-kicker">Crawl coverage</h3><dl className="mt-3 grid gap-3 text-sm md:grid-cols-2"><div><dt className="text-text-secondary">Property</dt><dd><a href={overview.rootUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{overview.rootUrl}</a></dd></div><div><dt className="text-text-secondary">Completed</dt><dd>{overview.completedAt ? new Date(overview.completedAt).toLocaleString() : '—'}</dd></div><div><dt className="text-text-secondary">Pages with findings</dt><dd>{issuePages} of {overview.pageCount}</dd></div><div><dt className="text-text-secondary">Error pages</dt><dd>{overview.summary.errorPages ?? 0}</dd></div></dl></div>
      </div> : null}
      {overview?.status === 'complete' && tab === 'pages' ? <div className="space-y-3"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter URLs, titles, or issues…" className="ui-control w-full" /><div className="max-h-[55vh] space-y-2 overflow-y-auto">{filtered.map((page) => <button type="button" key={page.id} onClick={() => setSelected(page)} className="ui-card block w-full p-3 text-left hover:border-primary/50"><div className="flex gap-2"><span className={`text-xs font-semibold ${(page.statusCode ?? 0) >= 400 ? 'text-red-300' : 'text-emerald-300'}`}>{page.statusCode ?? 'ERR'}</span><span className="min-w-0 flex-1 truncate text-sm font-medium">{page.title || page.url}</span><span className="text-xs text-text-secondary">{page.wordCount ?? 0} words · {page.incomingLinks ?? 0} in</span></div><p className="mt-1 truncate text-xs text-text-secondary">{page.url}</p>{page.issues?.length ? <p className="mt-2 text-xs text-amber-300">{page.issues.join(' · ')}</p> : null}</button>)}</div></div> : null}
      {overview?.status === 'complete' && tab === 'templates' ? <div className="space-y-2">{overview.clusters.map((cluster, index) => <div key={cluster.templateKey} className="ui-card p-4"><div className="flex items-center justify-between"><h3 className="font-medium">Template {index + 1}</h3><span className="text-sm text-text-secondary">{cluster.count} pages</span></div><div className="mt-2 flex flex-wrap gap-1.5">{cluster.sampleRoutes.map((route) => <span key={route} className="rounded border border-border bg-background px-2 py-1 text-xs">{route}</span>)}</div></div>)}</div> : null}
      {overview?.status === 'complete' && tab === 'links' ? <div className="max-h-[60vh] space-y-2 overflow-y-auto">{pages.map((page) => <details key={page.id} className="ui-card p-3"><summary className="cursor-pointer text-sm font-medium">{page.routePattern} <span className="text-text-secondary">· {(page.internalLinks ?? []).length} outgoing · {page.incomingLinks ?? 0} incoming</span></summary><ul className="mt-2 space-y-1 pl-4 text-xs text-text-secondary">{(page.internalLinks ?? []).map((link) => <li key={link} className="truncate">→ {link}</li>)}</ul></details>)}</div> : null}
    </div>
    {selected ? <PageDetail page={selected} onClose={() => setSelected(null)} /> : null}
  </Modal>;
}

function PageDetail({ page, onClose }: { page: Page; onClose: () => void }) {
  const rows: [string, string][] = [['URL', page.url], ['Evidence', page.renderMode === 'rendered' ? 'Rendered with Playwright plus archived HTML' : 'Archived server HTML'], ['Title', page.title || 'Missing'], ['Meta description', page.description || 'Missing'], ['Canonical', page.canonical || 'Missing'], ['Robots', page.robots || 'Default'], ['Language', page.language || 'Missing'], ['Indexable', page.indexable === false ? 'No' : 'Yes'], ['Words', String(page.wordCount ?? 0)], ['Images', `${page.imageCount ?? 0} (${page.imagesMissingAlt ?? 0} missing alt)`], ['H1', page.h1?.join(' · ') || 'Missing'], ['H2', page.h2?.join(' · ') || 'None'], ['Schema', page.structuredDataTypes?.join(', ') || 'None'], ['Issues', page.issues?.join(' · ') || 'None']];
  return <Modal isOpen onClose={onClose} title={page.title || page.routePattern} maxWidth="4xl" appearance="theme"><dl className="ui-card ui-divider-list overflow-hidden">{rows.map(([label, value]) => <div key={label} className="grid gap-1 p-3 md:grid-cols-[10rem_1fr]"><dt className="ui-kicker">{label}</dt><dd className="break-words text-sm">{value}</dd></div>)}</dl></Modal>;
}
