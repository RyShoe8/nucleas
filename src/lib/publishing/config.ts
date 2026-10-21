import { z } from 'zod';

/**
 * What a publishing job is set to do: where new items come from, which channels each one goes to (and
 * whether Nucleas posts there itself or hands a ready-to-post card to a person), and who is told.
 * Pure and client-safe: the Marketing window renders and edits the same shape.
 */

export const SOCIAL_PLATFORMS = ['facebook', 'bluesky', 'reddit'] as const;
/** 'admin' is the company's own site admin: records are added through its form with the captured admin session. */
export const PUBLISH_PLATFORMS = [...SOCIAL_PLATFORMS, 'admin'] as const;
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const PLATFORM_LABEL: Record<PublishPlatform, string> = { facebook: 'Facebook', bluesky: 'Bluesky', reddit: 'Reddit', admin: 'Admin' };

/** Platforms with no publishing API: Nucleas always prepares a ready-to-post card for a person. */
export const MANUAL_ONLY: readonly PublishPlatform[] = ['reddit'];

export const channelSchema = z.object({
  platform: z.enum(PUBLISH_PLATFORMS),
  mode: z.enum(['auto', 'manual']),
});
export type PublishChannel = z.infer<typeof channelSchema>;

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

export const siteSourceSchema = z.object({
  type: z.literal('site'),
  /** The sitemap or RSS/Atom feed that lists the pages. */
  feedUrl: z.string().url().max(2000),
  feedKind: z.enum(['sitemap', 'rss', 'atom']),
  /** Only pages under this path count, e.g. "/games/". "/" means every page in the feed. */
  pathPrefix: z.string().max(300).regex(/^\//),
  /** What one item is called, for labels ("game", "article"). */
  noun: z.string().trim().min(1).max(40),
  /** Evergreen rotation: instead of posting what is new, post one existing item every N days, oldest first, then start over. */
  rotation: z.object({
    everyDays: z.number().int().min(1).max(365),
    /** Which pages are in the rotation, in posting order. Absent means every page in the section, oldest first. */
    pool: z.array(z.object({ url: z.string().url().max(2000), title: z.string().max(300).default('') })).max(500).optional(),
  }).optional(),
});

export const mailboxSourceSchema = z.object({
  type: z.literal('mailbox'),
  watchId: objectId,
  noun: z.string().trim().min(1).max(40),
});

export const publishSourceSchema = z.discriminatedUnion('type', [siteSourceSchema, mailboxSourceSchema]);
export type PublishSource = z.infer<typeof publishSourceSchema>;

export const FORM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'datetime-local', 'time', 'url', 'email', 'tel', 'select', 'checkbox', 'radio', 'richtext', 'file'] as const;

/** One control of an admin form, as the browser worker read it. */
export const formFieldSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().max(200),
  type: z.enum(FORM_FIELD_TYPES),
  selector: z.string().min(1).max(500),
  required: z.boolean(),
  options: z.array(z.object({ value: z.string().max(300), label: z.string().max(300) })).max(200).optional(),
  placeholder: z.string().max(200).optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

/** The admin form a job fills, learned when it is set up and re-learned when the form changes. */
export const adminTargetSchema = z.object({
  baseUrl: z.string().url().max(500),
  formUrl: z.string().url().max(2000),
  /** The page listing the records, read after saving to confirm the new one is there. */
  listUrl: z.string().url().max(2000).nullable(),
  fields: z.array(formFieldSchema).min(1).max(60),
  submit: z.object({ selector: z.string().min(1).max(500), label: z.string().max(200) }),
  learnedAt: z.string().max(40),
});
export type AdminTarget = z.infer<typeof adminTargetSchema>;

/** Same fields in the same places: a form whose fingerprint changed has to be learned again. */
export function formFingerprint(fields: Pick<FormField, 'key' | 'type' | 'selector'>[]): string {
  return fields.map((f) => `${f.key}:${f.type}:${f.selector}`).sort().join('|');
}

export const adminFieldRulesSchema = z.array(z.object({
  field: z.string().min(1).max(100),
  value: z.union([z.string().max(5000), z.boolean()]),
  whenValueOverPct: z.number().min(0).max(1000).optional(),
  otherwise: z.union([z.string().max(5000), z.boolean()]).optional(),
})).max(60);

export const publishingConfigSchema = z.object({
  source: publishSourceSchema,
  /** Public record URL for mailbox social posts; {slug} comes from the matching admin card. */
  socialLinkTemplate: z.string().max(2000).refine((value) => { try { return value.includes('{slug}') && new URL(value.replace('{slug}', 'example')).protocol === 'https:'; } catch { return false; } }, 'Use an https URL containing {slug}.').optional(),
  /** Mailbox social destinations only: require value strictly greater than this percent. */
  minimumSocialValuePct: z.number().min(0).max(1000).optional(),
  /** One Reddit casino deal per local day; the last two casinos cannot repeat. */
  redditDealPolicy: z.object({ timezone: z.string().refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Use a valid timezone.') }).optional(),
  channels: z.array(channelSchema).min(1).max(PUBLISH_PLATFORMS.length),
  /** Example posts per platform: their structure (not their wording) shapes the drafts. */
  examples: z.record(z.enum(PUBLISH_PLATFORMS), z.object({ url: z.string().max(2000).optional(), text: z.string().max(6000).default('') })).default({}),
  /** People told when a card is ready to post or the job needs attention. */
  notifyUserIds: z.array(objectId).max(50).default([]),
  /** Jobs that add records to the company's own admin (channel 'admin'). */
  admin: adminTargetSchema.optional(),
  /** Explicit field mappings override generated values, with optional verified-value conditions. */
  adminFieldRules: adminFieldRulesSchema.optional(),
  adminDefaultEndDays: z.number().int().min(1).max(365).optional(),
  /** Which pass through the list an evergreen rotation is on; each pass posts every item once. */
  rotationCycle: z.number().int().min(1).max(1000).optional(),
  adminTimezone: z.string().max(100).refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Choose a valid timezone.').optional(),
  adminLinkField: z.string().min(1).max(100).optional(),
  adminValueField: z.string().min(1).max(100).optional(),
  /** The request in the person's words; it steers what each post emphasizes. */
  brief: z.string().max(2000).default(''),
});
export type PublishingConfig = z.infer<typeof publishingConfigSchema>;

/** One channel per platform, in catalog order, with manual-only platforms forced to manual. */
export function normalizeChannels(channels: PublishChannel[]): PublishChannel[] {
  const byPlatform = new Map(channels.map((c) => [c.platform, c]));
  return PUBLISH_PLATFORMS.filter((p) => byPlatform.has(p)).map((platform) => ({
    platform,
    mode: MANUAL_ONLY.includes(platform) ? 'manual' : byPlatform.get(platform)!.mode,
  }));
}

/** The platforms a job's settings offer: its admin when it has one, otherwise the social networks. */
export function platformsFor(config: { admin?: unknown }): readonly PublishPlatform[] {
  return config.admin ? ['admin'] : SOCIAL_PLATFORMS;
}

/** The plain sentence a job card shows for its source. */
export function sourceLabel(source: PublishSource, host?: string | null): string {
  if (source.type === 'mailbox') return `Watching the inbox for new ${source.noun}s`;
  const where = `${host ?? new URL(source.feedUrl).host}${source.pathPrefix === '/' ? '' : source.pathPrefix}`;
  if (source.rotation) return `Posting one ${source.noun} from ${where} every ${cadenceLabel(source.rotation.everyDays)}, oldest first`;
  return `Watching ${where} for new ${source.noun}s`;
}

/** "3 weeks", "day", "10 days": the cadence in plain words. */
export function cadenceLabel(days: number): string {
  if (days === 1) return 'day';
  if (days % 7 === 0) return days === 7 ? 'week' : `${days / 7} weeks`;
  return `${days} days`;
}
