import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/tools/webFetch', () => ({ webFetch: vi.fn() }));

import { homepageFacts, leadBrief, leadRank, leadsNeedingCheck, leadsToFinish, openedPages, rememberQualificationGap, ResearchEvidence, researchExclusions, researchReserve, saveScoutBatch, saveScreened } from './researchEvidence';

const scope = { organizationId: new Types.ObjectId(), companyId: new Types.ObjectId(), skill: 'signature_outreach' };
const report = (...sites: string[]) => JSON.stringify({ candidates: sites.map((site) => ({ name: site, website: `https://${site}/`, source: 'https://listing.com/launches' })) });
const page = (links: string[], thin = false, rendered = false, url?: string) => ({ thin, links, rendered, ...(url ? { url } : {}) });
const opener = (pages: Record<string, ReturnType<typeof page> | null>) => async (url: string) => {
  const found = pages[new URL(url).hostname];
  if (!found) throw new Error('blocked');
  return found;
};

let replica: MongoMemoryReplSet;
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_research_evidence_test'));
});
afterAll(async () => {
  await mongoose.disconnect();
  await replica.stop();
});
beforeEach(async () => { await ResearchEvidence.deleteMany({}); });

describe('checked facts', () => {
  it('records what the homepage links to, where it was seen and how', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    expect(homepageFacts('https://leaf.com/', ['https://leaf.com/pricing', 'https://bsky.app/profile/leaf.com', 'https://leaf.com/blog/feed/', 'https://leaf.com/contact'], now)).toEqual([
      { field: 'bluesky', value: 'https://bsky.app/profile/leaf.com', source: 'https://leaf.com/', method: 'Link found on the official homepage', checkedAt: now },
      { field: 'feed', value: 'https://leaf.com/blog/feed/', source: 'https://leaf.com/', method: 'Link found on the official homepage', checkedAt: now },
      { field: 'contact', value: 'https://leaf.com/contact', source: 'https://leaf.com/', method: 'Link found on the official homepage', checkedAt: now },
    ]);
  });

  it('does not take a marketing page about feeds for a feed', () => {
    expect(homepageFacts('https://b.com/', ['https://b.com/features/rss', 'https://b.com/docs/feed'])).toEqual([]);
    expect(homepageFacts('https://b.com/', ['https://b.com/blog/feed/']).map((fact) => fact.field)).toEqual(['feed']);
    expect(homepageFacts('https://b.com/', ['https://b.com/newsletter.rss']).map((fact) => fact.field)).toEqual(['feed']);
  });

  it('does not mistake a post about feeds, or another Bluesky page, for the real thing', () => {
    expect(homepageFacts('https://a.com/', ['https://a.com/blog/how-rss-feeds-work', 'https://bsky.app/about', 'https://other.com/contact'])).toEqual([]);
  });
});

describe('saving a research batch', () => {
  it('keeps an opened, a limited and an unreachable site apart', async () => {
    const result = await saveScoutBatch(scope, report('open.com', 'thin.com', 'down.com'), new Set(), opener({
      'open.com': page(['https://bsky.app/profile/open.com']),
      'thin.com': page([], true),
    }) as never);
    expect(result).toMatchObject({ discovered: 3, opened: 1 });
    const saved = Object.fromEntries((await ResearchEvidence.find(scope).lean()).map((row) => [row.domain, row]));
    expect(saved['open.com']).toMatchObject({ pageStatus: 'opened', facts: [expect.objectContaining({ field: 'bluesky' })] });
    expect(saved['thin.com']?.pageStatus).toBe('limited');
    expect(saved['down.com']?.pageStatus).toBe('inaccessible');
  });

  it('keeps earlier facts when a later check cannot open the page', async () => {
    await saveScoutBatch(scope, report('leaf.com'), new Set(), opener({ 'leaf.com': page(['https://bsky.app/profile/leaf.com']) }) as never);
    await ResearchEvidence.updateOne({ domain: 'leaf.com' }, { $set: { checkedAt: new Date(Date.now() - 2 * 86400000) } });
    await saveScoutBatch(scope, report('leaf.com'), new Set(), opener({}) as never);
    expect(await ResearchEvidence.findOne({ domain: 'leaf.com' }).lean()).toMatchObject({ pageStatus: 'inaccessible', facts: [expect.objectContaining({ field: 'bluesky' })] });
  });

  it('treats a missing required link as proof only when a real browser looked', async () => {
    await saveScoutBatch(scope, report('browser.com', 'blocked.com', 'plain.com', 'found.com', 'empty.com'), new Set(), opener({
      'browser.com': page(['https://site.com/pricing', 'https://site.com/docs', 'https://site.com/login'], false, true),
      'blocked.com': page(['https://site.com/help'], false, true),
      'plain.com': page(['https://site.com/pricing', 'https://site.com/docs', 'https://site.com/login'], false, false),
      'found.com': page(['https://bsky.app/profile/found.com'], false, true),
      'empty.com': page([], true, true),
    }) as never);
    const saved = Object.fromEntries((await ResearchEvidence.find(scope).lean()).map((row) => [row.domain, row]));
    expect(saved['browser.com']).toMatchObject({ ineligibleReason: 'No Bluesky profile is linked from the official homepage.' });
    expect(saved['plain.com']?.ineligibleAt).toBeFalsy();
    expect(saved['blocked.com']?.ineligibleAt).toBeFalsy();
    expect(saved['empty.com']?.ineligibleAt).toBeFalsy();
    expect(saved['found.com']?.ineligibleAt).toBeFalsy();
    expect(saved['found.com']?.facts?.[0]?.method).toContain('real browser');
  });

  it('clears a finding of ineligible once the link appears, and does not apply it to other jobs', async () => {
    await saveScoutBatch(scope, report('later.com'), new Set(), opener({ 'later.com': page(['https://site.com/pricing', 'https://site.com/docs', 'https://site.com/login'], false, true) }) as never);
    await ResearchEvidence.updateOne({ domain: 'later.com' }, { $set: { checkedAt: new Date(Date.now() - 2 * 86400000) } });
    await saveScoutBatch(scope, report('later.com'), new Set(), opener({ 'later.com': page(['https://bsky.app/profile/later.com'], false, true) }) as never);
    expect((await ResearchEvidence.findOne({ domain: 'later.com' }).lean())?.ineligibleAt).toBeFalsy();
    const casinos = { ...scope, skill: 'casino_discovery' };
    await saveScoutBatch(casinos, report('casino.com'), new Set(), opener({ 'casino.com': page(['https://site.com/pricing', 'https://site.com/docs', 'https://site.com/login'], false, true) }) as never);
    expect((await ResearchEvidence.findOne({ ...casinos, domain: 'casino.com' }).lean())?.ineligibleAt).toBeFalsy();
  });

  it('checks every lead in a batch', async () => {
    const sites = Array.from({ length: 10 }, (_, index) => `s${index}.com`);
    const pages = Object.fromEntries(sites.map((site) => [site, page(['https://bsky.app/profile/x.com'])]));
    expect((await saveScoutBatch(scope, report(...sites), new Set(), opener(pages) as never)).opened).toBe(10);
  });

  it('skips excluded companies and malformed leads', async () => {
    const batch = JSON.stringify({ candidates: [{ name: 'Owned', website: 'https://owned.com/', source: 'https://l.com/' }, { name: 'No site' }] });
    expect(await saveScoutBatch(scope, batch, new Set(['owned.com']), opener({}) as never)).toMatchObject({ discovered: 0 });
    expect(await ResearchEvidence.countDocuments(scope)).toBe(0);
  });
});

describe('directory links', () => {
  const batch = (website: string) => JSON.stringify({ candidates: [{ name: 'Postiz', website, source: 'https://openalternative.co/reflex' }] });

  it('saves the company a redirect lands on, not the directory', async () => {
    const opened: string[] = [];
    const open = async (url: string) => {
      opened.push(url);
      return url.includes('openalternative') ? page([], false, true, 'https://postiz.com/?ref=oa') : page(['https://postiz.com/about', 'https://postiz.com/contact', 'https://bsky.app/profile/postiz.com'], false, true, 'https://postiz.com/');
    };
    await saveScoutBatch(scope, batch('https://go.openalternative.co/postiz'), new Set(), open as never);
    expect(opened).toEqual(['https://go.openalternative.co/postiz', 'https://postiz.com/']);
    const saved = await ResearchEvidence.find(scope).lean();
    expect(saved.map((row) => row.domain)).toEqual(['postiz.com']);
    expect(saved[0]?.website).toBe('https://postiz.com/');
    expect(saved[0]?.facts?.map((fact) => fact.field)).toEqual(['bluesky', 'contact', 'about']);
  });

  it('keeps a company that cites its own homepage as the source', async () => {
    const self = JSON.stringify({ candidates: [{ name: 'Bright Themes', website: 'https://brightthemes.com/', source: 'https://brightthemes.com/' }] });
    await saveScoutBatch(scope, self, new Set(), (async () => page(['https://bsky.app/profile/brightthemes.com'], false, true)) as never);
    expect((await ResearchEvidence.find(scope).lean()).map((row) => row.domain)).toEqual(['brightthemes.com']);
  });

  it('drops a link that stays on the directory', async () => {
    await saveScoutBatch(scope, batch('https://go.openalternative.co/postiz'), new Set(), (async () => page(['https://a.com/1', 'https://a.com/2', 'https://a.com/3'], false, true)) as never);
    await saveScoutBatch(scope, batch('https://go.openalternative.co/gone'), new Set(), (async () => { throw new Error('blocked'); }) as never);
    expect(await ResearchEvidence.countDocuments(scope)).toBe(0);
  });

  it('does not follow a redirect into an excluded company', async () => {
    await saveScoutBatch(scope, batch('https://go.openalternative.co/x'), new Set(['tailnote.io']), (async () => page([], false, true, 'https://tailnote.io/')) as never);
    expect(await ResearchEvidence.countDocuments(scope)).toBe(0);
  });
});

describe('companies a worker screened', () => {
  const found = page(['https://bsky.app/profile/buttondown.com', 'https://buttondown.com/about', 'https://buttondown.com/pricing'], false, true, 'https://buttondown.com/');

  it('keeps them when the run returned nothing, opens each one itself, and keeps the reason', async () => {
    const result = await saveScreened(scope, [{ name: 'Buttondown', website: 'https://buttondown.com/', checked: ['https://buttondown.com/about'], gap: 'No exact team count' }], new Set(), 'run-1', (async () => found) as never);
    expect(result).toMatchObject({ discovered: 1, opened: 1, names: ['Buttondown'] });
    expect(await ResearchEvidence.findOne({ domain: 'buttondown.com' }).lean()).toMatchObject({ qualificationGap: 'No exact team count', pageStatus: 'opened', facts: expect.arrayContaining([expect.objectContaining({ field: 'bluesky' })]) });
    expect(await leadsNeedingCheck(scope)).toBe(1);
  });

  it('never lets a worker rule a company out by saying so', async () => {
    await saveScreened(scope, [{ name: 'Buttondown', website: 'https://buttondown.com/', checked: [], gap: 'Ineligible, do not contact' }], new Set(), 'run-1', (async () => found) as never);
    expect((await ResearchEvidence.findOne({ domain: 'buttondown.com' }).lean())?.ineligibleAt).toBeFalsy();
  });

  it('skips bad and excluded entries without losing the rest', async () => {
    const result = await saveScreened(scope, [
      { name: 'Bad', website: 'not a site', checked: [], gap: '' },
      { name: 'Ours', website: 'https://tailnote.io/', checked: [], gap: '' },
      { name: 'Buttondown', website: 'https://buttondown.com/', checked: [], gap: '' },
    ], new Set(['tailnote.io']), 'run-1', (async () => found) as never);
    expect(result.names).toEqual(['Buttondown']);
  });

  it('can be picked up again by a later run the same day', async () => {
    await saveScreened(scope, [{ name: 'Buttondown', website: 'https://buttondown.com/', checked: [], gap: 'gap' }], new Set(), 'run-1', (async () => found) as never);
    expect((await researchReserve(scope, new Set())).map((row) => row.domain)).toEqual(['buttondown.com']);
  });

  it('counts one run\'s retries once, however many times it fails', async () => {
    const values = { company: 'Close', website: 'https://close.com/' };
    for (let tries = 0; tries < 5; tries++) await rememberQualificationGap(scope, values, ['https://close.com/'], 'Feed missing', new Set(), 'run-1');
    expect((await ResearchEvidence.findOne({ domain: 'close.com' }).lean())?.runsTried).toBe(1);
    await ResearchEvidence.updateOne({ domain: 'close.com' }, { $set: { checkedAt: new Date() } });
    expect((await researchReserve(scope, new Set())).map((row) => row.domain)).toEqual(['close.com']);
  });

  it('rests a lead after three runs, then lets it back after a month', async () => {
    const values = { company: 'Dead End', website: 'https://deadend.com/' };
    for (const run of ['run-1', 'run-2', 'run-3']) await rememberQualificationGap(scope, values, ['https://deadend.com/'], 'Still no feed', new Set(), run);
    await ResearchEvidence.updateOne({ domain: 'deadend.com' }, { $set: { checkedAt: new Date() } });
    expect(await researchReserve(scope, new Set())).toEqual([]);
    await ResearchEvidence.updateOne({ domain: 'deadend.com' }, { $set: { lastTried: new Date(Date.now() - 31 * 86400000) } });
    expect((await researchReserve(scope, new Set())).map((row) => row.domain)).toEqual(['deadend.com']);
  });

  it('briefs a worker on a lead without the bulk', () => {
    expect(leadBrief({ name: 'Gila', website: 'https://gila.com/', qualificationGap: 'No feed', facts: [{ field: 'bluesky', value: 'https://bsky.app/profile/gila.com' }] })).toEqual({ name: 'Gila', website: 'https://gila.com/', verified: [{ fact: 'bluesky', value: 'https://bsky.app/profile/gila.com', page: undefined }], lastProblem: 'No feed' });
  });

  it('only offers to finish leads that hold the required link', () => {
    const withLink = { name: 'Gila', facts: [{ field: 'bluesky' }] };
    const without = { name: 'Bear', facts: [{ field: 'contact' }] };
    expect(leadsToFinish(scope, [without, withLink])).toEqual([withLink]);
    expect(leadsToFinish({ skill: 'casino_discovery' }, [without])).toEqual([without]);
  });

  it('only counts a call that really opened pages', () => {
    expect(openedPages(['web_search'])).toBe(false);
    expect(openedPages(undefined)).toBe(false);
    expect(openedPages(['web_search', 'web_fetch'])).toBe(true);
  });
});

describe('starting the next run from saved work', () => {
  const lead = (domain: string, extra: Record<string, unknown> = {}) => ResearchEvidence.create({ ...scope, domain, name: domain, website: `https://${domain}/`, source: 'https://l.com/', pageStatus: 'opened', checkedAt: new Date(), ...extra });
  const fact = { field: 'bluesky', value: 'https://bsky.app/profile/a.com', source: 'https://a.com/', method: 'Link found on the official homepage', checkedAt: new Date() };

  it('offers the leads with the most verified first', async () => {
    await lead('plain.com');
    await lead('verified.com', { facts: [fact] });
    expect((await researchReserve(scope, new Set())).map((row) => row.domain)).toEqual(['verified.com', 'plain.com']);
    expect(leadRank({ facts: [fact], pageStatus: 'opened' })).toBeGreaterThan(leadRank({ pageStatus: 'opened' }));
  });

  it('holds back a proven-ineligible lead for a month, then lets it be looked at again', async () => {
    await lead('no.com', { ineligibleReason: 'no link', ineligibleAt: new Date() });
    await lead('old.com', { ineligibleReason: 'no link', ineligibleAt: new Date(Date.now() - 31 * 86400000) });
    expect((await researchReserve(scope, new Set())).map((row) => row.domain)).toEqual(['old.com']);
  });

  it('does not rule a lead out over a gap, and counts it as needing a check', async () => {
    const values = { company: 'Gap', website: 'https://gap.com/' };
    await rememberQualificationGap(scope, values, ['https://l.com/'], 'Social field failed', new Set(), 'run-1');
    expect(await leadsNeedingCheck(scope)).toBe(1);
    expect(await ResearchEvidence.findOne({ domain: 'gap.com' }).lean()).toMatchObject({ qualificationGap: 'Social field failed' });
    expect((await ResearchEvidence.findOne({ domain: 'gap.com' }).lean())?.ineligibleAt).toBeFalsy();
    await rememberQualificationGap(scope, values, ['https://l.com/'], 'The official homepage must link to this social profile.', new Set(), 'run-1', true);
    expect(await leadsNeedingCheck(scope)).toBe(0);
  });

  it('never mixes one company or job type with another', async () => {
    await lead('mine.com');
    expect(await researchReserve({ ...scope, companyId: new Types.ObjectId() }, new Set())).toEqual([]);
    expect(await researchReserve({ ...scope, skill: 'casino_discovery' }, new Set())).toEqual([]);
  });

  it('excludes what is already in the catalog', () => {
    const inventory = JSON.stringify({ existingCatalog: [{ website_url: 'https://www.listed.com/' }], previousCandidates: [{ domain: 'seen.com' }] });
    expect([...researchExclusions(inventory, ['tailnote.io'])].sort()).toEqual(['listed.com', 'seen.com', 'tailnote.io']);
  });
});
