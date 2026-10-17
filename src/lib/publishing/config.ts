import { z } from 'zod';

/**
 * What a publishing job is set to do: where new items come from, which channels each one goes to (and
 * whether Nucleas posts there itself or hands a ready-to-post card to a person), and who is told.
 * Pure and client-safe: the Marketing window renders and edits the same shape.
 */

export const PUBLISH_PLATFORMS = ['facebook', 'bluesky', 'reddit'] as const;
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];

export const PLATFORM_LABEL: Record<PublishPlatform, string> = { facebook: 'Facebook', bluesky: 'Bluesky', reddit: 'Reddit' };

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
});

export const mailboxSourceSchema = z.object({
  type: z.literal('mailbox'),
  watchId: objectId,
  noun: z.string().trim().min(1).max(40),
});

export const publishSourceSchema = z.discriminatedUnion('type', [siteSourceSchema, mailboxSourceSchema]);
export type PublishSource = z.infer<typeof publishSourceSchema>;

export const publishingConfigSchema = z.object({
  source: publishSourceSchema,
  channels: z.array(channelSchema).min(1).max(PUBLISH_PLATFORMS.length),
  /** Example posts per platform: their structure (not their wording) shapes the drafts. */
  examples: z.record(z.enum(PUBLISH_PLATFORMS), z.object({ url: z.string().max(2000).optional(), text: z.string().max(6000).default('') })).default({}),
  /** People told when a card is ready to post or the job needs attention. */
  notifyUserIds: z.array(objectId).max(50).default([]),
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

/** The plain sentence a job card shows for its source. */
export function sourceLabel(source: PublishSource, host?: string | null): string {
  if (source.type === 'mailbox') return `Watching the inbox for new ${source.noun}s`;
  const where = `${host ?? new URL(source.feedUrl).host}${source.pathPrefix === '/' ? '' : source.pathPrefix}`;
  return `Watching ${where} for new ${source.noun}s`;
}
