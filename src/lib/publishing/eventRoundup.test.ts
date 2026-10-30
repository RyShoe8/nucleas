import { describe, expect, it } from 'vitest';
import { eventGameLink, eventRoundupSource, roundupFromEvents } from './eventRoundup';
import { composePost } from './compose';
import { nextScheduledAt } from '@/lib/jobs/schedule';

const source = eventRoundupSource('playbound.club', 'Weekly Game Nights on social')!;
if (source.type !== 'site') throw new Error('Expected site source');
const event = { id: 'a'.repeat(24), title: 'OpenRA Game Night', description: 'Join us.', eventType: 'game_night', startsAt: '2026-10-28T00:00:00Z', endsAt: '2026-10-28T02:00:00Z', timezone: 'America/Chicago', status: 'registration_open', visibility: 'public', gameSlug: 'openra', editionSlug: 'official' };

describe('scheduled event roundups', () => {
  it('recognizes Game Nights before generic new-page detection', () => {
    expect(source).toMatchObject({ feedKind: 'events', feedUrl: 'https://playbound.club/api/events?type=game_night' });
    expect(eventRoundupSource('playbound.club', 'Post new games to social')).toBeNull();
    expect(eventRoundupSource('other.example', 'Game Nights')).toBeNull();
  });
  it('excludes forms, canceled/private events, duplicates, and past or later-week events', () => {
    const result = roundupFromEvents({ events: [event, event, { title: '/events/create' }, { ...event, id: 'b'.repeat(24), status: 'cancelled' }, { ...event, id: 'c'.repeat(24), visibility: 'private' }, { ...event, id: 'd'.repeat(24), startsAt: '2026-11-04T00:00:00Z', endsAt: '2026-11-04T02:00:00Z' }] }, source, new Date('2026-10-26T16:00:00Z'));
    expect(result?.description).toContain('1 scheduled');
    expect(result?.text).toContain('America/Chicago');
    expect(result?.text).toContain('edition: official');
    expect(result?.url).toBe('https://playbound.club/events');
    expect(result?.key).toBe('events:2026-10-26:America/Chicago');
    expect(roundupFromEvents({ events: [event] }, source, new Date('2026-10-29T00:00:00Z'))).toBeNull();
  });
  it('keeps one local-week key across DST and hourly retries', () => {
    const dst = { ...event, startsAt: '2026-11-01T23:00:00Z', endsAt: '2026-11-02T01:00:00Z' };
    expect(roundupFromEvents({ events: [dst] }, source, new Date('2026-11-01T05:00:00Z'))?.key).toBe(roundupFromEvents({ events: [dst] }, source, new Date('2026-11-01T08:00:00Z'))?.key);
  });
  it('rejects an unstructured source rather than using links as events', () => {
    expect(() => roundupFromEvents({ links: ['/events/create'] }, source)).toThrow('event records');
  });
  it('rewrites overlong or wrong-link Bluesky drafts and never truncates them into valid posts', async () => {
    const input = { platform: 'bluesky' as const, companyName: 'PlayBound', persona: 'Friendly', example: '', brief: '', noun: 'Game Night roundup', facts: { title: 'This week' }, link: 'https://playbound.club/events', roundup: true };
    let calls = 0;
    const draft = await composePost(input, async () => JSON.stringify({ body: ++calls === 1 ? 'x'.repeat(400) : 'Join this week’s Game Nights! https://playbound.club/events' }));
    expect(calls).toBe(2);
    expect(draft?.body).toContain(input.link);
    expect(await composePost(input, async () => JSON.stringify({ body: 'Join https://playbound.club/events/create' }))).toBeNull();
  });
});

const fullRequest = "We schedule events called game nights through an automated system and they are scheduled for the full week. Every monday, at a random time between 9am and 2pm I want to do a social post called Game Nights This Week on Reddit, Facebook and BlueSky. On Reddit and facebook we should link to each individual game night and to the install file for the game or edition for that night. On Bluesky we should just link to the events page. There's an image for it in d:/PlayBound/Files called Game Nights Image we should use. Set this up as an automated marketing job";

it('preserves the complete weekly request and schedules inside the Monday window', () => {
  const planned = eventRoundupSource('playbound.club', fullRequest);
  expect(planned).toMatchObject({ feedKind: 'events', roundup: { weekday: 1, randomWindow: { startHour: 9, endHour: 14 }, individualLinks: true, installLinks: true, imageRequired: true } });
  if (planned?.type !== 'site' || !planned.roundup) throw new Error('missing plan');
  const schedule = { kind: 'weekly' as const, ...planned.roundup };
  expect(nextScheduledAt(schedule, new Date('2026-10-29T16:00:00Z'), () => 0)?.toISOString()).toBe('2026-11-02T15:00:00.000Z');
  expect(nextScheduledAt(schedule, new Date('2026-10-29T16:00:00Z'), () => 0.999)?.toISOString()).toBe('2026-11-02T20:00:00.000Z');
});


it.each(['facebook', 'reddit'] as const)('requires every event and install URL on %s', async platform => {
  const requiredLinks = ['https://playbound.club/events/aaaaaaaaaaaaaaaaaaaaaaaa', 'https://downloads.example/openra.exe'];
  const input = { platform, companyName: 'PlayBound', persona: 'Friendly', example: '', brief: '', noun: 'Game Night roundup', facts: { title: 'This week', requiredLinks }, link: 'https://playbound.club/events', roundup: true };
  const draft = { title: 'Game Nights This Week', body: `Game Nights This Week\nOpenRA Tuesday 7pm CT\n${requiredLinks.join('\n')}\n${input.link}` };
  expect(await composePost(input, async () => JSON.stringify(draft))).toEqual(draft.title && platform === 'reddit' ? draft : { ...draft, title: null });
  expect(await composePost(input, async () => JSON.stringify({ ...draft, body: 'See https://playbound.club/events' }))).toBeNull();
  expect(await composePost({ ...input, platform: 'bluesky' }, async () => JSON.stringify({ body: `Game Nights This Week ${input.link}` }))).toMatchObject({ body: `Game Nights This Week ${input.link}` });
  expect(await composePost({ ...input, platform: 'bluesky' }, async () => JSON.stringify(draft))).toBeNull();
});

describe('the page a Game Night post links for its game', () => {
  const site = 'https://playbound.club/api/events?type=game_night';
  const raw = { game: { slug: 'star-wars-galactic-battlegrounds-saga' }, editions: [
    { slug: 'official', isDefault: true, status: 'active' },
    { slug: 'expanding-fronts', name: 'Expanding Fronts', isDefault: false, status: 'active' },
    { slug: 'beta', isDefault: false, status: 'coming_soon' },
  ] };

  it('links the game page for the base game, whatever its install method', () => {
    expect(eventGameLink(raw, 'star-wars-galactic-battlegrounds-saga', null, site)).toEqual({ ok: true, url: 'https://playbound.club/games/star-wars-galactic-battlegrounds-saga', edition: null });
    expect(eventGameLink(raw, 'star-wars-galactic-battlegrounds-saga', 'official', site)).toEqual({ ok: true, url: 'https://playbound.club/games/star-wars-galactic-battlegrounds-saga', edition: null });
  });

  it('links the edition page for a named edition, never a file', () => {
    expect(eventGameLink(raw, 'star-wars-galactic-battlegrounds-saga', 'expanding-fronts', site)).toEqual({ ok: true, url: 'https://playbound.club/games/star-wars-galactic-battlegrounds-saga/editions/expanding-fronts', edition: 'Expanding Fronts' });
  });

  it('refuses an edition the game does not have or that is not out, and a different game', () => {
    expect(eventGameLink(raw, 'star-wars-galactic-battlegrounds-saga', 'community', site)).toMatchObject({ ok: false, problem: expect.stringContaining('“community”') });
    expect(eventGameLink(raw, 'star-wars-galactic-battlegrounds-saga', 'beta', site)).toMatchObject({ ok: false, problem: expect.stringContaining('not available yet') });
    expect(eventGameLink(raw, 'other-game', null, site)).toMatchObject({ ok: false });
  });
});
