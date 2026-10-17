import 'server-only';
import { Types } from 'mongoose';
import { z } from 'zod';
import { Job } from '@/lib/models/Job';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { ContentWatch } from '@/lib/models/Watch';
import { IntegrationConnection } from '@/lib/models/Integration';
import { readConnectionCredential } from '@/lib/integrations/connections';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import { askEngine } from '@/lib/ai/engine/ask';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { readEngineSettings } from '@/lib/ai/engine/select';
import { socialPublishDesign } from '@/lib/jobs/templates/socialPublish';
import { MANUAL_ONLY, PLATFORM_LABEL, PUBLISH_PLATFORMS, channelSchema, normalizeChannels, publishSourceSchema, sourceLabel, type PublishPlatform, type PublishSource, type PublishingConfig } from './config';
import { readExamplePost } from './examples';
import { discoverSiteSource, type PickPrefix } from './siteSource';
import { facebookTokenCanPost } from './publishers';
import { keepOrgPeople, listOrgPeople } from './notify';
import type { FetchLike } from './fetchPublic';

/**
 * Setting up a publishing job from one sentence. Nucleas recognizes what kind of job the request is,
 * finds the source (the site's feed and section, or the inbox watch), checks which accounts can post by
 * themselves, and returns a short plan the person confirms. Nothing is created until they do.
 */

export type RequestKind = 'social_publish' | 'link_building' | 'marketing_plan' | 'custom';

/** Which kind of job a request is. Cheap and predictable: anything not clearly one of ours is a custom job Nucleas designs. */
export function recognizeRequest(text: string): RequestKind {
  const t = text.toLowerCase();
  if (/\b(backlinks?|link[- ]?building|dofollow)\b/.test(t)) return 'link_building';
  if (/\bmarketing (plan|overview|strategy)\b/.test(t)) return 'marketing_plan';
  const social = /\b(facebook|bluesky|bsky|reddit|subreddit|social|socials|social media)\b/.test(t);
  const announce = /\b(post|posts|posting|share|announce|publish|promote)\b/.test(t);
  if (social && announce) return 'social_publish';
  return 'custom';
}

/** Whether the request is about email (a watched inbox) rather than new pages on the site. */
export function wantsMailbox(text: string): boolean {
  return /\b(e-?mails?|inbox|mailbox|newsletters?)\b/i.test(text);
}

/** Platforms the request names; none named means every platform the company has. */
export function platformsNamed(text: string): PublishPlatform[] {
  const t = text.toLowerCase();
  const named = PUBLISH_PLATFORMS.filter((p) => (p === 'bluesky' ? /\b(bluesky|bsky)\b/.test(t) : new RegExp(`\\b${p}\\b`).test(t)));
  return named;
}

export interface ChannelOption {
  platform: PublishPlatform;
  /** Selected by default: the request names it, or the company has the account. */
  selected: boolean;
  canAuto: boolean;
  mode: 'auto' | 'manual';
  /** Why automatic posting is not available, in plain words. */
  note: string | null;
}

export interface PublishPlan {
  kind: 'social_publish';
  title: string;
  source: PublishSource;
  sourceLabel: string;
  newest: { title: string; url: string | null } | null;
  channels: ChannelOption[];
  people: { userId: string; name: string }[];
  notifyUserIds: string[];
  /** Something to fix before the job can run (e.g. an unapproved Voice). Shown, not hidden. */
  blocker: string | null;
}

export type PlanResult = { ok: true; plan: PublishPlan | { kind: Exclude<RequestKind, 'social_publish'> } } | { ok: false; status: 400 | 403 | 404; error: string };

export interface SetupDeps {
  fetcher?: FetchLike;
  pick?: PickPrefix;
  canPostFacebook?: (token: string) => Promise<boolean | null>;
}

function modelPick(viewer: CompanyViewer): PickPrefix {
  return async ({ brief, groups }) => {
    const answer = await askEngine({
      organizationId: String(viewer.organizationId),
      userId: viewer.userId,
      need: 'plan',
      system: 'Pick the website section a request is about. Reply with exactly one prefix from the list, or "none".',
      user: `Request: ${brief}\n\nSections (prefix: number of pages):\n${groups.map((g) => `${g.prefix}: ${g.count}`).join('\n')}`,
      maxTokens: 40,
    }).catch(() => null);
    const picked = answer?.text.trim().split(/\s+/)[0] ?? '';
    return groups.some((g) => g.prefix === picked) ? picked : null;
  };
}

async function channelOptions(viewer: CompanyViewer, companyId: string, request: string, subreddit: string | null, socialNetworks: string[], deps: SetupDeps): Promise<ChannelOption[]> {
  const connections = await IntegrationConnection.find({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId), provider: { $in: ['facebook', 'bluesky'] }, status: 'connected' })
    .select('_id provider')
    .lean<{ _id: Types.ObjectId; provider: string }[]>();
  const connected = new Map(connections.map((c) => [c.provider, c._id]));
  const named = platformsNamed(request);
  const out: ChannelOption[] = [];
  for (const platform of PUBLISH_PLATFORMS) {
    let canAuto = false;
    let note: string | null = null;
    if (MANUAL_ONLY.includes(platform)) {
      note = subreddit ? `Reddit has no posting API: Nucleas prepares the post for r/${subreddit} and tells your team.` : 'Reddit has no posting API, and no subreddit is set for this company (add it in the Company window).';
    } else if (!connected.has(platform)) {
      note = `${PLATFORM_LABEL[platform]} is not connected, so posts come as ready-to-post cards. Connect it in the company’s integrations to post automatically.`;
    } else if (platform === 'facebook') {
      const token = await readConnectionCredential(viewer.organizationId, connected.get('facebook')!).catch(() => null);
      const allowed = token ? await (deps.canPostFacebook ?? facebookTokenCanPost)(token) : null;
      canAuto = Boolean(token) && allowed !== false;
      if (!token) note = 'The Facebook connection has no usable Page token. Reconnect Facebook (Company → Integrations) to post automatically.';
      else if (allowed === false) note = 'The Facebook connection can read the Page but not post to it. Reconnect Facebook (Company → Integrations) and allow posting.';
    } else {
      canAuto = true;
    }
    const has = connected.has(platform) || socialNetworks.includes(platform) || (platform === 'reddit' && Boolean(subreddit));
    out.push({ platform, selected: named.length ? named.includes(platform) : has, canAuto, mode: canAuto ? 'auto' : 'manual', note });
  }
  return out;
}

export async function planRequest(viewer: CompanyViewer, input: { companyId: string; request: string }, deps: SetupDeps = {}): Promise<PlanResult> {
  const request = input.request.trim();
  if (request.length < 10 || request.length > 2000) return { ok: false, status: 400, error: 'Describe what you want in a sentence (10–2000 characters).' };
  const kind = recognizeRequest(request);
  if (kind !== 'social_publish') return { ok: true, plan: { kind } };
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can set up publishing jobs.' };
  const profile = await getCompanyProfile(viewer, input.companyId);
  if (!profile) return { ok: false, status: 404, error: 'Company not found.' };

  let source: PublishSource;
  let newest: PublishPlan['newest'] = null;
  if (wantsMailbox(request)) {
    const watch = await ContentWatch.findOne({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(input.companyId), active: true })
      .sort({ mode: 1, createdAt: 1 })
      .select('_id mode')
      .lean<{ _id: Types.ObjectId; mode?: string }>();
    if (!watch) return { ok: false, status: 400, error: `${profile.name} has no inbox being watched yet. Connect the mailbox in Content first.` };
    source = { type: 'mailbox', watchId: String(watch._id), noun: watch.mode === 'deal' ? 'deal' : 'email' };
  } else {
    if (!profile.domain) return { ok: false, status: 400, error: `Add ${profile.name}’s website in the Company window first, so Nucleas knows where to look.` };
    const found = await discoverSiteSource({ domain: profile.domain, brief: request, fetcher: deps.fetcher, pick: deps.pick ?? modelPick(viewer) });
    if (!found.ok) return { ok: false, status: 400, error: found.error };
    source = { type: 'site', feedUrl: found.feedUrl, feedKind: found.feedKind, pathPrefix: found.pathPrefix, noun: found.noun };
    newest = found.newest ? { title: found.newest.title ?? new URL(found.newest.url).pathname, url: found.newest.url } : null;
  }

  const voice = await BrandVoice.exists({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(input.companyId), status: 'approved' });
  const people = (await listOrgPeople(viewer.organizationId)).map((p) => ({ userId: p.userId, name: p.name }));
  return {
    ok: true,
    plan: {
      kind: 'social_publish',
      title: `Post new ${source.noun}s to social`,
      source,
      sourceLabel: sourceLabel(source, profile.domain ?? null),
      newest,
      channels: await channelOptions(viewer, input.companyId, request, profile.subreddit ?? null, profile.socialLinks.map((l) => l.network), deps),
      people,
      notifyUserIds: people.some((p) => p.userId === viewer.userId) ? [viewer.userId] : [],
      blocker: voice ? null : `${profile.name}’s Voice is not approved yet. Approve it (Company → Voice) so posts sound like the brand.`,
    },
  };
}

const createSchema = z.object({
  companyId: z.string().regex(/^[a-f0-9]{24}$/i),
  request: z.string().trim().min(10).max(2000),
  source: publishSourceSchema,
  channels: z.array(channelSchema).min(1, 'Choose at least one platform.'),
  notifyUserIds: z.array(z.string()).max(50).default([]),
  examples: z.record(z.enum(PUBLISH_PLATFORMS), z.string().max(6000)).default({}),
});

/** An example given as a link is read now; a failure is an error the person can fix by pasting the text. */
async function resolveExamples(raw: Partial<Record<PublishPlatform, string>>, fetcher?: FetchLike): Promise<{ ok: true; examples: PublishingConfig['examples'] } | { ok: false; error: string }> {
  const examples: PublishingConfig['examples'] = {};
  for (const platform of PUBLISH_PLATFORMS) {
    const value = raw[platform]?.trim();
    if (!value) continue;
    if (/^https?:\/\/\S+$/.test(value)) {
      const read = await readExamplePost(platform, value, fetcher);
      if (!read.ok) return { ok: false, error: `${PLATFORM_LABEL[platform]} example: ${read.error}` };
      examples[platform] = { url: value, text: read.text.slice(0, 6000) };
    } else {
      examples[platform] = { text: value.slice(0, 6000) };
    }
  }
  return { ok: true, examples };
}

async function checkSource(viewer: CompanyViewer, companyId: string, source: PublishSource): Promise<string | null> {
  if (source.type === 'mailbox') {
    const watch = await ContentWatch.exists({ _id: new Types.ObjectId(source.watchId), organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId) });
    return watch ? null : 'That inbox watch is not available for this company.';
  }
  try {
    assertSafePublicHttpsUrl(source.feedUrl);
  } catch {
    return 'The feed address is not allowed.';
  }
  return null;
}

export type CreateResult = { ok: true; jobId: string } | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/** Creates the job as proposed; the caller approves it straight into a dry run. */
export async function createPublishingJob(viewer: CompanyViewer, raw: unknown, deps: SetupDeps = {}): Promise<CreateResult> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can set up publishing jobs.' };
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? 'Check the job settings.' };
  const input = parsed.data;
  const profile = await getCompanyProfile(viewer, input.companyId);
  if (!profile) return { ok: false, status: 404, error: 'Company not found.' };
  const bad = await checkSource(viewer, input.companyId, input.source);
  if (bad) return { ok: false, status: 400, error: bad };
  const sameSource = input.source.type === 'site' ? { 'publishing.source.feedUrl': input.source.feedUrl, 'publishing.source.pathPrefix': input.source.pathPrefix } : { 'publishing.source.watchId': input.source.watchId };
  if (await Job.exists({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(input.companyId), 'design.skill': 'social_publish', status: { $nin: ['rejected', 'archived', 'done'] }, ...sameSource })) {
    return { ok: false, status: 409, error: `${profile.name} already has a job posting these ${input.source.noun}s. Open it to change its platforms.` };
  }
  const examples = await resolveExamples(input.examples, deps.fetcher);
  if (!examples.ok) return { ok: false, status: 400, error: examples.error };
  const channels = normalizeChannels(input.channels);
  const config: PublishingConfig = {
    source: input.source,
    channels,
    examples: examples.examples,
    notifyUserIds: await keepOrgPeople(viewer.organizationId, input.notifyUserIds),
    brief: input.request,
  };
  const level = (await readEngineSettings(String(viewer.organizationId))).defaultCostLevel;
  const doc = await Job.create({
    organizationId: viewer.organizationId,
    companyId: new Types.ObjectId(input.companyId),
    createdByUserId: new Types.ObjectId(viewer.userId),
    status: 'proposed',
    request: input.request,
    design: socialPublishDesign({ noun: input.source.noun, sourceLabel: sourceLabel(input.source, profile.domain ?? null), platforms: channels.map((c) => PLATFORM_LABEL[c.platform]) }),
    publishing: config,
    level,
    designCostMicros: 0,
    events: [{ at: new Date(), userId: new Types.ObjectId(viewer.userId), action: 'skill_configured', note: 'social_publish' }],
  });
  return { ok: true, jobId: String(doc._id) };
}

const settingsSchema = z.object({
  channels: z.array(channelSchema).min(1, 'Keep at least one platform.').optional(),
  notifyUserIds: z.array(z.string()).max(50).optional(),
  examples: z.record(z.enum(PUBLISH_PLATFORMS), z.string().max(6000)).optional(),
});

/** Change a running job's platforms, auto/manual choices, notify list or examples. Managers only. */
export async function updatePublishingSettings(viewer: CompanyViewer, job: { _id: Types.ObjectId; organizationId: Types.ObjectId; publishing?: unknown }, raw: unknown, deps: SetupDeps = {}): Promise<{ ok: true } | { ok: false; status: 400 | 403; error: string }> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can change publishing settings.' };
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? 'Check the settings.' };
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  if (parsed.data.channels) {
    const channels = normalizeChannels(parsed.data.channels);
    set['publishing.channels'] = channels;
    // Switching a channel back to auto means the person fixed the account: drop the old warning.
    for (const c of channels) if (c.mode === 'auto') unset[`publishing.notes.${c.platform}`] = '';
  }
  if (parsed.data.notifyUserIds) set['publishing.notifyUserIds'] = await keepOrgPeople(viewer.organizationId, parsed.data.notifyUserIds);
  if (parsed.data.examples) {
    const examples = await resolveExamples(parsed.data.examples, deps.fetcher);
    if (!examples.ok) return { ok: false, status: 400, error: examples.error };
    set['publishing.examples'] = examples.examples;
  }
  if (!Object.keys(set).length) return { ok: false, status: 400, error: 'Nothing to change.' };
  await Job.updateOne({ _id: job._id, organizationId: job.organizationId }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  return { ok: true };
}
