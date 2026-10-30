import { z } from 'zod';
import { fetchPublicText, type FetchLike } from './fetchPublic';
import type { PublishSource } from './config';

const eventSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/i), title: z.string().trim().min(1).max(500),
  description: z.string().max(20000).default(''), eventType: z.literal('game_night'),
  startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }),
  status: z.enum(['scheduled', 'registration_open', 'registration_closed', 'live']),
  visibility: z.literal('public'), gameSlug: z.string().nullable().optional(), editionSlug: z.string().nullable().optional(),
});

export const wantsEventRoundup = (brief: string) => /game\s*nights?|scheduled events?|weekly.*events?/i.test(brief);

export function eventRoundupSource(domain: string, brief: string): PublishSource | null {
  const origin = new URL(`https://${domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`);
  // This adapter consumes PlayBound's public event records, never sitemap/navigation links.
  if (!['playbound.club', 'www.playbound.club'].includes(origin.hostname) || !wantsEventRoundup(brief)) return null;
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const weekday = days.findIndex(day => new RegExp(`\\b${day}\\b`, 'i').test(brief));
  const window = /random[\s\S]*?between\s+(\d{1,2})\s*(am|pm)\s+and\s+(\d{1,2})\s*(am|pm)/i.exec(brief);
  const hour = (value: string, meridiem: string) => Number(value) % 12 + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  const randomWindow = window ? { startHour: hour(window[1], window[2]), endHour: hour(window[3], window[4]) } : undefined;
  if (randomWindow && (randomWindow.endHour <= randomWindow.startHour || Number(window![1]) > 12 || Number(window![3]) > 12)) throw new Error('Choose a valid same-day random posting window.');
  return { type: 'site', feedKind: 'events', feedUrl: `${origin.origin}/api/events?type=game_night`, pathPrefix: '/events/', noun: 'Game Night roundup', roundup: { landingUrl: `${origin.origin}/events`, timezone: 'America/Chicago', weekday: weekday < 0 ? 1 : weekday, time: '09:00', randomWindow, individualLinks: /each individual|each (?:game night|event)/i.test(brief), installLinks: /install(?:er)? file|download link/i.test(brief), imageRequired: /\bimage\b/i.test(brief) } };
}

function localDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (kind: string) => parts.find(p => p.type === kind)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function roundupFromEvents(raw: unknown, source: Extract<PublishSource, { type: 'site' }>, now = new Date()) {
  if (!source.roundup) throw new Error('Weekly event settings are missing.');
  const { timezone, weekday, landingUrl } = source.roundup;
  const day = new Date(`${localDate(now, timezone)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() - weekday + 7) % 7);
  const start = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 7);
  const end = day.toISOString().slice(0, 10);
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { events?: unknown }).events)) throw new Error('The source did not return event records.');
  const seen = new Set<string>();
  const events = ((raw as { events: unknown[] }).events).flatMap(row => {
    const parsed = eventSchema.safeParse(row);
    if (!parsed.success) return [];
    const e = parsed.data;
    const date = localDate(new Date(e.startsAt), timezone);
    if (seen.has(e.id) || date < start || date >= end || Date.parse(e.endsAt) <= now.getTime() || Date.parse(e.endsAt) <= Date.parse(e.startsAt)) return [];
    seen.add(e.id);
    return [e];
  }).sort((a,b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  if (!events.length) return null;
  const requiredLinks = events.map(e => new URL(`/events/${e.id}`, landingUrl).href);
  const lines = events.map(e => `${e.title} | ${new Intl.DateTimeFormat('en-US', { timeZone: e.timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(e.startsAt))} (${e.timezone}) | game: ${e.gameSlug ?? 'not specified'}; edition: ${e.editionSlug ?? 'not specified'} | ${new URL(`/events/${e.id}`, landingUrl)}\n${e.description.slice(0, 1500)}`);
  return { key: `events:${start}:${timezone}`, url: landingUrl, title: `Game Nights · ${start} to ${end} (exclusive)`, date: new Date(`${start}T00:00:00Z`), description: `${events.length} scheduled Game Nights. See the full schedule and join at ${landingUrl}.`, text: lines.join('\n\n'), events, requiredLinks: source.roundup.individualLinks || source.roundup.installLinks ? requiredLinks : undefined };
}

export async function readEventRoundup(source: Extract<PublishSource, { type: 'site' }>, fetcher?: FetchLike, now = new Date()) {
  const response = await fetchPublicText(source.feedUrl, { accept: 'application/json', fetcher });
  const roundup = roundupFromEvents(JSON.parse(response.text), source, now);
  if (!roundup || !source.roundup?.installLinks) return roundup;
  for (const event of roundup.events) {
    if (!event.gameSlug) throw new Error(`No game is assigned to ${event.title}; Nucleas cannot tell which game to link.`);
    const response = await fetchPublicText(new URL(`/api/games/${encodeURIComponent(event.gameSlug)}/editions`, source.feedUrl).href, { accept: 'application/json', fetcher });
    const link = eventGameLink(JSON.parse(response.text), event.gameSlug, event.editionSlug, source.feedUrl);
    if (!link.ok) throw new Error(`${event.title}: ${link.problem}`);
    roundup.requiredLinks!.push(link.url);
    roundup.text += `\n${link.edition ? `Edition page (${link.edition})` : 'Game page'} for ${event.title}: ${link.url}`;
  }
  return roundup;
}

export type EventGameLink = { ok: true; url: string; /** The edition's name when the event names a non-default edition. */ edition: string | null } | { ok: false; problem: string };

/**
 * The PlayBound page a Game Night post links for its game: the game's page for the base game, or the
 * edition's page when the event names another edition. The page explains how to install it; posts never
 * link install files. A named edition the game does not have, or one that is archived or not out yet,
 * is a problem to fix on the event: Nucleas never links a different edition.
 */
export function eventGameLink(raw: unknown, gameSlug: string, editionSlug: string | null | undefined, siteUrl: string): EventGameLink {
  const parsed = z.object({ game: z.object({ slug: z.string() }), editions: z.array(z.object({ slug: z.string(), name: z.string().optional(), title: z.string().optional(), isDefault: z.boolean().optional(), status: z.string().optional() })) }).safeParse(raw);
  if (!parsed.success || parsed.data.game.slug !== gameSlug) return { ok: false, problem: `PlayBound did not return the game “${gameSlug}”. Check the game assigned to this event.` };
  const gamePage = new URL(`/games/${encodeURIComponent(gameSlug)}`, siteUrl).href;
  if (!editionSlug) return { ok: true, url: gamePage, edition: null };
  const edition = parsed.data.editions.find((e) => e.slug === editionSlug);
  if (!edition) return { ok: false, problem: `this event names the edition “${editionSlug}”, which the game does not have. Pick the right edition on the event, or leave it empty for the base game.` };
  if (['archived', 'coming_soon'].includes(edition.status ?? '')) return { ok: false, problem: `the “${editionSlug}” edition is ${edition.status === 'archived' ? 'archived' : 'not available yet'} on PlayBound.` };
  // The default edition is the base game: its page is the game's own page.
  if (edition.isDefault) return { ok: true, url: gamePage, edition: null };
  return { ok: true, url: new URL(`/games/${encodeURIComponent(gameSlug)}/editions/${encodeURIComponent(editionSlug)}`, siteUrl).href, edition: edition.name ?? edition.title ?? editionSlug };
}
