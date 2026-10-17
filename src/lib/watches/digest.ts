import 'server-only';
import { Types } from 'mongoose';
import { ContentWatch, WatchItem } from '@/lib/models/Watch';
import { ArticleDraft } from '@/lib/models/ArticleDraft';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { upstreamContext } from '@/lib/companies/upstreamContext';
import { formatDealLine } from './dealFormat';
import { compareByRank, valueLines, watchSettings } from './settings';
import type { DealMetrics } from './types';

/**
 * Digests: a newsletter or roundup in the company's Voice, written from what a watch flagged over a period
 * (a day or a week). The flagged emails become the article's researched facts, ranked by the watch's
 * ranking, so the existing article pipeline outlines, drafts and checks it like any other article and it
 * lands in Content → Articles. A period is claimed before anything is written, so two runs never write
 * the same digest twice.
 */

const CADENCE_MS = { daily: 86_400_000, weekly: 7 * 86_400_000 } as const;
/** Due a little early, so a cron that runs every 15 minutes never slips a whole period. */
const DUE_SLACK_MS = 30 * 60_000;

type DigestWatch = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  createdByUserId: Types.ObjectId;
  companyId?: Types.ObjectId;
  name: string;
  description?: string;
  noun?: string;
  mode?: string;
  rank?: string;
  threshold?: number;
  minDiscountPct?: number;
  fields?: unknown;
  digest?: { enabled?: boolean; cadence?: string; maxItems?: number; lastRunAt?: Date };
};

type DigestItem = { _id: Types.ObjectId; subject?: string; fromName?: string; summary?: string; values?: Record<string, string>; bestDeal?: DealMetrics; link?: string; sentAt?: Date; score?: number };

export type DigestOutcome = { ok: true; articleId: string; items: number } | { ok: false; error: string };

const cadenceOf = (w: DigestWatch) => (w.digest?.cadence === 'daily' ? 'daily' : 'weekly');

function periodLabel(cadence: 'daily' | 'weekly', since: Date, now: Date): string {
  const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return cadence === 'daily' ? day(now) : `${day(since)} to ${day(now)}`;
}

/** One flagged email as a fact the article may state: what it is, its collected values, and its offer. */
export function itemFact(item: DigestItem, fields: ReturnType<typeof watchSettings>['fields']): string {
  return [
    `${item.subject || 'Untitled'}${item.fromName ? ` (from ${item.fromName})` : ''}.`,
    item.summary ?? '',
    valueLines(item.values, fields).join('; '),
    item.bestDeal ? `Offer: ${formatDealLine(item.bestDeal)}.` : '',
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 600);
}

/**
 * Starts the digest for a watch's current period. Scheduled runs advance the period even when nothing was
 * flagged; a manual run ("Write digest now") covers the same period without moving it if there is nothing.
 */
export async function startDigest(watchId: Types.ObjectId | string, options: { manual?: boolean; now?: Date } = {}): Promise<DigestOutcome> {
  const now = options.now ?? new Date();
  const watch = await ContentWatch.findById(watchId).lean<DigestWatch>();
  if (!watch) return { ok: false, error: 'Watch not found.' };
  if (!watch.companyId) return { ok: false, error: 'Choose a company for this watch first, so the digest is written in its Voice.' };
  const fail = async (error: string) => {
    await ContentWatch.updateOne({ _id: watch._id }, { $set: { 'digest.lastError': error.slice(0, 300) } });
    return { ok: false as const, error };
  };
  const voice = await BrandVoice.exists({ organizationId: watch.organizationId, companyId: watch.companyId, status: 'approved' });
  if (!voice) return fail('Approve this company’s Voice first, so the digest sounds like the brand.');

  const cadence = cadenceOf(watch);
  const previous = watch.digest?.lastRunAt ?? null;
  const since = previous ?? new Date(now.getTime() - CADENCE_MS[cadence]);
  const settings = watchSettings(watch);
  const rows = await WatchItem.find({ watchId: watch._id, flagged: true, sentAt: { $gt: since, $lte: now } })
    .select('_id subject fromName summary values bestDeal link sentAt score')
    .sort({ sentAt: -1 })
    .limit(300)
    .lean<DigestItem[]>();
  const items = rows.sort(compareByRank(settings.rank)).slice(0, watch.digest?.maxItems ?? 10);

  if (!items.length) {
    if (!options.manual) await ContentWatch.updateOne({ _id: watch._id, 'digest.lastRunAt': previous }, { $set: { 'digest.lastRunAt': now }, $unset: { 'digest.lastError': '' } });
    return { ok: false, error: `Nothing was flagged since ${since.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, so there is no digest to write.` };
  }

  // Claim the period: only the run that moves lastRunAt from what it read writes this digest.
  const claimed = await ContentWatch.updateOne({ _id: watch._id, 'digest.lastRunAt': previous }, { $set: { 'digest.lastRunAt': now }, $unset: { 'digest.lastError': '' } });
  if (!claimed.modifiedCount) return { ok: false, error: 'This digest is already being written.' };

  const noun = watch.noun || (settings.rank === 'discount' ? 'deal' : 'item');
  const strategy = await upstreamContext(watch.organizationId, watch.companyId).catch(() => '');
  const facts = items.map((item) => ({ text: itemFact(item, settings.fields), source: item.link ?? '' }));
  const links = items.filter((i) => i.link).slice(0, 12).map((i) => ({ url: i.link!, anchor: (i.subject ?? '').slice(0, 80) }));
  const notes = [
    `This is a ${cadence} roundup newsletter (a digest) of the ${items.length} ${noun}${items.length === 1 ? '' : 's'} the "${watch.name}" watch collected${watch.description ? `: ${watch.description}` : ''}.`,
    `The facts are listed ${settings.rank === 'discount' ? 'biggest offer first' : settings.rank === 'newest' ? 'newest first' : 'most important first'}; keep that order. Give each ${noun} its own short section with its key details and its link; with more than 7, group them under a few themed headings. Open with two or three sentences on what stood out this period, and close with one line looking ahead. Report only what the facts say.`,
    strategy ? `Company strategy (stay on it; never state it as fact):\n${strategy}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 3000);

  try {
    const doc = await ArticleDraft.create({
      organizationId: watch.organizationId,
      companyId: watch.companyId,
      createdByUserId: watch.createdByUserId,
      topic: `${watch.name}: ${periodLabel(cadence, since, now)}`.slice(0, 300),
      notes,
      targetWords: Math.min(1800, Math.max(400, 150 + items.length * 120)),
      faq: false,
      links,
      // The flagged emails are the research: skip the web search and start at the outline.
      stage: 'outline',
      facts,
      sourcesUsed: [...new Set(links.map((l) => l.url))],
      researchNote: `${items.length} ${noun}${items.length === 1 ? '' : 's'} from the “${watch.name}” watch.`,
      kind: 'digest',
      watchId: watch._id,
      digestItemIds: items.map((i) => i._id),
    });
    await ContentWatch.updateOne({ _id: watch._id }, { $set: { 'digest.lastArticleId': doc._id } });
    return { ok: true, articleId: String(doc._id), items: items.length };
  } catch (error) {
    // Give the period back so the next run tries again.
    await ContentWatch.updateOne({ _id: watch._id, 'digest.lastRunAt': now }, { $set: { 'digest.lastRunAt': previous } });
    return fail(error instanceof Error ? `The digest could not be started: ${error.message}` : 'The digest could not be started.');
  }
}

/** Digests whose period has passed (for the cron). The article pipeline then writes them on its next pass. */
export async function startDueDigests(options: { now?: Date; limit?: number } = {}): Promise<{ started: number }> {
  const now = options.now ?? new Date();
  const rows = await ContentWatch.find({ active: true, 'digest.enabled': true, companyId: { $exists: true } })
    .select('_id digest')
    .limit(100)
    .lean<{ _id: Types.ObjectId; digest?: { cadence?: string; lastRunAt?: Date } }[]>();
  const due = rows.filter((w) => {
    const last = w.digest?.lastRunAt?.getTime();
    const period = CADENCE_MS[w.digest?.cadence === 'daily' ? 'daily' : 'weekly'];
    return last == null || now.getTime() - last >= period - DUE_SLACK_MS;
  });
  let started = 0;
  for (const w of due.slice(0, options.limit ?? 3)) {
    const outcome = await startDigest(w._id, { now }).catch(() => ({ ok: false as const, error: 'failed' }));
    if (outcome.ok) started += 1;
  }
  return { started };
}
