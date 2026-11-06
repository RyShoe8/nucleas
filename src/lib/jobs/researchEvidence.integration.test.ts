import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/tools/webFetch', () => ({ webFetch: vi.fn() }));

import { homepageFacts, leadRank, leadsNeedingCheck, rememberQualificationGap, ResearchEvidence, researchExclusions, researchReserve, saveScoutBatch } from './researchEvidence';

const scope = { organizationId: new Types.ObjectId(), companyId: new Types.ObjectId(), skill: 'signature_outreach' };
const report = (...sites: string[]) => JSON.stringify({ candidates: sites.map((site) => ({ name: site, website: `https://${site}/`, source: 'https://listing.com/launches' })) });
const page = (links: string[], thin = false, rendered = false) => ({ thin, links, rendered });
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
    await rememberQualificationGap(scope, values, ['https://l.com/'], 'Social field failed', new Set());
    expect(await leadsNeedingCheck(scope)).toBe(1);
    expect(await ResearchEvidence.findOne({ domain: 'gap.com' }).lean()).toMatchObject({ qualificationGap: 'Social field failed' });
    expect((await ResearchEvidence.findOne({ domain: 'gap.com' }).lean())?.ineligibleAt).toBeFalsy();
    await rememberQualificationGap(scope, values, ['https://l.com/'], 'The official homepage must link to this social profile.', new Set(), true);
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
