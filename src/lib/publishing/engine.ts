import { applyAdminFieldRules, withDefaultEndDate } from './adminRules';
import { slugifyTitle } from '@/lib/blog/slugify';
import { retryDatabaseRead } from '@/lib/db/retryRead';
import { recipientOnlyItem } from '@/lib/watches/offerEligibility';
import { redditDealBlock, redditDealHistory, withRedditDealLock } from './redditDeals';
import { dealStrengthPct, gameplayRewardNotPurchase } from '@/lib/watches/dealMetrics';
import 'server-only';
import { Types } from 'mongoose';
import { Job, JobRun, type JobRunProgressStage } from '@/lib/models/Job';
import { PublishDelivery, PublishItem } from '@/lib/models/Publishing';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { ContentWatch, WatchItem } from '@/lib/models/Watch';
import { upstreamContext } from '@/lib/companies/upstreamContext';
import { valueLines as watchValueLines, watchSettings } from '@/lib/watches/settings';
import { IntegrationConnection } from '@/lib/models/Integration';
import { readConnectionCredential } from '@/lib/integrations/connections';
import { getCompanyProfile, loadCompanyViewer, type CompanyViewer } from '@/lib/companies/companyProfile';
import { askEngine } from '@/lib/ai/engine/ask';
import type { CostLevel } from '@/lib/ai/engine/select';
import { buildDealKey, formatDealLine } from '@/lib/watches/dealFormat';
import { adminSessionFor } from '@/lib/companies/adminAccount';
import type { DealMetrics } from '@/lib/watches/types';
import { heartbeatJobRun } from '@/lib/jobs/runLifecycle';
import type { JobRunOutput } from '@/lib/jobs/schema';
import { jobScheduleSchema } from '@/lib/jobs/schema';
import { nextScheduledAt } from '@/lib/jobs/schedule';
import { MANUAL_ONLY, PLATFORM_LABEL, SOCIAL_PLATFORMS, cadenceLabel, publishingConfigSchema, type AdminTarget, type PublishChannel, type PublishPlatform, type PublishingConfig } from './config';
import { addRecord, fillValues, valueLines, type AdminBrowser, type AdminSession } from './admin';
import { workerAdminBrowser } from './adminBrowser';
import { composePost, fallbackSocialDraft, relabelNewItemTitle, type Draft, type Writer } from './compose';
import type { FetchLike } from './fetchPublic';
import { readPageFacts, type PageFacts } from './pageFacts';
import { listSitePages } from './siteSource';
import { notifyPeople, type SendFn } from './notify';
import { PublishError, publishToBluesky, publishToFacebook, type PostInput } from './publishers';

/**
 * Runs publishing jobs. Each hourly run reads the job's source, keeps a record of every item it has
 * seen, writes one post per channel for each new item in the company's approved Voice, then posts it
 * (auto) or prepares a ready-to-post card (manual) and tells the people on the job's notify list.
 *
 * Safeguards: nothing that existed when the job was switched on is ever posted (the baseline); a burst
 * of "new" items (a site restructure) is recorded, not posted; an automatic post that fails becomes a
 * manual card instead of vanishing; and a post is marked as being published before the platform is
 * called, so a crash or retry can never post it twice.
 */

/** More new items than this in one check is treated as a site change, not a release. */
export const MAX_NEW_PER_RUN = 5;

export interface PublishDeps {
  fetcher?: FetchLike;
  write?: Writer;
  publish?: Partial<Record<PublishPlatform, (credential: string, input: PostInput) => Promise<{ url: string }>>>;
  send?: SendFn;
  /** The browser that opens the company's admin (the VPS worker by default). */
  admin?: AdminBrowser;
  /** The admin session to use instead of the saved one (tests). */
  adminSession?: AdminSession | null;
}

/** The same deal sent in several emails within this window is added once. */
const DEDUPE_DAYS = 14;

const DEFAULT_PUBLISHERS: Record<string, (credential: string, input: PostInput, fetcher?: FetchLike) => Promise<{ url: string }>> = {
  bluesky: publishToBluesky,
  facebook: publishToFacebook,
};

interface SourceEntry {
  key: string;
  url: string | null;
  title: string;
  date: Date | null;
  /** Emails: who sent it and which offer it is, so a repeat of the same deal is recognized. */
  dedupe?: string | null;
}

interface ItemFacts {
  editorialText?: string;
  dealValuePct?: number;
  title: string;
  description: string;
  text: string;
  image: string | null;
  images: string[];
  video: string | null;
  extra: string[];
  link: string | null;
}

function publicDealProblem(item: { bestDeal?: DealMetrics | null; subject?: string | null; text?: string | null; summary?: string | null; keyPoints?: { text?: string | null }[] | null }): string | null {
  if (!item.bestDeal) return null;
  if (recipientOnlyItem(item)) return 'This offer is restricted to its email recipient or account and cannot be shared publicly.';
  if (gameplayRewardNotPurchase(item.bestDeal, [item.subject, item.text, item.summary, ...(item.keyPoints ?? []).map(point => point.text)].filter(Boolean).join('\n'))) return 'This is a gameplay reward, challenge or prize draw, not a guaranteed purchase deal. It cannot be published with purchase/bonus amounts.';
  return null;
}

type JobLike = { _id: Types.ObjectId; organizationId: Types.ObjectId; companyId: Types.ObjectId; createdByUserId: Types.ObjectId; level?: CostLevel | null; publishing?: unknown };

export function readConfig(job: { publishing?: unknown }): PublishingConfig | null {
  const parsed = publishingConfigSchema.safeParse(job.publishing);
  if (!parsed.success) return null;
  // Jobs set up before "news" was recognised stored the section's name wrongly singularised ("new"): use the right word.
  const source = parsed.data.source;
  if (source.type === 'site' && source.noun === 'new' && /^\/news\/?$/i.test(source.pathPrefix)) return { ...parsed.data, source: { ...source, noun: 'article' } };
  if (source.type === 'mailbox' && parsed.data.channels.some((channel) => channel.platform === 'reddit') && parsed.data.minimumSocialValuePct !== undefined && !parsed.data.redditDealPolicy) return { ...parsed.data, redditDealPolicy: { timezone: parsed.data.adminTimezone ?? 'UTC' } };
  return parsed.data;
}

// ---------- Sources ----------

async function listEntries(job: JobLike, config: PublishingConfig, deps: PublishDeps): Promise<SourceEntry[]> {
  if (config.source.type === 'site') {
    const pages = await listSitePages(config.source, deps.fetcher);
    return pages.map((p) => ({ key: p.url, url: p.url, title: p.title ?? '', date: p.date }));
  }
  const rows = await WatchItem.find({ organizationId: job.organizationId, watchId: new Types.ObjectId(config.source.watchId), flagged: true })
    .sort({ sentAt: -1 })
    .limit(100)
    .select('_id subject sentAt link fromEmail bestDeal text summary keyPoints')
    .lean<{ _id: Types.ObjectId; subject?: string; sentAt?: Date; link?: string; fromEmail?: string; bestDeal?: DealMetrics; text?: string; summary?: string; keyPoints?: { text?: string }[] }[]>();
  let eligible = config.minimumSocialValuePct !== undefined && config.channels.some((c) => c.platform !== 'admin')
    ? rows.filter((r) => r.bestDeal && dealStrengthPct(r.bestDeal) > config.minimumSocialValuePct! / 100 + Number.EPSILON)
    : rows;
  eligible = eligible.filter((row) => !publicDealProblem(row));
  if (config.socialLinkTemplate && !config.channels.some((channel) => channel.platform === 'admin')) {
    const deliveries = await PublishDelivery.find({ organizationId: job.organizationId, companyId: job.companyId, platform: 'admin', status: 'posted', 'values.slug': { $type: 'string', $ne: '' } }).select('itemId').lean();
    const items = await PublishItem.find({ _id: { $in: deliveries.map((delivery) => delivery.itemId) }, organizationId: job.organizationId, companyId: job.companyId, key: { $in: eligible.map((row) => String(row._id)) } }).select('key').lean();
    const publishedKeys = new Set(items.map((item) => item.key));
    eligible = eligible.filter((row) => publishedKeys.has(String(row._id)));
  }
  return eligible.map((r) => ({ key: String(r._id), url: r.link ?? null, title: r.subject ?? '', date: r.sentAt ?? null, dedupe: dedupeKeyFor(r.fromEmail, r.bestDeal) }));
}

/** "goldenhearts.com|20-40-sc-pay_vs_credited_value": the sender's domain and the offer's amounts. */
export function dedupeKeyFor(fromEmail: string | undefined, deal: DealMetrics | null | undefined): string | null {
  const domain = fromEmail?.split('@')[1]?.toLowerCase().replace(/^(mail|email|news|info|promo|promotions|marketing)\./, '');
  return domain && deal ? `${domain}|${buildDealKey(deal)}`.slice(0, 300) : null;
}

async function factsFor(job: JobLike, config: PublishingConfig, entry: SourceEntry, deps: PublishDeps): Promise<ItemFacts> {
  if (config.source.type === 'site') {
    const page: PageFacts = await readPageFacts(entry.url!, deps.fetcher);
    return { ...page, title: page.title || entry.title, extra: [], link: entry.url };
  }
  const [item, watch] = await Promise.all([
    WatchItem.findOne({ _id: new Types.ObjectId(entry.key), organizationId: job.organizationId })
      .select('subject text summary keyPoints bestDeal values link fromName sentAt')
      .lean<{ subject?: string; text?: string; summary?: string; keyPoints?: { text?: string }[]; bestDeal?: DealMetrics; values?: Record<string, string>; link?: string; fromName?: string; sentAt?: Date }>(),
    ContentWatch.findOne({ _id: new Types.ObjectId(config.source.watchId), organizationId: job.organizationId }).select('fields rank mode threshold minDiscountPct').lean(),
  ]);
  const fields = watch ? watchSettings(watch).fields : [];
  const dealProblem = item ? publicDealProblem(item) : null;
  if (dealProblem) throw new Error(dealProblem);
  let link = item?.link ?? entry.url;
  if (config.socialLinkTemplate && !config.channels.some((channel) => channel.platform === 'admin')) {
    const siblings = await PublishItem.find({ organizationId: job.organizationId, companyId: job.companyId, key: entry.key }).select('_id').lean();
    const admin = await PublishDelivery.findOne({ organizationId: job.organizationId, companyId: job.companyId, itemId: { $in: siblings.map((row) => row._id) }, platform: 'admin', status: 'posted', 'values.slug': { $type: 'string', $ne: '' } }).sort({ createdAt: -1 }).select('values').lean();
    // The original email link belongs in admin intake; social copy uses the site's public record.
    link = typeof admin?.values?.slug === 'string' ? config.socialLinkTemplate.replace('{slug}', encodeURIComponent(admin.values.slug)) : null;
  }
  return {
    ...(item?.bestDeal ? { dealValuePct: dealStrengthPct(item.bestDeal) * 100 } : {}),
    title: item?.subject ?? entry.title,
    description: item?.summary ?? '',
    text: '',
    image: null,
    images: [],
    video: null,
    extra: [
      item?.fromName ? `From: ${item.fromName}` : '',
      ...(config.adminTimezone ? [`Site timezone: ${config.adminTimezone}. Use this timezone for all admin dates and times.`, `Today at the site: ${new Intl.DateTimeFormat('en-CA', { timeZone: config.adminTimezone }).format(new Date())}`, ...(item?.sentAt ? [`Email sent at the site: ${new Intl.DateTimeFormat('en-US', { timeZone: config.adminTimezone, dateStyle: 'full', timeStyle: 'short' }).format(item.sentAt)}`] : [])] : []),
      `Today (UTC): ${new Date().toISOString().slice(0, 10)}`,
      ...(item?.sentAt ? [`Email sent (UTC): ${item.sentAt.toISOString()}`] : []),
      item?.bestDeal ? `Deal: ${formatDealLine(item.bestDeal)}` : '',
      ...watchValueLines(item?.values, fields),
      ...(item?.keyPoints ?? []).slice(0, 6).map((p) => `Key fact: ${p.text ?? ''}`),
    ].filter(Boolean),
    link,
  };
}

// ---------- Drafting ----------

async function approvedPersona(job: JobLike): Promise<string | null> {
  const voice = await BrandVoice.findOne({ organizationId: job.organizationId, companyId: job.companyId, status: 'approved' }).select('persona').lean<{ persona?: string }>();
  return voice?.persona?.trim() || null;
}

function engineWriter(job: JobLike): Writer {
  return async ({ system, user, maxTokens }) =>
    (await askEngine({ organizationId: String(job.organizationId), userId: String(job.createdByUserId), need: 'write', level: job.level ?? undefined, system, user, maxTokens, signal: AbortSignal.timeout(60_000) }))?.text ?? null;
}

/** When no model can write, a plain post from the facts still lets a person post it (never auto-posted). */
function fallbackDraft(platform: PublishPlatform, facts: ItemFacts, noun: string): Draft {
  if (platform === 'reddit' || platform === 'facebook' || platform === 'bluesky') return fallbackSocialDraft(platform, facts, noun);
  return { title: null, body: facts.description || `A new ${noun} is here.` };
}

interface Prepared {
  draft: Draft;
  /** False when no model wrote it (or a required admin field could not be filled): never sent automatically. */
  written: boolean;
  /** Admin records: the form values. */
  values?: Record<string, string | boolean>;
  problem?: string;
}

type DraftContext = { companyName: string; persona: string | null; subreddit: string | null; strategy?: string };

async function prepareAdmin(target: AdminTarget, config: PublishingConfig, facts: ItemFacts, context: DraftContext, write: Writer): Promise<Prepared> {
  const filled = await fillValues(target, { title: facts.title, description: facts.description, extra: facts.extra, link: facts.link }, { companyName: context.companyName, noun: config.source.noun, brief: config.brief, persona: context.persona }, write);
  if (!filled) return { draft: { title: null, body: `${facts.title}\n\n${facts.description}`.trim() }, written: false, values: {}, problem: 'Nucleas could not fill the form, so it was not added automatically. Add it by hand.' };
  filled.values = applyAdminFieldRules(config, filled.values, facts.dealValuePct, facts.link);
  if (config.adminDefaultEndDays) filled.values = withDefaultEndDate(target.fields, filled.values, config.adminDefaultEndDays);
  filled.unfilled = target.fields.filter((f) => f.required && f.type !== 'file' && (filled.values[f.key] === undefined || filled.values[f.key] === '')).map((f) => f.label || f.key);
  const lines = valueLines(target.fields, filled.values);
  return {
    draft: { title: facts.title.slice(0, 300) || null, body: lines.map((l) => `${l.label}: ${l.value}`).join('\n') || facts.title },
    written: filled.unfilled.length === 0,
    values: filled.values,
    ...(filled.unfilled.length ? { problem: `The facts did not give these required fields, so it was not added automatically: ${filled.unfilled.join(', ')}.` } : {}),
  };
}

async function draftAll(job: JobLike, config: PublishingConfig, facts: ItemFacts, context: DraftContext, write: Writer): Promise<Map<PublishPlatform, Prepared>> {
  const out = new Map<PublishPlatform, Prepared>();
  for (const channel of config.channels) {
    if (channel.platform === 'admin') {
      if (config.admin) out.set('admin', await prepareAdmin(config.admin, config, facts, context, write));
      continue;
    }
    const draft = await composePost(
      {
        platform: channel.platform,
        companyName: context.companyName,
        persona: context.persona ?? '',
        example: config.examples[channel.platform]?.text ?? '',
        brief: config.brief,
        noun: config.source.noun,
        facts: { title: facts.title, description: facts.description, text: facts.text, video: facts.video, extra: facts.extra },
        link: facts.link,
        subreddit: context.subreddit,
        strategy: context.strategy,
      },
      write
    ).catch(() => null);
    if (draft && config.socialLinkTemplate && facts.link && channel.platform === 'reddit') {
      draft.body = draft.body.replace(/https?:\/\/[^\s<>\)\]]+/g, facts.link);
      if (!draft.body.includes(facts.link)) draft.body = `${draft.body}\n\n${facts.link}`;
    }
    // A "New …:" label copied from an example post becomes the source's noun ("New Game:").
    if (draft?.title && channel.platform === 'reddit' && config.source.type === 'site') draft.title = relabelNewItemTitle(draft.title, config.source.noun);
    out.set(channel.platform, draft ? { draft, written: true } : { draft: fallbackDraft(channel.platform, facts, config.source.noun), written: false });
  }
  return out;
}

function assetsOf(facts: ItemFacts): { kind: 'image' | 'video'; url: string }[] {
  return [
    ...[facts.image, ...facts.images].filter((u): u is string => Boolean(u)).slice(0, 4).map((url) => ({ kind: 'image' as const, url })),
    ...(facts.video ? [{ kind: 'video' as const, url: facts.video }] : []),
  ];
}

// ---------- Posting ----------

/** The company's connected account for a platform, decrypted for the publisher only. */
async function credentialFor(job: JobLike, platform: PublishPlatform): Promise<string | null> {
  const connection = await IntegrationConnection.findOne({ organizationId: job.organizationId, companyId: job.companyId, provider: platform, status: 'connected' }).select('_id').lean<{ _id: Types.ObjectId }>();
  return connection ? readConnectionCredential(job.organizationId, connection._id) : null;
}

type PostOutcome = { ok: true; url: string } | { ok: false; error: PublishError };

async function postTo(job: JobLike, platform: PublishPlatform, input: PostInput, deps: PublishDeps): Promise<PostOutcome> {
  const credential = await credentialFor(job, platform);
  if (!credential) return { ok: false, error: new PublishError('needs_reauth', `${PLATFORM_LABEL[platform]} is not connected for this company. Connect it to post automatically.`) };
  const publish = deps.publish?.[platform] ?? ((c: string, i: PostInput) => DEFAULT_PUBLISHERS[platform]!(c, i, deps.fetcher));
  try {
    return { ok: true, url: (await publish(credential, input)).url };
  } catch (error) {
    return { ok: false, error: error instanceof PublishError ? error : new PublishError('rejected', error instanceof Error ? error.message.slice(0, 300) : 'The post failed.') };
  }
}

function postInput(delivery: { body: string; link?: string | null; assets?: { kind: string; url: string }[] }, facts: { title?: string | null; description?: string | null }): PostInput {
  return { text: delivery.body, link: delivery.link ?? null, linkTitle: facts.title ?? '', linkDescription: facts.description ?? '', imageUrl: delivery.assets?.find((a) => a.kind === 'image')?.url ?? null };
}

type AdminPostOutcome = PostOutcome & { screenshot: string | null; warning?: string };

/** Adds one record through the admin form; a changed form is learned again (and saved to the job) once. */
async function postToAdmin(job: JobLike, config: PublishingConfig, values: Record<string, string | boolean>, facts: ItemFacts, context: DraftContext, write: Writer, deps: PublishDeps, reviewed = false): Promise<AdminPostOutcome> {
  if (!reviewed) values = applyAdminFieldRules(config, values, facts.dealValuePct, facts.link);
  // Cards written before the end-date rule existed get it now, when "Add it for me" is used.
  if (config.admin && config.adminDefaultEndDays) values = withDefaultEndDate(config.admin.fields, values, config.adminDefaultEndDays);
  if (!config.admin) return { ok: false, error: new PublishError('rejected', 'This job has no admin form set up.'), screenshot: null };
  const missingRules = (config.adminFieldRules ?? []).filter((rule) => !config.admin!.fields.some((field) => field.key === rule.field));
  if (missingRules.length) return { ok: false, error: new PublishError('rejected', `The admin form is missing configured controls: ${missingRules.map((r) => r.field).join(', ')}. Learn the form again before saving.`), screenshot: null };
  const session = deps.adminSession !== undefined ? deps.adminSession : await adminSessionFor(job.organizationId, String(job.companyId));
  if (!session) return { ok: false, error: new PublishError('needs_reauth', 'The admin session has expired or is missing. Reconnect it in Company → Admin account, then retry this card.'), screenshot: null };
  const outcome = await addRecord({
    session,
    timezone: config.adminTimezone,
    // Reactive forms may recalculate a value after spend/get lose focus. Apply
    // the explicitly mapped percentage last, after every dependent control.
    target: config.adminValueField ? { ...config.admin, fields: [...config.admin.fields].sort((a, b) => Number(a.key === config.adminValueField) - Number(b.key === config.adminValueField)) } : config.admin,
    values,
    browser: deps.admin ?? workerAdminBrowser,
    refill: async (target) => {
      if (reviewed) return Object.keys(values).every(key => target.fields.some(field => field.key === key)) ? values : null;
      const prepared = await prepareAdmin(target, config, facts, context, write);
      return prepared.written ? prepared.values ?? null : null;
    },
  });
  if (outcome.relearned) {
    await Job.updateOne({ _id: job._id }, { $set: { 'publishing.admin': outcome.relearned, 'publishing.notes.admin': `The form changed; Nucleas learned it again on ${new Date().toISOString().slice(0, 10)}.` } });
  }
  if (outcome.ok) {
    return { ok: true, url: outcome.url, screenshot: outcome.screenshot, ...(outcome.verified === false ? { warning: 'Saved, but Nucleas could not find it on the list page. Check it before adding it again.' } : {}) };
  }
  const code = outcome.code === 'needs_reauth' ? 'needs_reauth' : outcome.code === 'unreachable' ? 'unreachable' : 'rejected';
  return { ok: false, error: new PublishError(code, outcome.error), screenshot: outcome.screenshot };
}

/**
 * A channel whose account cannot post (disconnected, or missing permission) is switched to manual so
 * the next run does not fail the same way; the note tells people what to fix.
 */
async function demoteChannel(jobId: Types.ObjectId, platform: PublishPlatform, note: string): Promise<void> {
  const job = await Job.findById(jobId).select('publishing').lean<{ publishing?: unknown }>();
  const config = readConfig(job ?? {});
  if (!config) return;
  const channels = config.channels.map((c) => (c.platform === platform ? { ...c, mode: 'manual' as const } : c));
  await Job.updateOne({ _id: jobId }, { $set: { 'publishing.channels': channels, [`publishing.notes.${platform}`]: note.slice(0, 300) } });
}

// ---------- Runs ----------

async function progress(runId: Types.ObjectId, owner: string, text: string, stage: JobRunProgressStage, percent: number) {
  await heartbeatJobRun(runId, owner, { text, milestone: { stage, percent } }).catch(() => undefined);
}

async function finishRun(runId: Types.ObjectId, owner: string, status: 'completed' | 'needs_review' | 'failed', fields: { output?: JobRunOutput; error?: string }): Promise<boolean> {
  const now = new Date();
  const label = status === 'completed' ? 'Complete' : status === 'needs_review' ? 'Ready for review' : 'Run stopped';
  const saved = await JobRun.updateOne(
    { _id: runId, status: 'running', leaseOwner: owner },
    { $set: { status, ...fields, ...(fields.error ? { error: fields.error.slice(0, 1000) } : {}), finishedAt: now, progressState: { stage: 'complete', label, percent: 100, updatedAt: now } }, $unset: { leaseExpiresAt: '' } }
  );
  return saved.modifiedCount === 1;
}

function record(platform: PublishPlatform, draft: Draft, facts: ItemFacts, extra: Record<string, unknown> = {}) {
  return {
    values: {
      platform: PLATFORM_LABEL[platform],
      ...(draft.title ? { post_title: draft.title } : {}),
      post_copy: draft.body,
      target_url: facts.link ?? '',
      ...(facts.image ? { image_url: facts.image } : {}),
      ...extra,
    },
    sources: facts.link ? [facts.link] : [],
  };
}

type RotationTurn = { wait: string } | { entry: SourceEntry | null };

/**
 * Evergreen rotation: one existing item every N days, oldest first, then start over. The item is the first one in
 * order not yet posted in this pass; a finished pass begins the next (its keys carry the pass number, so every item
 * can be posted again). A saved randomized cadence permits the next eligible local calendar day;
 * ordinary rotations retain their elapsed-day interval.
 */
export async function nextRotationItem(job: JobLike, entries: SourceEntry[], rotation: { everyDays: number; pool?: { url: string; title: string }[] }, cycleSetting: number | undefined, noun: string, now = new Date()): Promise<RotationTurn> {
  const everyDays = rotation.everyDays;
  const last = await PublishItem.findOne({ jobId: job._id, status: 'processed' }).sort({ createdAt: -1 }).select('createdAt').lean<{ createdAt?: Date }>();
  if (last?.createdAt) {
    const saved = await Job.findById(job._id).select('design.schedule').lean<{ design?: { schedule?: unknown } }>();
    const schedule = jobScheduleSchema.safeParse(saved?.design?.schedule);
    const due = schedule.success && schedule.data.randomWindow
      ? nextScheduledAt(schedule.data, last.createdAt, () => 0) ?? new Date(last.createdAt.getTime() + everyDays * 86_400_000)
      : new Date(last.createdAt.getTime() + everyDays * 86_400_000);
    if (now < due) return { wait: `The next ${noun} is due ${due.toISOString().slice(0, 10)}. One ${noun} is posted every ${cadenceLabel(everyDays)}.` };
  }
  // A chosen list is posted in the order given; otherwise every page in the section, oldest first (the source lists newest first).
  const ordered: SourceEntry[] = rotation.pool ? rotation.pool.map((p) => ({ key: p.url, url: p.url, title: p.title, date: null })) : [...entries].reverse();
  if (!ordered.length) return { entry: null };
  let cycle = cycleSetting ?? 1;
  const keyFor = (entry: SourceEntry, pass: number) => (pass > 1 ? `${entry.key}#${pass}` : entry.key);
  const posted = async (pass: number) => new Set((await PublishItem.find({ jobId: job._id, key: { $in: ordered.map((e) => keyFor(e, pass)) } }).select('key').lean<{ key: string }[]>()).map((r) => r.key));
  const seen = await posted(cycle);
  let next = ordered.find((e) => !seen.has(keyFor(e, cycle)));
  if (!next) {
    cycle += 1;
    await Job.updateOne({ _id: job._id }, { $set: { 'publishing.rotationCycle': cycle } });
    next = ordered[0];
  }
  return { entry: { ...next!, key: keyFor(next!, cycle) } };
}

export interface RotationView {
  everyDays: number;
  cycle: number;
  /** True once the list has been chosen or reordered by hand; false while it is every page, oldest first. */
  explicit: boolean;
  /** When the next one is due (ISO), or null when nothing has been posted yet (the first goes at the next check). */
  nextDue: string | null;
  pool: { url: string; title: string; postedAt: string | null; skipped: boolean; next: boolean }[];
  /** Pages in the section that are not in the list, to add. */
  available: { url: string; title: string }[];
  /** Set when the site's page list could not be read (the list shown is what was saved). */
  problem: string | null;
}

/** "how-to-be-a-frugal-gambler" -> "How to be a frugal gambler", for pages whose title is not known yet. */
export function titleFromUrl(url: string): string {
  try {
    const slug = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '').replace(/[-_]+/g, ' ').trim();
    return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : url;
  } catch {
    return url;
  }
}

/** The rotation as a person edits it: the list in posting order, what is posted, what is next, and what could be added. */
export async function rotationView(job: JobLike, deps: PublishDeps = {}): Promise<RotationView | null> {
  const config = readConfig(job);
  if (!config || config.source.type !== 'site' || !config.source.rotation) return null;
  const rotation = config.source.rotation;
  let pages: { url: string; title: string }[] = [];
  let problem: string | null = null;
  try {
    pages = (await listSitePages(config.source, deps.fetcher)).reverse().map((p) => ({ url: p.url, title: p.title || titleFromUrl(p.url) }));
  } catch {
    problem = 'The site’s page list could not be read right now. The saved list is shown.';
  }
  const cycle = config.rotationCycle ?? 1;
  const keyFor = (url: string, pass: number) => (pass > 1 ? `${url}#${pass}` : url);
  const base = rotation.pool ? rotation.pool.map((p) => ({ url: p.url, title: p.title || pages.find((g) => g.url === p.url)?.title || titleFromUrl(p.url) })) : pages;
  const items = await PublishItem.find({ jobId: job._id, key: { $in: base.map((p) => keyFor(p.url, cycle)) } }).select('key status createdAt').lean<{ key: string; status: string; createdAt?: Date }[]>();
  const byKey = new Map(items.map((i) => [i.key, i]));
  const rows = base.map((p) => {
    const item = byKey.get(keyFor(p.url, cycle));
    return { ...p, postedAt: item?.status === 'processed' ? item.createdAt?.toISOString() ?? null : null, skipped: item?.status === 'skipped', next: false };
  });
  const nextIndex = rows.findIndex((r) => !r.postedAt && !r.skipped);
  const upNext = nextIndex >= 0 ? nextIndex : rows.length ? 0 : -1;
  if (upNext >= 0) rows[upNext]!.next = true;
  const last = await PublishItem.findOne({ jobId: job._id, status: 'processed' }).sort({ createdAt: -1 }).select('createdAt').lean<{ createdAt?: Date }>();
  const planned = await Job.findById(job._id).select('nextRunAt').lean<{ nextRunAt?: Date }>();
  const nextDue = planned?.nextRunAt?.toISOString() ?? (last?.createdAt ? new Date(last.createdAt.getTime() + rotation.everyDays * 86_400_000).toISOString() : null);
  const inList = new Set(base.map((p) => p.url));
  return { everyDays: rotation.everyDays, cycle, explicit: Boolean(rotation.pool), nextDue, pool: rows, available: pages.filter((p) => !inList.has(p.url)), problem };
}

/** Marks everything the source lists right now as already seen, so switching a job on never posts the back catalog. */
export async function takeBaseline(job: JobLike, deps: PublishDeps = {}): Promise<number> {
  const config = readConfig(job);
  if (!config) return 0;
  // An evergreen rotation posts the existing library one item at a time, so nothing counts as already seen.
  if (config.source.type === 'site' && config.source.rotation) {
    await Job.updateOne({ _id: job._id }, { $set: { 'publishing.baselineAt': new Date() } });
    return 0;
  }
  const entries = await listEntries(job, config, deps);
  if (entries.length) {
    await PublishItem.bulkWrite(
      entries.map((e) => ({
        updateOne: {
          filter: { jobId: job._id, key: e.key },
          update: { $setOnInsert: { organizationId: job.organizationId, jobId: job._id, companyId: job.companyId, key: e.key, url: e.url ?? undefined, title: e.title.slice(0, 500), publishedAt: e.date ?? undefined, status: 'baseline' } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }
  await Job.updateOne({ _id: job._id }, { $set: { 'publishing.baselineAt': new Date() } });
  return entries.length;
}

/**
 * One run of a publishing job (a dry run or an hourly check). The caller holds the run's lease;
 * every write below is guarded by it or is idempotent.
 */
export async function runPublishing(run: { _id: Types.ObjectId; dryRun: boolean }, owner: string, job: JobLike, deps: PublishDeps = {}): Promise<void> {
  const fail = async (error: string) => {
    const failed = await finishRun(run._id, owner, 'failed', { error });
    if (failed && run.dryRun) await Job.updateOne({ _id: job._id, status: 'testing' }, { $set: { status: 'proposed' } });
  };
  const config = readConfig(job);
  if (!config) return fail('This job’s publishing settings are missing. Archive it and set it up again.');
  const viewer = await loadCompanyViewer(String(job.createdByUserId));
  const profile = viewer ? await getCompanyProfile(viewer, String(job.companyId)) : null;
  if (!profile) return fail('The company is no longer accessible.');
  const persona = await approvedPersona(job);
  // Social posts must sound like the brand; admin records use the Voice for descriptions when there is one.
  if (!persona && config.channels.some((c) => (SOCIAL_PLATFORMS as readonly string[]).includes(c.platform))) return fail(`Approve ${profile.name}’s Voice first, so posts sound like the brand.`);
  const write = deps.write ?? engineWriter(job);
  const context = { companyName: profile.name, persona, subreddit: profile.subreddit ?? null, strategy: await upstreamContext(job.organizationId, job.companyId).catch(() => '') };
  const noun = config.source.noun;

  await progress(run._id, owner, `Checking for new ${noun}s`, 'preparing', 10);
  let entries: SourceEntry[];
  try {
    entries = await listEntries(job, config, deps);
  } catch (error) {
    return fail(`Could not read the source: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  const rotation = config.source.type === 'site' ? config.source.rotation : undefined;

  // A dry run drafts posts for the newest item and delivers nothing.
  if (run.dryRun) {
    const first = rotation?.pool?.[0];
    const newest = rotation ? (first ? { key: first.url, url: first.url, title: first.title, date: null } : [...entries].reverse()[0]) : entries[0];
    if (!newest) return fail(`No ${noun}s were found to try a sample with.`);
    await progress(run._id, owner, `Writing a format preview using existing content: “${newest.title || newest.key}”`, 'researching', 40);
    let facts: ItemFacts;
    try {
      facts = await factsFor(job, config, newest, deps);
    } catch (error) {
      return fail(`Could not read ${newest.url ?? 'the newest item'}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    const drafts = await draftAll(job, config, facts, context, write);
    const records: JobRunOutput['records'] = [];
    const gaps: string[] = [];
    for (const c of config.channels) {
      const prepared = drafts.get(c.platform);
      if (!prepared) continue;
      const mode = c.platform === 'admin' ? (c.mode === 'auto' ? 'Adds it automatically' : 'Ready-to-add card') : c.mode === 'auto' ? 'Posts automatically' : 'Ready-to-post card';
      let screenshot: string | null = null;
      if (c.platform === 'admin' && config.admin) {
        // Fill the real form without saving, so the person sees exactly what would be added.
        const session = deps.adminSession !== undefined ? deps.adminSession : await adminSessionFor(job.organizationId, String(job.companyId));
        if (!session) return fail('The admin session has expired or is missing. Log in again (Company → Admin account).');
        const filled = await (deps.admin ?? workerAdminBrowser).fill(session, { url: config.admin.formUrl, fields: config.admin.fields, values: prepared.values ?? {}, submit: false, submitSelector: config.admin.submit.selector }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : 'unknown' }));
        if ('error' in filled && typeof filled.error === 'string') return fail(`Could not open the admin form: ${filled.error}`);
        if ('loggedIn' in filled) {
          if (!filled.loggedIn) return fail('The admin session is no longer signed in. Log in again (Company → Admin account).');
          if (filled.missing.length) gaps.push(`These form fields were not found: ${filled.missing.join(', ')}. The form may have changed; set the job up again.`);
          if (filled.errors.length) gaps.push(...filled.errors);
          screenshot = filled.screenshot;
        }
      }
      records.push(record(c.platform, prepared.draft, facts, { mode, ...(screenshot ? { screenshot } : {}) }));
      if (prepared.problem) gaps.push(prepared.problem);
      else if (!prepared.written) gaps.push(`No model could write the ${PLATFORM_LABEL[c.platform]} post; a plain version from the page is shown.`);
    }
    const admin = config.channels.every((c) => c.platform === 'admin');
    const output: JobRunOutput = {
      records,
      summary: admin
        ? `A sample for the newest ${noun}, “${facts.title}”: the form was filled but not saved. Accept to switch the job on: it checks every hour, and only ${noun}s that arrive after that are added.`
        : rotation
          ? `A sample for the first ${noun} in the rotation, “${facts.title}”. Nothing was posted. Accept to switch the job on: it posts this ${noun} at the next scheduled run, then one ${noun} every ${cadenceLabel(rotation.everyDays)}, oldest first, starting over when it reaches the end.`
          : `Format preview using an existing ${noun}, “${facts.title}”. This sample is not a new-publication notification. Nothing was posted. Accept to switch the job on: it checks every hour, and only ${noun}s that appear after that are posted.`,
      gaps,
    };
    const saved = await finishRun(run._id, owner, 'needs_review', { output });
    if (saved) await notifyPeople(job.organizationId, config.notifyUserIds, { subject: `Sample posts ready to check · ${profile.name}`, intro: rotation ? `Nucleas wrote sample posts for the first ${noun} in the rotation (“${facts.title}”). Nothing was posted. Check the drafts, then accept to switch the job on.` : `Nucleas wrote a format preview using an existing ${noun} (“${facts.title}”). It is not a new-publication notification. Check the drafts, then accept to switch the job on.`, lines: [], action: 'Review the samples' }, deps.send);
    return;
  }

  const current = await Job.findById(job._id).select('publishing.baselineAt').lean<{ publishing?: { baselineAt?: Date } }>();
  if (!rotation && !current?.publishing?.baselineAt) {
    const count = await takeBaseline(job, deps);
    await finishRun(run._id, owner, 'completed', { output: { records: [], summary: `Recorded the ${count} ${noun}${count === 1 ? '' : 's'} that already exist. New ones are posted from now on.`, gaps: [] } });
    return;
  }

  let fresh: SourceEntry[];
  if (rotation) {
    const turn = await nextRotationItem(job, entries, rotation, config.rotationCycle, noun);
    if ('wait' in turn) {
      await finishRun(run._id, owner, 'completed', { output: { records: [], summary: turn.wait, gaps: [] } });
      return;
    }
    fresh = turn.entry ? [turn.entry] : [];
  } else {
    const known = new Set((await PublishItem.find({ jobId: job._id, key: { $in: entries.map((e) => e.key) } }).select('key').lean<{ key: string }[]>()).map((r) => r.key));
    fresh = entries.filter((e) => !known.has(e.key)).reverse(); // oldest first, so posts go out in release order
  }

  if (!rotation && fresh.length > MAX_NEW_PER_RUN) {
    await PublishItem.bulkWrite(
      fresh.map((e) => ({
        updateOne: {
          filter: { jobId: job._id, key: e.key },
          update: { $setOnInsert: { organizationId: job.organizationId, jobId: job._id, companyId: job.companyId, key: e.key, url: e.url ?? undefined, title: e.title.slice(0, 500), publishedAt: e.date ?? undefined, status: 'skipped', skipReason: 'Arrived in a burst; treated as a site change.' } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    const summary = `${fresh.length} new ${noun}s appeared at once, which looks like a site change rather than new releases. They were recorded and not posted.`;
    await finishRun(run._id, owner, 'completed', { output: { records: [], summary, gaps: [] } });
    await notifyPeople(job.organizationId, config.notifyUserIds, { subject: `Nothing posted: ${fresh.length} ${noun}s appeared at once · ${profile.name}`, intro: summary, lines: fresh.slice(0, 8).map((e) => e.title || e.url || e.key), action: 'Open Marketing' }, deps.send);
    return;
  }

  const records: JobRunOutput['records'] = [];
  const ready: string[] = [];
  const problems: string[] = [];
  let posted = 0;
  let repeats = 0;
  for (const [index, entry] of fresh.entries()) {
    await progress(run._id, owner, `Working on “${entry.title || entry.key}”`, 'researching', 20 + Math.round((index / Math.max(fresh.length, 1)) * 70));
    // The same offer in another email (a reminder, a resend) is recorded once and not added again.
    const repeat = entry.dedupe
      ? await PublishItem.exists({ jobId: job._id, dedupeKey: entry.dedupe, status: 'processed', createdAt: { $gte: new Date(Date.now() - DEDUPE_DAYS * 86_400_000) } })
      : null;
    // Claim the item first: a second run that races this one finds it and moves on.
    const claim = await PublishItem.updateOne(
      { jobId: job._id, key: entry.key },
      {
        $setOnInsert: {
          organizationId: job.organizationId, jobId: job._id, companyId: job.companyId, key: entry.key, url: entry.url ?? undefined, title: entry.title.slice(0, 500), publishedAt: entry.date ?? undefined,
          ...(entry.dedupe ? { dedupeKey: entry.dedupe } : {}),
          ...(repeat ? { status: 'skipped', skipReason: 'The same deal as an earlier email.' } : { status: 'processed' }),
        },
      },
      { upsert: true }
    );
    if (!claim.upsertedId) continue;
    if (rotation) {
      const stored = await Job.findById(job._id).select('design.schedule').lean<{ design?: { schedule?: unknown } }>();
      const parsed = jobScheduleSchema.safeParse(stored?.design?.schedule);
      const timezone = parsed.success ? parsed.data.timezone ?? 'UTC' : 'UTC';
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
      const part = (type: string) => parts.find(p => p.type === type)!.value;
      const schedule = { kind: 'daily' as const, everyDays: rotation.everyDays, time: parsed.success ? parsed.data.time ?? '09:00' : '09:00', timezone, anchorDate: `${part('year')}-${part('month')}-${part('day')}`, ...(parsed.success && parsed.data.randomWindow ? { randomWindow: parsed.data.randomWindow } : {}) };
      // Only a newly claimed article draws the next time; UI reads and cron polls never re-randomize it.
      await Job.updateOne({ _id: job._id }, { $set: { 'design.schedule': schedule, nextRunAt: nextScheduledAt(schedule, now) } });
    }
    if (repeat) {
      repeats += 1;
      continue;
    }
    const itemId = claim.upsertedId as Types.ObjectId;
    let facts: ItemFacts;
    try {
      facts = await factsFor(job, config, entry, deps);
    } catch (error) {
      const reason = `Could not read ${entry.url ?? entry.key}: ${error instanceof Error ? error.message : 'unknown error'}`.slice(0, 300);
      await PublishItem.updateOne({ _id: itemId }, { $set: { status: 'skipped', skipReason: reason } });
      problems.push(reason);
      continue;
    }
    await PublishItem.updateOne({ _id: itemId }, { $set: { title: facts.title.slice(0, 500), facts: { title: facts.title, description: facts.description, text: facts.text, image: facts.image ?? undefined, images: facts.images, video: facts.video ?? undefined } } });
    const drafts = await draftAll(job, config, facts, context, write);
    for (const channel of config.channels) {
      const prepared = drafts.get(channel.platform);
      if (!prepared) continue;
      const { draft, written } = prepared;
      // Never auto-post copy no model wrote: a person looks at it first.
      const auto = channel.mode === 'auto' && written && !MANUAL_ONLY.includes(channel.platform);
      const delivery = await PublishDelivery.create({
        organizationId: job.organizationId,
        jobId: job._id,
        companyId: job.companyId,
        itemId,
        platform: channel.platform,
        mode: channel.mode,
        status: auto ? 'publishing' : 'ready',
        ...(draft.title ? { title: draft.title } : {}),
        body: draft.body,
        ...(facts.link ? { link: facts.link } : {}),
        assets: channel.platform === 'admin' ? [] : assetsOf(facts),
        ...(prepared.values ? { values: prepared.values } : {}),
        ...(channel.mode === 'auto' && !written ? { error: prepared.problem ?? 'Nucleas could not write this post, so it was not posted automatically. Check it and post it by hand.' } : {}),
      });
      if (!auto) {
        ready.push(`${PLATFORM_LABEL[channel.platform]}: ${facts.title}`);
        records.push(record(channel.platform, draft, facts, { status: 'Ready to post' }));
        continue;
      }
      const outcome: PostOutcome & { screenshot?: string | null; warning?: string } = channel.platform === 'admin'
        ? await postToAdmin(job, config, prepared.values ?? {}, facts, context, write, deps)
        : await postTo(job, channel.platform, postInput(delivery, facts), deps);
      const shot = outcome.screenshot ? { screenshot: outcome.screenshot } : {};
      if (outcome.ok) {
        posted += 1;
        await PublishDelivery.updateOne({ _id: delivery._id }, { $set: { status: 'posted', postedUrl: outcome.url, postedAt: new Date(), ...shot, ...(outcome.warning ? { error: outcome.warning } : {}) } });
        if (outcome.warning) problems.push(`${facts.title}: ${outcome.warning}`);
        records.push({ ...record(channel.platform, draft, facts, { status: 'Posted', posted_url: outcome.url }), sources: [outcome.url, ...(facts.link ? [facts.link] : [])] });
        continue;
      }
      // Not lost: the post becomes a card a person can post by hand (or retry once the account is fixed).
      await PublishDelivery.updateOne({ _id: delivery._id }, { $set: { status: 'ready', error: `Could not ${channel.platform === 'admin' ? 'add it' : 'post'} automatically: ${outcome.error.message}`.slice(0, 1000), ...shot } });
      ready.push(`${PLATFORM_LABEL[channel.platform]}: ${facts.title} (automatic post failed)`);
      records.push(record(channel.platform, draft, facts, { status: 'Ready to post (automatic post failed)' }));
      if (outcome.error.code === 'needs_reauth' || outcome.error.code === 'needs_permission') {
        await demoteChannel(job._id, channel.platform, outcome.error.message);
        problems.push(`${PLATFORM_LABEL[channel.platform]} was switched to manual: ${outcome.error.message}`);
      } else {
        problems.push(`${PLATFORM_LABEL[channel.platform]}: ${outcome.error.message}`);
      }
    }
  }

  const handled = fresh.length - repeats;
  const newWord = rotation ? 'evergreen ' : 'new ';
  const summary = handled
    ? `${handled} ${newWord}${noun}${handled === 1 ? '' : 's'}. ${posted} ${posted === 1 ? 'was' : 'were'} published or added${ready.length ? `, ${ready.length} ready to do by hand` : ''}.${repeats ? ` ${repeats} repeat${repeats === 1 ? '' : 's'} of earlier ${noun}s skipped.` : ''}`
    : repeats ? `No new ${noun}s (${repeats} repeat${repeats === 1 ? '' : 's'} of earlier ones skipped).` : `No new ${noun}s.`;
  await finishRun(run._id, owner, 'completed', { output: { records, summary, gaps: problems.slice(0, 20) } });
  const adminOnly = config.channels.every((c) => c.platform === 'admin');
  if (ready.length || problems.length) {
    await notifyPeople(
      job.organizationId,
      config.notifyUserIds,
      {
        subject: ready.length ? (adminOnly ? `${ready.length} ${noun}${ready.length === 1 ? '' : 's'} ready to add · ${profile.name}` : `${ready.length} post${ready.length === 1 ? '' : 's'} ready to post · ${profile.name}`) : `A publishing job needs attention · ${profile.name}`,
        intro: ready.length ? (adminOnly ? `New ${noun}${handled === 1 ? '' : 's'} for ${profile.name}. These are filled in and waiting for someone to add them to the admin:` : `New ${noun}${handled === 1 ? '' : 's'} on ${profile.name}. These posts are written and waiting for someone to post them:`) : 'Something went wrong:',
        lines: [...ready, ...problems].slice(0, 12),
        action: ready.length ? 'Open the ready-to-post cards' : 'Open Marketing',
      },
      deps.send
    );
  }
}

// ---------- People acting on deliveries ----------

export type DeliveryResult = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };

function deliveryFilter(job: { _id: Types.ObjectId; organizationId: Types.ObjectId }, deliveryId: string) {
  return Types.ObjectId.isValid(deliveryId) ? { _id: new Types.ObjectId(deliveryId), jobId: job._id, organizationId: job.organizationId } : null;
}

/** Someone posted a ready card by hand. The link is optional; it is kept so the post can be found later. */
export async function markPosted(job: { _id: Types.ObjectId; organizationId: Types.ObjectId }, deliveryId: string, userId: string, postedUrl?: string): Promise<DeliveryResult> {
  const filter = deliveryFilter(job, deliveryId);
  if (!filter) return { ok: false, status: 404, error: 'Post not found.' };
  let url: string | undefined;
  if (postedUrl?.trim()) {
    try {
      const parsed = new URL(postedUrl.trim());
      if (parsed.protocol !== 'https:') throw new Error('https only');
      url = parsed.toString().slice(0, 2000);
    } catch {
      return { ok: false, status: 400, error: 'That link does not look right. Paste the post’s https address, or leave it empty.' };
    }
  }
  const candidate = await PublishDelivery.findOne({ ...filter, status: 'ready' }).lean();
  const dealProblem = candidate ? await deliveryDealProblem(candidate) : null;
  if (dealProblem) return { ok: false, status: 409, error: dealProblem };
  const config = readConfig((await Job.findById(job._id).select('publishing').lean()) ?? {});
  const update = { $set: { status: 'posted', postedAt: new Date(), postedByUserId: new Types.ObjectId(userId), ...(url ? { postedUrl: url } : {}) }, $unset: { error: '' } };
  if (candidate?.platform === 'reddit' && config?.redditDealPolicy) {
    return withRedditDealLock(candidate, async (session): Promise<DeliveryResult> => {
      const blocked = await redditDealBlock(candidate, config.redditDealPolicy!.timezone, new Date(), session);
      if (blocked) return { ok: false, status: 409, error: blocked };
      const done = await PublishDelivery.updateOne({ ...filter, status: 'ready' }, update, { session });
      return done.modifiedCount ? { ok: true } : { ok: false, status: 409, error: 'Someone already handled this post.' };
    });
  }
  const done = await PublishDelivery.updateOne({ ...filter, status: 'ready' }, update);
  return done.modifiedCount ? { ok: true } : { ok: false, status: 409, error: 'Someone already handled this post.' };
}

export async function skipDelivery(job: { _id: Types.ObjectId; organizationId: Types.ObjectId }, deliveryId: string, userId: string): Promise<DeliveryResult> {
  const filter = deliveryFilter(job, deliveryId);
  if (!filter) return { ok: false, status: 404, error: 'Post not found.' };
  const done = await PublishDelivery.updateOne({ ...filter, status: 'ready' }, { $set: { status: 'skipped', postedByUserId: new Types.ObjectId(userId) } });
  return done.modifiedCount ? { ok: true } : { ok: false, status: 409, error: 'Someone already handled this post.' };
}

/** Edit a card's text before it is posted. */
export async function editDelivery(job: { _id: Types.ObjectId; organizationId: Types.ObjectId }, deliveryId: string, change: { title?: string; body?: string; values?: unknown }): Promise<DeliveryResult> {
  const filter = deliveryFilter(job, deliveryId);
  if (!filter) return { ok: false, status: 404, error: 'Post not found.' };
  if (change.values !== undefined) {
    const [delivery, currentJob] = await Promise.all([PublishDelivery.findOne({ ...filter, status: 'ready' }).lean(), Job.findOne({ _id: job._id, organizationId: job.organizationId }).select('publishing').lean()]);
    if (!delivery || delivery.platform !== 'admin') return { ok: false, status: 409, error: 'This admin card was already handled or is unavailable.' };
    const config = currentJob ? readConfig(currentJob) : null;
    if (!config?.admin || !change.values || typeof change.values !== 'object' || Array.isArray(change.values)) return { ok: false, status: 400, error: 'Valid admin fields are required.' };
    const entries = Object.entries(change.values);
    if (JSON.stringify(change.values).length > 100000) return { ok: false, status: 400, error: 'The edited fields are too large.' };
    for (const [key, value] of entries) {
      const field = config.admin.fields.find(field => field.key === key && field.type !== 'file');
      if (!field || (typeof value !== 'string' && typeof value !== 'boolean')) return { ok: false, status: 400, error: 'An edited field is not supported by this form.' };
      const text = String(value).trim();
      if (text.length > 40000 || (field.type === 'checkbox' && typeof value !== 'boolean') || (field.type !== 'checkbox' && typeof value !== 'string')) return { ok: false, status: 400, error: `${field.label}: invalid value.` };
      if (text && field.type === 'number' && !Number.isFinite(Number(text))) return { ok: false, status: 400, error: `${field.label}: enter a number.` };
      if (text && field.type === 'url') { try { if (!['http:', 'https:'].includes(new URL(text).protocol)) throw new Error(); } catch { return { ok: false, status: 400, error: `${field.label}: enter a valid web URL.` }; } }
      if (text && ['date','datetime-local'].includes(field.type) && (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(text) || !Number.isFinite(Date.parse(text)))) return { ok: false, status: 400, error: `${field.label}: enter a valid date.` };
      if (text && field.options?.length && !field.options.some(option => option.value === value)) return { ok: false, status: 400, error: `${field.label}: select one of the available choices.` };
    }
    const values = Object.fromEntries(entries);
    const titleField = config.admin.fields.find(field => /^(title|name)$/i.test(field.label.trim()) || /^(title|name)$/i.test(field.key));
    for (const field of config.admin.fields.filter(field => /^slug$/i.test(field.label.trim()) || /^slug$/i.test(field.key))) {
      if (titleField) {
        const slug = slugifyTitle(String(values[titleField.key] ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''));
        if (!slug) return { ok: false, status: 400, error: 'Enter a title that can be used as the deal URL.' };
        values[field.key] = slug;
      } else if (delivery.values?.[field.key] !== undefined) values[field.key] = delivery.values[field.key];
    }
    for (const field of config.admin.fields.filter(field => /\bcasino\b/i.test(`${field.key.replaceAll('_', ' ')} ${field.label}`))) {
      if (field.key in values && values[field.key] !== delivery.values?.[field.key]) return { ok: false, status: 400, error: 'Casino cannot be changed from the review panel.' };
      if (delivery.values?.[field.key] !== undefined) values[field.key] = delivery.values[field.key];
    }
    for (const field of config.admin.fields) if (field.required && field.type !== 'checkbox' && field.type !== 'file' && !String(values[field.key] ?? '').trim()) return { ok: false, status: 400, error: `${field.label}: this field is required.` };
    const saved = await PublishDelivery.updateOne({ ...filter, status: 'ready', updatedAt: delivery.updatedAt }, { $set: { values, valuesReviewed: true }, $unset: { screenshot: '', error: '' } });
    return saved.modifiedCount ? { ok: true } : { ok: false, status: 409, error: 'This card changed. Refresh before editing it again.' };
  }
  const body = change.body?.trim();
  if (body !== undefined && !body) return { ok: false, status: 400, error: 'The post cannot be empty.' };
  const set: Record<string, string> = {};
  if (body !== undefined) set.body = body.slice(0, 40000);
  if (change.title !== undefined) set.title = change.title.trim().slice(0, 300);
  if (!Object.keys(set).length) return { ok: false, status: 400, error: 'Nothing to change.' };
  const done = await PublishDelivery.updateOne({ ...filter, status: 'ready' }, { $set: set });
  return done.modifiedCount ? { ok: true } : { ok: false, status: 409, error: 'This post was already handled.' };
}

/** Post a ready card through the platform's API now (after an account is fixed, or instead of copying by hand). */
async function deliveryDealProblem(delivery: { itemId: Types.ObjectId; organizationId: Types.ObjectId }): Promise<string | null> {
  const item = await PublishItem.findOne({ _id: delivery.itemId, organizationId: delivery.organizationId }).select('key').lean();
  if (!item || !Types.ObjectId.isValid(item.key)) return null;
  const email = await WatchItem.findOne({ _id: item.key, organizationId: delivery.organizationId }).select('subject text summary keyPoints bestDeal').lean();
  return email ? publicDealProblem(email) : null;
}

export async function postDeliveryNow(job: JobLike, deliveryId: string, userId: string, deps: PublishDeps = {}): Promise<DeliveryResult> {
  const filter = deliveryFilter(job, deliveryId);
  if (!filter) return { ok: false, status: 404, error: 'Post not found.' };
  const candidate = await retryDatabaseRead('publishing.delivery', () => PublishDelivery.findOne({ ...filter, status: 'ready' }).lean().exec());
  const currentJob = await retryDatabaseRead('publishing.settings', () => Job.findOne({ _id: job._id, organizationId: job.organizationId }).select('publishing').lean().exec());
  const socialConfig = currentJob ? readConfig(currentJob) : null;
  if (candidate && candidate.platform !== 'admin' && socialConfig?.source.type === 'mailbox' && socialConfig.minimumSocialValuePct !== undefined) {
    const source = await PublishItem.findOne({ _id: candidate.itemId, organizationId: job.organizationId }).select('key').lean();
    const email = source && Types.ObjectId.isValid(source.key) ? await WatchItem.findOne({ _id: new Types.ObjectId(source.key), organizationId: job.organizationId }).select('bestDeal').lean() : null;
    if (!email?.bestDeal || !(dealStrengthPct(email.bestDeal as DealMetrics) > socialConfig.minimumSocialValuePct / 100 + Number.EPSILON)) return { ok: false, status: 409, error: `This deal does not have confirmed value over ${socialConfig.minimumSocialValuePct}%; it cannot be posted to social.` };
  }
  if (!candidate) return { ok: false, status: 409, error: 'This post was already handled.' };
  const dealProblem = await deliveryDealProblem(candidate);
  if (dealProblem) return { ok: false, status: 409, error: dealProblem };
  // Finish read-only preparation before claiming or making an external change.
  const item = await retryDatabaseRead('publishing.item', () => PublishItem.findById(candidate.itemId).select('facts title key').lean<{ key?: string; title?: string; facts?: { title?: string; description?: string } }>().exec());
  const adminFacts = candidate.platform === 'admin' && socialConfig?.source.type === 'mailbox' && item?.key
    ? await retryDatabaseRead('publishing.source-facts', () => factsFor(job, socialConfig, { key: item.key!, title: item.title ?? '', url: candidate.link ?? null, date: null }, deps))
    : null;
  const persona = candidate.platform === 'admin' ? await retryDatabaseRead('publishing.voice', () => approvedPersona(job)) : '';
  const preparedDeps = candidate.platform === 'admin' && deps.adminSession === undefined
    ? { ...deps, adminSession: await retryDatabaseRead('publishing.admin-session', () => adminSessionFor(job.organizationId, String(job.companyId))) }
    : deps;
  const delivery = await PublishDelivery.findOneAndUpdate({ ...filter, status: 'ready', platform: { $nin: MANUAL_ONLY } }, { $set: { status: 'publishing' } }, { new: true }).lean<{ _id: Types.ObjectId; platform: PublishPlatform; body: string; link?: string; assets?: { kind: string; url: string }[]; itemId: Types.ObjectId; values?: Record<string, string | boolean>; valuesReviewed?: boolean }>();
  if (!delivery) return { ok: false, status: 409, error: 'This post cannot be posted automatically, or it was already handled.' };
  let outcome: PostOutcome & { screenshot?: string | null; warning?: string };
  if (delivery.platform === 'admin') {
    const config = socialConfig;
    const facts: ItemFacts = adminFacts ?? { title: item?.facts?.title ?? item?.title ?? '', description: item?.facts?.description ?? '', text: '', image: null, images: [], video: null, extra: [], link: delivery.link ?? null };
    outcome = config
      ? await postToAdmin(job, config, delivery.values ?? {}, facts, { companyName: '', persona, subreddit: null }, deps.write ?? engineWriter(job), preparedDeps, delivery.valuesReviewed)
      : { ok: false, error: new PublishError('rejected', 'This job’s settings are missing.') };
  } else {
    outcome = await postTo(job, delivery.platform, postInput(delivery, item?.facts ?? {}), deps);
  }
  const shot = outcome.screenshot ? { screenshot: outcome.screenshot } : {};
  if (outcome.ok) {
    await PublishDelivery.updateOne({ _id: delivery._id }, { $set: { status: 'posted', postedUrl: outcome.url, postedAt: new Date(), postedByUserId: new Types.ObjectId(userId), ...shot, ...(outcome.warning ? { error: outcome.warning } : {}) }, ...(outcome.warning ? {} : { $unset: { error: '' } }) });
    return { ok: true };
  }
  await PublishDelivery.updateOne({ _id: delivery._id }, { $set: { status: 'ready', error: `Could not ${delivery.platform === 'admin' ? 'add it' : 'post'} automatically: ${outcome.error.message}`.slice(0, 1000), ...shot } });
  return { ok: false, status: 409, error: outcome.error.message };
}

/**
 * A post left "publishing" by a worker that stopped mid-call may or may not be live. It goes back to the
 * ready cards with a warning to check the platform first, instead of being retried (which could double-post).
 */
export async function recoverStuckDeliveries(now = new Date()): Promise<number> {
  const result = await PublishDelivery.updateMany(
    { status: 'publishing', updatedAt: { $lt: new Date(now.getTime() - 15 * 60_000) } },
    { $set: { status: 'ready', error: 'Nucleas stopped while posting this. Check the platform first: it may already be live. If it is, mark it posted.' } }
  );
  return result.modifiedCount ?? 0;
}

// ---------- Views ----------

export interface DeliveryView {
  id: string;
  platform: PublishPlatform;
  status: 'ready' | 'publishing' | 'posted' | 'failed' | 'skipped';
  itemTitle: string;
  title: string | null;
  body: string;
  link: string | null;
  assets: { kind: 'image' | 'video'; url: string }[];
  postedUrl: string | null;
  postedAt: string | null;
  error: string | null;
  createdAt: string;
  /** Admin records: each field as the form shows it, and the filled form (or the page after saving) as a JPEG. */
  fields: { label: string; value: string }[] | null;
  editableFields?: { key: string; label: string; type: string; required: boolean; options?: { value: string; label: string }[]; value: string | boolean }[];
  screenshot: string | null;
}

type DeliveryLean = { _id: Types.ObjectId; itemId: Types.ObjectId; platform: string; status: DeliveryView['status']; title?: string; body: string; link?: string; assets?: { kind: 'image' | 'video'; url: string }[]; postedUrl?: string; postedAt?: Date; error?: string; createdAt: Date; values?: Record<string, string | boolean>; screenshot?: string };

export interface PublishingView {
  redditDealNotice?: string;
  adminFieldRules?: PublishingConfig['adminFieldRules'];
  channels: PublishChannel[];
  minimumSocialValuePct?: number;
  notifyUserIds: string[];
  examples: Partial<Record<PublishPlatform, { url: string | null; text: string }>>;
  source: PublishingConfig['source'];
  /** Why a channel was switched to manual, to show next to it. */
  notes: Partial<Record<PublishPlatform, string>>;
  /** Admin jobs: the form being filled. */
  admin: { formUrl: string; listUrl: string | null; fields: { label: string; required: boolean }[] } | null;
  ready: DeliveryView[];
  recent: DeliveryView[];
  postedThisWeek: number;
}

export async function publishingView(job: { _id: Types.ObjectId; publishing?: unknown }): Promise<PublishingView | null> {
  const config = readConfig(job);
  if (!config) return null;
  const [ready, recent, postedThisWeek] = await Promise.all([
    PublishDelivery.find({ jobId: job._id, status: { $in: ['ready', 'publishing'] } }).select('+screenshot').sort({ createdAt: -1 }).limit(30).lean<DeliveryLean[]>(),
    PublishDelivery.find({ jobId: job._id, status: { $in: ['posted', 'skipped', 'failed'] } }).sort({ updatedAt: -1 }).limit(10).lean<DeliveryLean[]>(),
    PublishDelivery.countDocuments({ jobId: job._id, status: 'posted', postedAt: { $gte: new Date(Date.now() - 7 * 86_400_000) } }),
  ]);
  const items = new Map(
    (await PublishItem.find({ _id: { $in: [...ready, ...recent].map((d) => d.itemId) } }).select('title').lean<{ _id: Types.ObjectId; title?: string }[]>()).map((i) => [String(i._id), i.title ?? ''])
  );
  const view = (d: DeliveryLean): DeliveryView => ({
    id: String(d._id),
    platform: d.platform as PublishPlatform,
    status: d.status,
    itemTitle: items.get(String(d.itemId)) ?? '',
    title: d.title ?? null,
    body: d.body,
    link: d.link ?? null,
    assets: d.assets ?? [],
    postedUrl: d.postedUrl ?? null,
    postedAt: d.postedAt?.toISOString() ?? null,
    error: d.error ?? null,
    createdAt: d.createdAt.toISOString(),
    fields: d.platform === 'admin' && config.admin ? valueLines(config.admin.fields, d.values ?? {}) : null,
    ...(d.platform === 'admin' && config.admin ? { editableFields: config.admin.fields.filter(field => field.type !== 'file' && !/\bcasino\b/i.test(`${field.key.replaceAll('_', ' ')} ${field.label}`) && !/^slug$/i.test(field.key) && !/^slug$/i.test(field.label.trim())).map(field => ({ key: field.key, label: /^(notes|description)$/i.test(field.label.trim()) ? `Body / ${field.label.toLowerCase()}` : field.label || field.key, type: field.type, required: field.required, options: field.options, value: d.values?.[field.key] ?? (field.type === 'checkbox' ? false : '') })) } : {}),
    screenshot: d.screenshot ?? null,
  });
  const raw = (job.publishing ?? {}) as { notes?: Record<string, string> };
  let redditSelected = false;
  let heldReddit = 0;
  let redditHistory: Awaited<ReturnType<typeof redditDealHistory>> | undefined;
  const visibleReady: DeliveryLean[] = [];
  for (const delivery of ready) {
    if (delivery.platform === 'reddit' && config.redditDealPolicy && delivery.status === 'ready') {
      const full = await PublishDelivery.findById(delivery._id).lean();
      if (full && !redditHistory) redditHistory = await redditDealHistory(full);
      if (redditSelected || !full || await redditDealBlock(full, config.redditDealPolicy.timezone, new Date(), undefined, redditHistory)) { heldReddit += 1; continue; }
      redditSelected = true;
    }
    visibleReady.push(delivery);
  }
  return {
    ...(config.redditDealPolicy ? { redditDealNotice: `Reddit casino deals: one per day (${config.redditDealPolicy.timezone}); a casino cannot repeat within three deal posts.${heldReddit ? ` ${heldReddit} queued for a later eligible slot.` : ''}` } : {}),
    channels: config.channels,
    adminFieldRules: config.adminFieldRules,
    minimumSocialValuePct: config.minimumSocialValuePct,
    notifyUserIds: config.notifyUserIds,
    examples: Object.fromEntries(Object.entries(config.examples).map(([k, v]) => [k, { url: v.url ?? null, text: v.text }])),
    source: config.source,
    notes: raw.notes ?? {},
    admin: config.admin ? { formUrl: config.admin.formUrl, listUrl: config.admin.listUrl, fields: config.admin.fields.map((f) => ({ label: f.label || f.key, required: f.required })) } : null,
    ready: visibleReady.map(view),
    recent: recent.map(view),
    postedThisWeek,
  };
}

/** Explicitly queue one previously collected email for admin review; never submits the form. */
export async function queueExistingAdminItem(viewer: CompanyViewer, itemId: string, deps: PublishDeps = {}): Promise<{ jobId: string; status: string }> {
  if (!Types.ObjectId.isValid(itemId)) throw new Error('Email not found.');
  const item = await WatchItem.findOne({ _id: new Types.ObjectId(itemId), organizationId: viewer.organizationId, flagged: true }).lean();
  if (!item) throw new Error('Flagged email not found.');
  const jobs = await Job.find({ organizationId: viewer.organizationId, 'publishing.source.watchId': String(item.watchId), 'publishing.admin': { $exists: true }, status: { $in: ['ready', 'active'] } }).lean();
  if (jobs.length !== 1) throw new Error(jobs.length ? 'Several admin jobs watch this inbox. Pause duplicates first.' : 'Create and activate one admin job for this inbox in Marketing first.');
  const job = jobs[0];
  const config = readConfig(job);
  if (!config?.admin) throw new Error('Admin form settings are missing.');
  const profile = await getCompanyProfile(viewer, String(job.companyId));
  if (!profile) throw new Error('Company not accessible.');
  const stored = await PublishItem.findOneAndUpdate({ jobId: job._id, key: itemId }, { $setOnInsert: { organizationId: job.organizationId, companyId: job.companyId, jobId: job._id, key: itemId, title: item.subject, status: 'processed' } }, { upsert: true, new: true });
  const dedupe = dedupeKeyFor(item.fromEmail ?? undefined, item.bestDeal as DealMetrics | undefined);
  if (dedupe) {
    const matching = await PublishItem.find({ jobId: job._id, organizationId: job.organizationId, dedupeKey: dedupe, _id: { $ne: stored._id }, createdAt: { $gte: new Date(Date.now() - DEDUPE_DAYS * 86_400_000) } }).select('_id').lean();
    const prior = await PublishDelivery.findOne({ itemId: { $in: matching.map((m) => m._id) }, platform: 'admin', status: { $in: ['ready', 'publishing', 'posted'] } }).lean();
    if (prior) return { jobId: String(job._id), status: prior.status };
    await PublishItem.updateOne({ _id: stored._id }, { $set: { dedupeKey: dedupe } });
  }
  const existing = await PublishDelivery.findOne({ itemId: stored._id, platform: 'admin' }).lean();
  if (existing) return { jobId: String(job._id), status: existing.status };
  const facts = await factsFor(job, config, { key: itemId, title: item.subject, date: item.sentAt ?? null, url: item.link ?? null }, deps);
  const prepared = await prepareAdmin(config.admin, config, facts, { companyName: profile.name, persona: await approvedPersona(job), subreddit: null }, deps.write ?? engineWriter(job));
  if (!prepared.values || !Object.keys(prepared.values).length) throw new Error(prepared.problem ?? 'No form values could be prepared. Please retry.');
  await PublishItem.updateOne({ _id: stored._id }, { $set: { status: 'processed', facts: { title: facts.title, description: facts.description }, title: facts.title } });
  await PublishDelivery.updateOne({ itemId: stored._id, platform: 'admin' }, { $setOnInsert: { organizationId: job.organizationId, companyId: job.companyId, jobId: job._id, itemId: stored._id, platform: 'admin', mode: 'manual', status: 'ready', body: prepared.draft.body, values: prepared.values ?? {}, ...(facts.link ? { link: facts.link } : {}), ...(prepared.problem ? { error: prepared.problem } : {}) } }, { upsert: true });
  return { jobId: String(job._id), status: 'ready' };
}
