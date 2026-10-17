import 'server-only';
import { Types } from 'mongoose';
import { ArticleDraft } from '@/lib/models/ArticleDraft';
import { PropertyOverview } from '@/lib/models/PropertyOverview';
import { listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import { listWatches } from '@/lib/watches/watches';
import { listBuilds } from '@/lib/building/builds';

/**
 * Everything Nucleas is doing outside of jobs, as one list for the Jobs window: inbox watches and their
 * scans, articles and digests being written, Building runs (code), and Company Overview crawls. Jobs is
 * the single live view of all activity, so any new kind of background work should be added here.
 * Each item says which group it belongs in and which window manages it.
 */

export type ActivityGroup = 'you' | 'working' | 'set' | 'failed';
export type ActivityKind = 'watch' | 'article' | 'build' | 'overview';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** Which windows show it besides Jobs: Marketing (marketing), Content (content); code and research only in Jobs. */
  category: 'marketing' | 'content' | 'building' | 'research';
  group: ActivityGroup;
  title: string;
  detail: string;
  status: string;
  companyId: string | null;
  companyName: string | null;
  open: { window: string; payload?: Record<string, string> };
}

const RECENT_FAILURE_MS = 7 * 86_400_000;

export function ago(date: Date | string | null | undefined, now = Date.now()): string {
  if (!date) return 'never';
  const mins = Math.round((now - new Date(date).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function nextIn(last: string | null, intervalMinutes: number, now = Date.now()): string {
  if (!last) return 'on the next check';
  const mins = Math.round((new Date(last).getTime() + intervalMinutes * 60_000 - now) / 60_000);
  return mins <= 0 ? 'on the next check' : mins < 60 ? `in ${mins} min` : `in ${Math.round(mins / 60)} h`;
}

async function watchItems(viewer: CompanyViewer): Promise<ActivityItem[]> {
  const watches = (await listWatches(viewer)) ?? [];
  return watches.filter((w) => w.active).map((w): ActivityItem => {
    const base = { id: `watch:${w.id}`, kind: 'watch' as const, category: 'marketing' as const, title: w.name, companyId: w.companyId, companyName: w.companyName, open: { window: 'marketing', payload: { view: 'inboxes' } } };
    if (w.scanning) return { ...base, group: 'working', status: 'Scanning', detail: `Inbox watch · ${w.scanProgress ?? `scanning ${w.mailboxEmail}`}` };
    if (w.lastScanOk === false) return { ...base, group: 'failed', status: 'Scan failed', detail: `Inbox watch · last scan failed ${ago(w.lastScanAt)}: ${w.lastScanError ?? 'unknown error'}` };
    const found = w.lastScanStats ? ` · ${w.lastScanStats.fresh} new, ${w.lastScanStats.flagged} flagged` : '';
    return { ...base, group: 'set', status: 'Watching', detail: `Inbox watch · last scan ${ago(w.lastScanAt)}${found} · next ${nextIn(w.lastScanAt, w.intervalMinutes)}${w.digest.enabled ? ` · ${w.digest.cadence} digest` : ''}` };
  });
}

async function articleItems(viewer: CompanyViewer, companies: Map<string, string>): Promise<ActivityItem[]> {
  const rows = await ArticleDraft.find({
    organizationId: viewer.organizationId,
    archived: false,
    companyId: { $in: [...companies.keys()].map((id) => new Types.ObjectId(id)) },
    $or: [{ status: { $in: ['queued', 'running'] } }, { status: 'failed', updatedAt: { $gt: new Date(Date.now() - RECENT_FAILURE_MS) } }],
  })
    .sort({ updatedAt: -1 })
    .limit(30)
    .select('_id companyId topic title status progress error kind')
    .lean<{ _id: Types.ObjectId; companyId: Types.ObjectId; topic: string; title?: string; status: string; progress?: string; error?: string; kind?: string }[]>();
  return rows.map((a) => {
    const label = a.kind === 'digest' ? 'Digest' : 'Article';
    const failed = a.status === 'failed';
    return {
      id: `article:${a._id}`, kind: 'article', category: 'content', group: failed ? 'failed' : 'working',
      title: a.title || a.topic, status: failed ? 'Failed' : 'Writing',
      detail: failed ? `${label} · ${a.error ?? 'The run failed.'}` : `${label} · ${a.progress || 'Waiting to start'}`,
      companyId: String(a.companyId), companyName: companies.get(String(a.companyId)) ?? null,
      open: { window: 'content', payload: { tab: 'articles' } },
    };
  });
}

async function buildItems(viewer: CompanyViewer): Promise<ActivityItem[]> {
  const builds = await listBuilds(viewer);
  const out: ActivityItem[] = [];
  for (const b of builds) {
    const base = { id: `build:${b.id}`, kind: 'build' as const, category: 'building' as const, title: b.title || b.request, companyId: b.companyId, companyName: b.companyName, open: { window: 'building' } };
    const repo = b.repository.fullName;
    if (b.status === 'proposed') out.push({ ...base, group: 'you', status: 'Plan ready', detail: `Building · ${repo} · review the plan to start` });
    else if (b.status === 'queued') out.push({ ...base, group: 'working', status: 'Queued', detail: `Building · ${repo} · waiting for the build worker` });
    else if (b.status === 'building') out.push({ ...base, group: 'working', status: 'Building', detail: `Building · ${repo} · started ${ago(b.startedAt)}${b.attempts > 1 ? ` · attempt ${b.attempts}` : ''}` });
    else if (b.status === 'ready') out.push({ ...base, group: 'you', status: 'Ready', detail: `Building · ${repo} · ${b.result?.changedFiles.length ?? 0} files changed, review and open the pull request` });
    else if (b.status === 'failed') out.push({ ...base, group: 'failed', status: 'Failed', detail: `Building · ${repo} · ${b.error ?? b.result?.summary ?? 'The build failed.'}` });
  }
  return out;
}

async function overviewItems(viewer: CompanyViewer, companies: Map<string, string>): Promise<ActivityItem[]> {
  const rows = await PropertyOverview.find({
    organizationId: viewer.organizationId,
    companyId: { $in: [...companies.keys()].map((id) => new Types.ObjectId(id)) },
    $or: [{ status: { $in: ['queued', 'dispatching', 'crawling'] } }, { status: 'failed', updatedAt: { $gt: new Date(Date.now() - RECENT_FAILURE_MS) } }],
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('_id companyId rootUrl status progress error')
    .lean<{ _id: Types.ObjectId; companyId: Types.ObjectId; rootUrl?: string; status: string; progress?: string; error?: string }[]>();
  // A failure is old news once a newer overview of the same company is running.
  const running = new Set(rows.filter((r) => r.status !== 'failed').map((r) => String(r.companyId)));
  return rows
    .filter((r) => r.status !== 'failed' || !running.has(String(r.companyId)))
    .map((r) => {
      const companyName = companies.get(String(r.companyId)) ?? null;
      const failed = r.status === 'failed';
      const progress = r.progress ?? '';
      return {
        id: `overview:${r._id}`, kind: 'overview', category: 'research', group: failed ? 'failed' : 'working',
        title: `Company Overview${companyName ? ` · ${companyName}` : ''}`, status: failed ? 'Failed' : r.status === 'crawling' ? 'Crawling' : 'Starting',
        detail: failed ? `Crawl of ${r.rootUrl ?? 'the site'} failed: ${r.error ?? 'unknown error'}` : `Crawling ${r.rootUrl ?? 'the site'}${progress ? ` · ${progress}` : ''}`,
        companyId: String(r.companyId), companyName,
        open: { window: 'company', payload: { companyId: String(r.companyId), companyName: companyName ?? 'Company' } },
      } satisfies ActivityItem;
    });
}

/** All non-job activity the viewer can see. A source that fails is left out rather than failing the list. */
export async function listActivity(viewer: CompanyViewer): Promise<ActivityItem[]> {
  const companies = new Map((await listCompanyProfiles(viewer)).map((c) => [c.id, c.name]));
  const parts = await Promise.all([
    watchItems(viewer).catch(() => []),
    articleItems(viewer, companies).catch(() => []),
    buildItems(viewer).catch(() => []),
    overviewItems(viewer, companies).catch(() => []),
  ]);
  return parts.flat();
}
