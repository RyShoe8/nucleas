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
import { getCompanyProfile, loadCompanyViewer } from '@/lib/companies/companyProfile';
import { askEngine } from '@/lib/ai/engine/ask';
import type { CostLevel } from '@/lib/ai/engine/select';
import { buildDealKey, formatDealLine } from '@/lib/watches/dealFormat';
import { adminSessionFor } from '@/lib/companies/adminAccount';
import type { DealMetrics } from '@/lib/watches/types';
import { heartbeatJobRun } from '@/lib/jobs/runLifecycle';
import type { JobRunOutput } from '@/lib/jobs/schema';
import { MANUAL_ONLY, PLATFORM_LABEL, SOCIAL_PLATFORMS, publishingConfigSchema, type AdminTarget, type PublishChannel, type PublishPlatform, type PublishingConfig } from './config';
import { addRecord, fillValues, valueLines, type AdminBrowser, type AdminSession } from './admin';
import { workerAdminBrowser } from './adminBrowser';
import { composePost, type Draft, type Writer } from './compose';
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
  title: string;
  description: string;
  text: string;
  image: string | null;
  images: string[];
  video: string | null;
  extra: string[];
  link: string | null;
}

type JobLike = { _id: Types.ObjectId; organizationId: Types.ObjectId; companyId: Types.ObjectId; createdByUserId: Types.ObjectId; level?: CostLevel | null; publishing?: unknown };

export function readConfig(job: { publishing?: unknown }): PublishingConfig | null {
  const parsed = publishingConfigSchema.safeParse(job.publishing);
  return parsed.success ? parsed.data : null;
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
    .select('_id subject sentAt link fromEmail bestDeal')
    .lean<{ _id: Types.ObjectId; subject?: string; sentAt?: Date; link?: string; fromEmail?: string; bestDeal?: DealMetrics }[]>();
  return rows.map((r) => ({ key: String(r._id), url: r.link ?? null, title: r.subject ?? '', date: r.sentAt ?? null, dedupe: dedupeKeyFor(r.fromEmail, r.bestDeal) }));
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
      .select('subject summary keyPoints bestDeal values link fromName')
      .lean<{ subject?: string; summary?: string; keyPoints?: { text?: string }[]; bestDeal?: DealMetrics; values?: Record<string, string>; link?: string; fromName?: string }>(),
    ContentWatch.findOne({ _id: new Types.ObjectId(config.source.watchId), organizationId: job.organizationId }).select('fields rank mode threshold minDiscountPct').lean(),
  ]);
  const fields = watch ? watchSettings(watch).fields : [];
  return {
    title: item?.subject ?? entry.title,
    description: item?.summary ?? '',
    text: '',
    image: null,
    images: [],
    video: null,
    extra: [
      item?.fromName ? `From: ${item.fromName}` : '',
      item?.bestDeal ? `Deal: ${formatDealLine(item.bestDeal)}` : '',
      ...watchValueLines(item?.values, fields),
      ...(item?.keyPoints ?? []).slice(0, 6).map((p) => `Key fact: ${p.text ?? ''}`),
    ].filter(Boolean),
    link: item?.link ?? entry.url,
  };
}

// ---------- Drafting ----------

async function approvedPersona(job: JobLike): Promise<string | null> {
  const voice = await BrandVoice.findOne({ organizationId: job.organizationId, companyId: job.companyId, status: 'approved' }).select('persona').lean<{ persona?: string }>();
  return voice?.persona?.trim() || null;
}

function engineWriter(job: JobLike): Writer {
  return async ({ system, user, maxTokens }) =>
    (await askEngine({ organizationId: String(job.organizationId), userId: String(job.createdByUserId), need: 'write', level: job.level ?? undefined, system, user, maxTokens }))?.text ?? null;
}

/** When no model can write, a plain post from the facts still lets a person post it (never auto-posted). */
function fallbackDraft(platform: PublishPlatform, facts: ItemFacts, noun: string): Draft {
  const body = [facts.description || `A new ${noun} is here.`, platform === 'reddit' && facts.link ? facts.link : ''].filter(Boolean).join('\n\n');
  return { title: platform === 'reddit' ? `New ${noun}: ${facts.title}`.slice(0, 300) : null, body: platform === 'bluesky' ? body.slice(0, 290) : body };
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
async function postToAdmin(job: JobLike, config: PublishingConfig, values: Record<string, string | boolean>, facts: ItemFacts, context: DraftContext, write: Writer, deps: PublishDeps): Promise<AdminPostOutcome> {
  if (!config.admin) return { ok: false, error: new PublishError('rejected', 'This job has no admin form set up.'), screenshot: null };
  const session = deps.adminSession !== undefined ? deps.adminSession : await adminSessionFor(job.organizationId, String(job.companyId));
  if (!session) return { ok: false, error: new PublishError('needs_reauth', 'The admin session has expired or is missing. Log in again (Company → Admin account), then switch Admin back to Auto.'), screenshot: null };
  const outcome = await addRecord({
    session,
    target: config.admin,
    values,
    browser: deps.admin ?? workerAdminBrowser,
    refill: async (target) => {
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

/** Marks everything the source lists right now as already seen, so switching a job on never posts the back catalog. */
export async function takeBaseline(job: JobLike, deps: PublishDeps = {}): Promise<number> {
  const config = readConfig(job);
  if (!config) return 0;
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

  // A dry run drafts posts for the newest item and delivers nothing.
  if (run.dryRun) {
    const newest = entries[0];
    if (!newest) return fail(`No ${noun}s were found to try a sample with.`);
    await progress(run._id, owner, `Writing sample posts for “${newest.title || newest.key}”`, 'researching', 40);
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
        : `Sample posts for the newest ${noun}, “${facts.title}”. Nothing was posted. Accept to switch the job on: it checks every hour, and only ${noun}s that appear after that are posted.`,
      gaps,
    };
    const saved = await finishRun(run._id, owner, 'needs_review', { output });
    if (saved) await notifyPeople(job.organizationId, config.notifyUserIds, { subject: `Sample posts ready to check · ${profile.name}`, intro: `Nucleas wrote sample posts for the newest ${noun} (“${facts.title}”). Check them, then accept to switch the job on.`, lines: [], action: 'Review the samples' }, deps.send);
    return;
  }

  const current = await Job.findById(job._id).select('publishing.baselineAt').lean<{ publishing?: { baselineAt?: Date } }>();
  if (!current?.publishing?.baselineAt) {
    const count = await takeBaseline(job, deps);
    await finishRun(run._id, owner, 'completed', { output: { records: [], summary: `Recorded the ${count} ${noun}${count === 1 ? '' : 's'} that already exist. New ones are posted from now on.`, gaps: [] } });
    return;
  }

  const known = new Set((await PublishItem.find({ jobId: job._id, key: { $in: entries.map((e) => e.key) } }).select('key').lean<{ key: string }[]>()).map((r) => r.key));
  const fresh = entries.filter((e) => !known.has(e.key)).reverse(); // oldest first, so posts go out in release order

  if (fresh.length > MAX_NEW_PER_RUN) {
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
  const summary = handled
    ? `${handled} new ${noun}${handled === 1 ? '' : 's'}. ${posted} ${posted === 1 ? 'was' : 'were'} published or added${ready.length ? `, ${ready.length} ready to do by hand` : ''}.${repeats ? ` ${repeats} repeat${repeats === 1 ? '' : 's'} of earlier ${noun}s skipped.` : ''}`
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
  const done = await PublishDelivery.updateOne({ ...filter, status: 'ready' }, { $set: { status: 'posted', postedAt: new Date(), postedByUserId: new Types.ObjectId(userId), ...(url ? { postedUrl: url } : {}) }, $unset: { error: '' } });
  return done.modifiedCount ? { ok: true } : { ok: false, status: 409, error: 'Someone already handled this post.' };
}

export async function skipDelivery(job: { _id: Types.ObjectId; organizationId: Types.ObjectId }, deliveryId: string, userId: string): Promise<DeliveryResult> {
  const filter = deliveryFilter(job, deliveryId);
  if (!filter) return { ok: false, status: 404, error: 'Post not found.' };
  const done = await PublishDelivery.updateOne({ ...filter, status: 'ready' }, { $set: { status: 'skipped', postedByUserId: new Types.ObjectId(userId) } });
  return done.modifiedCount ? { ok: true } : { ok: false, status: 409, error: 'Someone already handled this post.' };
}

/** Edit a card's text before it is posted. */
export async function editDelivery(job: { _id: Types.ObjectId; organizationId: Types.ObjectId }, deliveryId: string, change: { title?: string; body?: string }): Promise<DeliveryResult> {
  const filter = deliveryFilter(job, deliveryId);
  if (!filter) return { ok: false, status: 404, error: 'Post not found.' };
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
export async function postDeliveryNow(job: JobLike, deliveryId: string, userId: string, deps: PublishDeps = {}): Promise<DeliveryResult> {
  const filter = deliveryFilter(job, deliveryId);
  if (!filter) return { ok: false, status: 404, error: 'Post not found.' };
  const delivery = await PublishDelivery.findOneAndUpdate({ ...filter, status: 'ready', platform: { $nin: MANUAL_ONLY } }, { $set: { status: 'publishing' } }, { new: true }).lean<{ _id: Types.ObjectId; platform: PublishPlatform; body: string; link?: string; assets?: { kind: string; url: string }[]; itemId: Types.ObjectId; values?: Record<string, string | boolean> }>();
  if (!delivery) return { ok: false, status: 409, error: 'This post cannot be posted automatically, or it was already handled.' };
  const item = await PublishItem.findById(delivery.itemId).select('facts title').lean<{ title?: string; facts?: { title?: string; description?: string } }>();
  let outcome: PostOutcome & { screenshot?: string | null; warning?: string };
  if (delivery.platform === 'admin') {
    const config = readConfig((await Job.findById(job._id).select('publishing').lean<{ publishing?: unknown }>()) ?? {});
    const persona = await approvedPersona(job);
    const facts: ItemFacts = { title: item?.facts?.title ?? item?.title ?? '', description: item?.facts?.description ?? '', text: '', image: null, images: [], video: null, extra: [], link: delivery.link ?? null };
    outcome = config
      ? await postToAdmin(job, config, delivery.values ?? {}, facts, { companyName: '', persona, subreddit: null }, deps.write ?? engineWriter(job), deps)
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
  screenshot: string | null;
}

type DeliveryLean = { _id: Types.ObjectId; itemId: Types.ObjectId; platform: string; status: DeliveryView['status']; title?: string; body: string; link?: string; assets?: { kind: 'image' | 'video'; url: string }[]; postedUrl?: string; postedAt?: Date; error?: string; createdAt: Date; values?: Record<string, string | boolean>; screenshot?: string };

export interface PublishingView {
  channels: PublishChannel[];
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
    screenshot: d.screenshot ?? null,
  });
  const raw = (job.publishing ?? {}) as { notes?: Record<string, string> };
  return {
    channels: config.channels,
    notifyUserIds: config.notifyUserIds,
    examples: Object.fromEntries(Object.entries(config.examples).map(([k, v]) => [k, { url: v.url ?? null, text: v.text }])),
    source: config.source,
    notes: raw.notes ?? {},
    admin: config.admin ? { formUrl: config.admin.formUrl, listUrl: config.admin.listUrl, fields: config.admin.fields.map((f) => ({ label: f.label || f.key, required: f.required })) } : null,
    ready: ready.map(view),
    recent: recent.map(view),
    postedThisWeek,
  };
}
