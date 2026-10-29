import { eventRoundupSource, wantsEventRoundup, readEventRoundup } from './eventRoundup';
import { PublishingImage } from '@/lib/models/PublishingImage';
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
import { nextScheduledAt } from '@/lib/jobs/schedule';
import { jobScheduleSchema } from '@/lib/jobs/schema';
import { MANUAL_ONLY, PLATFORM_LABEL, PUBLISH_PLATFORMS, cadenceLabel, SOCIAL_PLATFORMS, publishingConfigSchema, adminFieldRulesSchema, adminTargetSchema, channelSchema, type AdminTarget, normalizeChannels, platformsFor, publishSourceSchema, sourceLabel, type PublishPlatform, type PublishSource, type PublishingConfig } from './config';
import { readExamplePost } from './examples';
import { discoverSiteSource, nounFromRequest, type PickPrefix } from './siteSource';
import { facebookTokenCanPost } from './publishers';
import { keepOrgPeople, listOrgPeople } from './notify';
import type { FetchLike } from './fetchPublic';
import { learnAdminForm, type AdminBrowser, type PickLink } from './admin';
import { adminBrowserReady, workerAdminBrowser } from './adminBrowser';
import { adminSessionFor } from '@/lib/companies/adminAccount';
import { adminPublishDesign } from '@/lib/jobs/templates/socialPublish';

/**
 * Setting up a publishing job from one sentence. Nucleas recognizes what kind of job the request is,
 * finds the source (the site's feed and section, or the inbox watch), checks which accounts can post by
 * themselves, and returns a short plan the person confirms. Nothing is created until they do.
 */

export type RequestKind = 'social_publish' | 'admin_publish' | 'link_building' | 'marketing_plan' | 'custom';

/** Which kind of job a request is. Cheap and predictable: anything not clearly one of ours is a custom job Nucleas designs. */
export function recognizeRequest(text: string): RequestKind {
  const t = text.toLowerCase();
  if (/\b(backlinks?|link[- ]?building|dofollow)\b/.test(t)) return 'link_building';
  if (/\bmarketing (plan|overview|strategy)\b/.test(t)) return 'marketing_plan';
  if (/\b(admin|back ?end|backoffice|cms)\b/.test(t) && /\b(add|adds|post|posts|put|publish|create|enter|list|upload)\b/.test(t)) return 'admin_publish';
  const social = /\b(facebook|bluesky|bsky|reddit|subreddit|social|socials|social media)\b/.test(t);
  const announce = /\b(post|posts|posting|share|announce|publish|promote)\b/.test(t);
  if (social && announce) return 'social_publish';
  return 'custom';
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8 };

/**
 * "one article every 3 weeks, in order": an evergreen rotation rather than posting what is new. It needs a cadence
 * ("every 3 weeks", "every other week", "monthly") and must not be about new or latest pages.
 */
export function parseRotation(text: string): { everyDays: number } | null {
  const t = text.toLowerCase();
  const evergreen = /\bever[- ]?green\b|\bin order\b|\bone (?:article|post|guide|page)\b.*\bevery\b/.test(t);
  if (!evergreen && /\b(new|newly|latest|fresh|just published)\b/.test(t)) return null;
  const every = /\bevery\s+(other\s+)?(?:(\d{1,3})|(a|an|one|two|three|four|five|six|eight))?\s*(day|week|month)s?\b/.exec(t);
  let days: number | null = null;
  if (every) {
    const count = every[2] ? Number(every[2]) : every[3] ? NUMBER_WORDS[every[3]]! : 1;
    const unit = every[4] === 'day' ? 1 : every[4] === 'week' ? 7 : 30;
    days = (every[1] ? 2 : 1) * count * unit;
  } else if (/\bweekly\b/.test(t)) days = 7;
  else if (/\bmonthly\b/.test(t)) days = 30;
  else if (/\bdaily\b/.test(t)) days = 1;
  return days && days >= 1 && days <= 365 ? { everyDays: days } : null;
}

/** Whether the request is about email (a watched inbox) rather than new pages on the site. */
export function wantsMailbox(text: string): boolean {
  return /\b(e-?mails?|inbox|mailbox|newsletters?)\b/i.test(text);
}

/** Platforms the request names; none named means every platform the company has. */
export function platformsNamed(text: string): PublishPlatform[] {
  const t = text.toLowerCase();
  const named = SOCIAL_PLATFORMS.filter((p) => (p === 'bluesky' ? /\b(bluesky|bsky)\b/.test(t) : new RegExp(`\\b${p}\\b`).test(t)));
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
  /** Admin jobs: the form Nucleas learned, sent back unchanged when the plan is confirmed. */
  admin: AdminTarget | null;
}

export type PlanResult = { ok: true; plan: PublishPlan | { kind: Exclude<RequestKind, 'social_publish' | 'admin_publish'> } } | { ok: false; status: 400 | 403 | 404; error: string };

export interface SetupDeps {
  fetcher?: FetchLike;
  pick?: PickPrefix;
  canPostFacebook?: (token: string) => Promise<boolean | null>;
  admin?: AdminBrowser;
  adminSession?: { baseUrl: string; cookies: unknown[] } | null;
  pickLink?: PickLink;
}

function modelPickLink(viewer: CompanyViewer): PickLink {
  return async ({ request, noun, links }) => {
    const answer = await askEngine({
      organizationId: String(viewer.organizationId),
      userId: viewer.userId,
      need: 'plan',
      system: `Pick the admin link that opens the form for adding a new ${noun}. Reply with exactly one address from the list, or "none".`,
      user: `Request: ${request}\n\nLinks:\n${links.map((l) => `${l.text || '(no text)'} → ${l.href}`).join('\n')}`,
      maxTokens: 120,
    }).catch(() => null);
    const picked = answer?.text.trim().split(/\s+/)[0] ?? '';
    return links.some((l) => l.href === picked) ? picked : null;
  };
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
  for (const platform of SOCIAL_PLATFORMS) {
    let canAuto = false;
    let note: string | null = null;
    if (MANUAL_ONLY.includes(platform)) {
      note = subreddit ? `Automatic Reddit posting is not supported in Nucleas yet: Nucleas prepares the post for r/${subreddit} and tells your team.` : 'Automatic Reddit posting is not supported in Nucleas yet, and no subreddit is set for this company (add it in the Company window).';
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
    out.push({ platform, selected: named.length ? named.includes(platform) : has, canAuto, mode: canAuto && !/review|approv|manual|by hand/i.test(request) ? 'auto' : 'manual', note });
  }
  return out;
}

export async function planRequest(viewer: CompanyViewer, input: { companyId: string; request: string }, deps: SetupDeps = {}): Promise<PlanResult> {
  const request = input.request.trim();
  if (request.length < 10 || request.length > 2000) return { ok: false, status: 400, error: 'Describe what you want in a sentence (10–2000 characters).' };
  const kind = recognizeRequest(request);
  if (kind !== 'social_publish' && kind !== 'admin_publish') return { ok: true, plan: { kind } };
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can set up publishing jobs.' };
  const profile = await getCompanyProfile(viewer, input.companyId);
  if (!profile) return { ok: false, status: 404, error: 'Company not found.' };

  let source: PublishSource;
  let newest: PublishPlan['newest'] = null;
  let eventSource: PublishSource | null;
  try { eventSource = profile.domain && kind === 'social_publish' ? eventRoundupSource(profile.domain, request) : null; }
  catch (error) { return { ok: false, status: 400, error: error instanceof Error ? error.message : 'Check the event schedule.' }; }
  if (kind === 'social_publish' && wantsEventRoundup(request) && !eventSource) return { ok: false, status: 400, error: 'This request needs a connected scheduled-events source. Nucleas will not replace it with a new-page watcher.' };
  if (eventSource && eventSource.type === 'site') {
    source = eventSource;
    try { const preview = await readEventRoundup(eventSource, deps.fetcher); newest = preview ? { title: preview.title, url: preview.url } : null; }
    catch (error) { return { ok: false, status: 400, error: error instanceof Error ? error.message : 'Could not read the scheduled event records.' }; }
  } else if (wantsMailbox(request)) {
    const watch = await ContentWatch.findOne({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(input.companyId), active: true })
      .sort({ mode: 1, createdAt: 1 })
      .select('_id mode noun')
      .lean<{ _id: Types.ObjectId; mode?: string; noun?: string }>();
    if (!watch) return { ok: false, status: 400, error: `${profile.name} has no inbox being watched yet. Connect it in Marketing → Inboxes first.` };
    source = { type: 'mailbox', watchId: String(watch._id), noun: watch.noun || (watch.mode === 'deal' ? 'deal' : 'email') };
  } else {
    if (!profile.domain) return { ok: false, status: 400, error: `Add ${profile.name}’s website in the Company window first, so Nucleas knows where to look.` };
    const found = await discoverSiteSource({ domain: profile.domain, brief: request, fetcher: deps.fetcher, pick: deps.pick ?? modelPick(viewer) });
    if (!found.ok) return { ok: false, status: 400, error: found.error };
    const rotation = parseRotation(request);
    // For a rotation, the noun is what the person called one item ("one article"); otherwise the section's own name.
    source = { type: 'site', feedUrl: found.feedUrl, feedKind: found.feedKind, pathPrefix: found.pathPrefix, noun: (rotation && nounFromRequest(request)) || found.noun, ...(rotation ? { rotation } : {}) };
    newest = found.newest ? { title: found.newest.title ?? new URL(found.newest.url).pathname, url: found.newest.url } : null;
  }

  const people = (await listOrgPeople(viewer.organizationId)).map((p) => ({ userId: p.userId, name: p.name }));
  const notifyUserIds = people.some((p) => p.userId === viewer.userId) ? [viewer.userId] : [];

  if (kind === 'admin_publish') {
    if (!deps.admin && !adminBrowserReady()) return { ok: false, status: 400, error: 'The browser worker is not configured on the server, so Nucleas cannot open the admin.' };
    const session = deps.adminSession !== undefined ? deps.adminSession : await adminSessionFor(viewer.organizationId, input.companyId);
    if (!session) return { ok: false, status: 400, error: `Connect ${profile.name}’s admin account first (Company → Admin account), so Nucleas can sign in to the admin.` };
    const learned = await learnAdminForm({ session, request, noun: source.noun, browser: deps.admin ?? workerAdminBrowser, pick: deps.pickLink ?? modelPickLink(viewer) }).catch((error: unknown) => ({ ok: false as const, error: `Nucleas could not open the admin: ${error instanceof Error ? error.message : 'unknown error'}` }));
    if (!learned.ok) return { ok: false, status: 400, error: learned.error };
    const host = new URL(learned.target.baseUrl).host;
    return {
      ok: true,
      plan: {
        kind: 'social_publish',
        title: `Add new ${source.noun}s to the ${host} admin`,
        source,
        sourceLabel: sourceLabel(source, profile.domain ?? null),
        newest,
        channels: [{ platform: 'admin', selected: true, canAuto: true, mode: /review|approv|manual|by hand/i.test(request) ? 'manual' : 'auto', note: null }],
        people,
        notifyUserIds,
        blocker: null,
        admin: learned.target,
      },
    };
  }

  const voice = await BrandVoice.exists({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(input.companyId), status: 'approved' });
  return {
    ok: true,
    plan: {
      kind: 'social_publish',
      title: source.type === 'site' && source.roundup ? 'Game Nights This Week' : source.type === 'site' && source.rotation ? `Post one ${source.noun} every ${cadenceLabel(source.rotation.everyDays)}` : `Post new ${source.noun}s to social`,
      source,
      sourceLabel: sourceLabel(source, profile.domain ?? null),
      newest,
      channels: await channelOptions(viewer, input.companyId, request, profile.subreddit ?? null, profile.socialLinks.map((l) => l.network), deps),
      people,
      notifyUserIds,
      blocker: voice ? null : `${profile.name}’s Voice is not approved yet. Approve it (Company → Voice) so posts sound like the brand.`,
      admin: null,
    },
  };
}

const createSchema = z.object({
  companyId: z.string().regex(/^[a-f0-9]{24}$/i),
  request: z.string().trim().min(10).max(2000),
  source: publishSourceSchema,
  imageId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  adminFieldRules: adminFieldRulesSchema.optional(),
  adminTimezone: publishingConfigSchema.shape.adminTimezone,
  adminDefaultEndDays: publishingConfigSchema.shape.adminDefaultEndDays,
  socialLinkTemplate: publishingConfigSchema.shape.socialLinkTemplate,
  adminLinkField: z.string().min(1).max(100).optional(),
  adminValueField: z.string().min(1).max(100).optional(),
  minimumSocialValuePct: z.number().min(0).max(1000).optional(),
  channels: z.array(channelSchema).min(1, 'Choose at least one platform.'),
  notifyUserIds: z.array(z.string()).max(50).default([]),
  examples: z.record(z.enum(PUBLISH_PLATFORMS), z.string().max(6000)).default({}),
  admin: adminTargetSchema.nullable().optional(),
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
  if (source.feedKind === 'events' || source.roundup) {
    const canonical = eventRoundupSource(new URL(source.feedUrl).hostname, 'Game Nights');
    if (!canonical || canonical.type !== 'site' || source.feedKind !== 'events' || !source.roundup || source.rotation || source.feedUrl !== canonical.feedUrl || source.roundup.landingUrl !== canonical.roundup?.landingUrl) return 'Use the verified Game Night event feed and schedule page.';
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
  // An admin job adds records to the company's own admin and nothing else; a social job never touches the admin.
  const admin = input.channels.some((c) => c.platform === 'admin') ? input.admin ?? null : null;
  if (input.channels.some((c) => c.platform === 'admin') && !admin) return { ok: false, status: 400, error: 'The admin form is missing. Describe the job again so Nucleas can learn it.' };
  if (admin && input.channels.some((c) => c.platform !== 'admin')) return { ok: false, status: 400, error: 'An admin job cannot also post to social. Set those up as a separate job.' };
  if (admin) {
    const session = await adminSessionFor(viewer.organizationId, input.companyId);
    const origin = session ? new URL(session.baseUrl).origin : null;
    const sameSite = (url: string | null) => url === null || (() => {
      try {
        return new URL(url).origin === origin;
      } catch {
        return false;
      }
    })();
    if (!origin || new URL(admin.baseUrl).origin !== origin || !sameSite(admin.formUrl) || !sameSite(admin.listUrl)) return { ok: false, status: 400, error: 'That form is not on the company’s admin site.' };
  }
  const sameSource = input.source.type === 'site' ? { 'publishing.source.feedUrl': input.source.feedUrl, 'publishing.source.pathPrefix': input.source.pathPrefix } : { 'publishing.source.watchId': input.source.watchId };
  if (await Job.exists({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(input.companyId), 'design.skill': 'social_publish', status: { $nin: ['rejected', 'archived', 'done'] }, 'publishing.admin': { $exists: Boolean(admin) }, ...sameSource })) {
    return { ok: false, status: 409, error: `${profile.name} already has a job ${admin ? 'adding' : 'posting'} these ${input.source.noun}s. Open it to change its settings.` };
  }
  const examples = await resolveExamples(input.examples, deps.fetcher);
  if (!examples.ok) return { ok: false, status: 400, error: examples.error };
  const image = input.imageId ? await PublishingImage.findOne({ _id: input.imageId, organizationId: viewer.organizationId, companyId: input.companyId }).lean<{ _id: Types.ObjectId; url: string; alt: string }>() : null;
  if (input.imageId && !image) return { ok: false, status: 400, error: 'That image does not belong to this company.' };
  if (input.source.type === 'site' && input.source.roundup?.imageRequired && !image) return { ok: false, status: 400, error: 'Upload the requested image before creating this job. A local file path is not accessible to scheduled runs.' };
  const channels = normalizeChannels(input.channels);
  const config: PublishingConfig = {
    source: input.source,
    ...(image ? { image: { id: String(image._id), url: image.url, alt: image.alt } } : {}),
    ...(input.socialLinkTemplate ? { socialLinkTemplate: input.socialLinkTemplate } : {}),
    ...(input.adminDefaultEndDays ? { adminDefaultEndDays: input.adminDefaultEndDays } : {}),
    ...(input.adminTimezone ? { adminTimezone: input.adminTimezone } : {}),
    ...(input.adminLinkField ? { adminLinkField: input.adminLinkField } : {}),
    ...(input.adminValueField ? { adminValueField: input.adminValueField } : {}),
    ...(input.adminFieldRules ? { adminFieldRules: input.adminFieldRules } : {}),
    ...(input.minimumSocialValuePct !== undefined ? { minimumSocialValuePct: input.minimumSocialValuePct } : {}),
    channels,
    examples: examples.examples,
    notifyUserIds: await keepOrgPeople(viewer.organizationId, input.notifyUserIds),
    brief: input.request,
    ...(admin ? { admin } : {}),
  };
  const roundup = input.source.type === 'site' ? input.source.roundup : undefined;
  const level = (await readEngineSettings(String(viewer.organizationId))).defaultCostLevel;
  const doc = await Job.create({
    organizationId: viewer.organizationId,
    companyId: new Types.ObjectId(input.companyId),
    createdByUserId: new Types.ObjectId(viewer.userId),
    status: 'proposed',
    request: input.request,
    design: admin
      ? adminPublishDesign({ noun: input.source.noun, sourceLabel: sourceLabel(input.source, profile.domain ?? null), host: new URL(admin.baseUrl).host })
      : socialPublishDesign({ noun: input.source.noun, sourceLabel: sourceLabel(input.source, profile.domain ?? null), platforms: channels.map((c) => PLATFORM_LABEL[c.platform]), ...(input.source.type === 'site' && input.source.rotation ? { everyDays: input.source.rotation.everyDays } : {}) }),
    ...(roundup ? { design: { ...socialPublishDesign({ noun: input.source.noun, sourceLabel: sourceLabel(input.source), platforms: channels.map(c => PLATFORM_LABEL[c.platform]) }), title: 'Game Nights This Week', schedule: { kind: 'weekly', weekday: roundup.weekday, time: roundup.time, timezone: roundup.timezone, randomWindow: roundup.randomWindow }, safeguards: ['One roundup per local week; retries do not duplicate it.', 'Only validated scheduled Game Nights are included.'] } } : {}),
    publishing: config,
    level,
    designCostMicros: 0,
    events: [{ at: new Date(), userId: new Types.ObjectId(viewer.userId), action: 'skill_configured', note: 'social_publish' }],
  });
  if (input.source.type === 'mailbox' && channels.some((c) => c.platform !== 'admin')) {
    await ContentWatch.updateOne({ _id: new Types.ObjectId(input.source.watchId), organizationId: viewer.organizationId }, { $set: { autoPosts: false } });
  }
  return { ok: true, jobId: String(doc._id) };
}

const settingsSchema = z.object({
  imageId: z.string().regex(/^[a-f0-9]{24}$/i).nullable().optional(),
  adminFieldRules: adminFieldRulesSchema.optional(),
  adminTimezone: publishingConfigSchema.shape.adminTimezone,
  adminDefaultEndDays: publishingConfigSchema.shape.adminDefaultEndDays,
  socialLinkTemplate: publishingConfigSchema.shape.socialLinkTemplate,
  adminLinkField: z.string().min(1).max(100).optional(),
  adminValueField: z.string().min(1).max(100).optional(),
  minimumSocialValuePct: z.number().min(0).max(1000).nullable().optional(),
  channels: z.array(channelSchema).min(1, 'Keep at least one platform.').optional(),
  notifyUserIds: z.array(z.string()).max(50).optional(),
  examples: z.record(z.enum(PUBLISH_PLATFORMS), z.string().max(6000)).optional(),
  /** Evergreen rotation: how often, and which pages in what order (null goes back to every page, oldest first). */
  rotation: z.object({ everyDays: z.number().int().min(1).max(365).optional(), pool: z.array(z.object({ url: z.string().url().max(2000), title: z.string().max(300).optional() })).max(500).nullable().optional() }).optional(),
});

/** Change a running job's platforms, auto/manual choices, notify list or examples. Managers only. */
export async function updatePublishingSettings(viewer: CompanyViewer, job: { _id: Types.ObjectId; organizationId: Types.ObjectId; publishing?: unknown; design?: unknown; companyId?: Types.ObjectId }, raw: unknown, deps: SetupDeps = {}): Promise<{ ok: true } | { ok: false; status: 400 | 403; error: string }> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can change publishing settings.' };
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? 'Check the settings.' };
  const set: Record<string, unknown> = {};
  if (parsed.data.imageId) {
    if (!job.companyId) return { ok: false, status: 400, error: 'Company is missing.' };
    const image = await PublishingImage.findOne({ _id: parsed.data.imageId, organizationId: viewer.organizationId, companyId: job.companyId }).lean<{ _id: Types.ObjectId; url: string; alt: string }>();
    if (!image) return { ok: false, status: 400, error: 'That image does not belong to this company.' };
    set['publishing.image'] = { id: String(image._id), url: image.url, alt: image.alt };
  }
  if (parsed.data.socialLinkTemplate) set['publishing.socialLinkTemplate'] = parsed.data.socialLinkTemplate;
  if (parsed.data.adminDefaultEndDays) set['publishing.adminDefaultEndDays'] = parsed.data.adminDefaultEndDays;
  if (parsed.data.adminTimezone) set['publishing.adminTimezone'] = parsed.data.adminTimezone;
  if (parsed.data.adminLinkField) set['publishing.adminLinkField'] = parsed.data.adminLinkField;
  if (parsed.data.adminValueField) set['publishing.adminValueField'] = parsed.data.adminValueField;
  if (parsed.data.adminFieldRules) set['publishing.adminFieldRules'] = parsed.data.adminFieldRules;
  const unset: Record<string, ''> = {};
  if (parsed.data.imageId === null) unset['publishing.image'] = '';
  if (parsed.data.minimumSocialValuePct === null) unset['publishing.minimumSocialValuePct'] = '';
  else if (parsed.data.minimumSocialValuePct !== undefined) set['publishing.minimumSocialValuePct'] = parsed.data.minimumSocialValuePct;
  if (parsed.data.channels) {
    const allowed = platformsFor((job.publishing ?? {}) as { admin?: unknown });
    if (parsed.data.channels.some((c) => !allowed.includes(c.platform))) return { ok: false, status: 400, error: 'That platform does not belong to this job.' };
    const channels = normalizeChannels(parsed.data.channels);
    set['publishing.channels'] = channels;
    // Switching a channel back to auto means the person fixed the account: drop the old warning.
    for (const c of channels) if (c.mode === 'auto') unset[`publishing.notes.${c.platform}`] = '';
  }
  if (parsed.data.rotation) {
    const current = publishingConfigSchema.safeParse(job.publishing);
    if (!current.success || current.data.source.type !== 'site' || !current.data.source.rotation) return { ok: false, status: 400, error: 'This job is not an evergreen rotation.' };
    const { everyDays, pool } = parsed.data.rotation;
    if (everyDays) {
      set['publishing.source.rotation.everyDays'] = everyDays;
      const prior = jobScheduleSchema.safeParse((job.design as { schedule?: unknown })?.schedule);
      const schedule = { ...(prior.success ? prior.data : {}), kind: 'daily' as const, everyDays, time: prior.success ? prior.data.time ?? '09:00' : '09:00' };
      set['design.schedule'] = schedule;
      set.nextRunAt = nextScheduledAt(schedule, new Date());
    }
    if (pool === null) unset['publishing.source.rotation.pool'] = '';
    else if (pool) {
      const bare = (host: string) => host.toLowerCase().replace(/^www\./, '');
      const siteHost = bare(new URL(current.data.source.feedUrl).host);
      const seen = new Set<string>();
      const clean: { url: string; title: string }[] = [];
      for (const item of pool) {
        let url: URL;
        try { url = new URL(item.url); } catch { return { ok: false, status: 400, error: 'One of the pages is not a valid address.' }; }
        if (url.protocol !== 'https:' || bare(url.host) !== siteHost) return { ok: false, status: 400, error: `Only pages on ${siteHost} can be in the rotation.` };
        url.hash = '';
        url.host = new URL(current.data.source.feedUrl).host; // the site's own spelling (with or without www), so one page is one entry
        if (seen.has(url.toString())) continue;
        seen.add(url.toString());
        clean.push({ url: url.toString(), title: (item.title ?? '').trim().slice(0, 300) });
      }
      set['publishing.source.rotation.pool'] = clean;
    }
  }
  if (parsed.data.notifyUserIds) set['publishing.notifyUserIds'] = await keepOrgPeople(viewer.organizationId, parsed.data.notifyUserIds);
  if (parsed.data.examples) {
    const examples = await resolveExamples(parsed.data.examples, deps.fetcher);
    if (!examples.ok) return { ok: false, status: 400, error: examples.error };
    set['publishing.examples'] = examples.examples;
  }
  if (!Object.keys(set).length && !Object.keys(unset).length) return { ok: false, status: 400, error: 'Nothing to change.' };
  await Job.updateOne({ _id: job._id, organizationId: job.organizationId }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  return { ok: true };
}
