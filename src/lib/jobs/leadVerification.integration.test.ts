import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/tools/webFetch', () => ({ webFetch: vi.fn() }));
vi.mock('@/lib/ai/tools/browserClient', () => ({ browserNavigate: vi.fn(), browserFetch: vi.fn() }));

import { EVIDENCE_FIELDS, leadCheckAssignment, missingEvidence, verifyLeadClaims, type VerifyDeps } from './leadVerification';
import { ResearchEvidence } from './researchEvidence';

const scope = { organizationId: new Types.ObjectId(), companyId: new Types.ObjectId(), skill: 'signature_outreach' };
const today = new Date().toISOString().slice(0, 10);
const lead = { name: 'Transistor', domain: 'transistor.fm', website: 'https://transistor.fm/', facts: [{ field: 'bluesky', value: 'https://bsky.app/profile/transistor.fm', source: 'https://transistor.fm/', method: 'Link found on the official homepage in a real browser' }] };
const pagesText: Record<string, string> = {
  'https://transistor.fm/about/': "Here's our team: Jon Buda, Co-founder, President Justin Jackson, Co-founder, CEO",
  'https://transistor.fm/changelog/mcp/': 'We launched our MCP server for podcasters today.',
  'https://transistor.fm/contact/': 'Email support@transistor.fm any time.',
};
const deps: VerifyDeps = {
  open: async (url) => ({ url, text: 'shortened', plainText: pagesText[url] ?? '' }),
  readFeed: async () => '<?xml version="1.0"?><rss version="2.0"></rss>',
  isImage: async () => true,
  officialHosts: async () => new Set(['transistor.substack.com']),
};
const good = {
  team_source: 'https://transistor.fm/about/', team_quote: "Here's our team: Jon Buda, Co-founder, President",
  growth_source: 'https://transistor.fm/changelog/mcp/', growth_quote: 'We launched our MCP server', growth_date: today,
  person_source: 'https://transistor.fm/about/', first_name: 'Justin', last_name: 'Jackson', role: 'CEO',
  contact_source: 'https://transistor.fm/contact/', email: 'support@transistor.fm',
  feed: 'https://transistor.fm/blog/feed.xml', logo: 'https://transistor.fm/mark.svg',
};

let replica: MongoMemoryReplSet;
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_lead_verification_test'));
});
afterAll(async () => {
  await mongoose.disconnect();
  await replica.stop();
});
beforeEach(async () => {
  await ResearchEvidence.deleteMany({});
  await ResearchEvidence.create({ ...scope, ...lead });
});

describe('a small job for a free model', () => {
  it('asks only for what is still missing, in a short prompt', () => {
    const prompt = leadCheckAssignment(lead, ['email', 'feed']);
    expect(prompt).toContain('Transistor');
    expect(prompt).toContain('"email"');
    expect(prompt).not.toContain('"team_quote"');
    expect(prompt.length).toBeLessThan(800);
  });

  it('does not count a homepage link as proof of the fact', () => {
    expect(missingEvidence({ facts: [{ field: 'feed', value: 'https://x.com/features/rss', method: 'Link found on the official homepage' }] })).toContain('feed');
    expect(missingEvidence({ facts: EVIDENCE_FIELDS.map((field) => ({ field, method: 'Opened and confirmed by Nucleas' })) })).toEqual([]);
  });
});

describe('checking what it reports', () => {
  it('saves everything that checks out, with where it was found', async () => {
    const result = await verifyLeadClaims(scope, lead, JSON.stringify(good), deps);
    expect(result.rejected).toEqual([]);
    expect(result.confirmed.sort()).toEqual([...EVIDENCE_FIELDS].sort());
    const saved = await ResearchEvidence.findOne({ domain: 'transistor.fm' }).lean();
    expect(saved?.facts?.find((fact) => fact.field === 'email')).toMatchObject({ value: 'support@transistor.fm', source: 'https://transistor.fm/contact/', method: 'Opened and confirmed by Nucleas' });
    expect(saved?.facts?.find((fact) => fact.field === 'bluesky')?.value).toBe('https://bsky.app/profile/transistor.fm');
  });

  it('accepts a good reply wrapped in text or a code fence', async () => {
    expect((await verifyLeadClaims(scope, lead, '```json\n' + JSON.stringify({ email: good.email, contact_source: good.contact_source }) + '\n```', deps)).confirmed).toEqual(['email']);
  });

  it('saves nothing a page does not actually say', async () => {
    const made = { ...good, team_quote: 'We are a team of 4 friends', growth_quote: 'We raised ten million', email: 'ceo@transistor.fm', role: 'Chief Wizard' };
    const result = await verifyLeadClaims(scope, lead, JSON.stringify(made), deps);
    expect(result.confirmed.sort()).toEqual(['feed', 'logo']);
    expect(result.rejected.join(' ')).toContain('team: the quote is not on that page');
    expect(result.rejected.join(' ')).toContain('email: the address is not on that page');
  });

  it('refuses evidence from other sites, old dates, oversized teams and non-feeds', async () => {
    const result = await verifyLeadClaims(scope, lead, JSON.stringify({
      growth_source: 'https://techcrunch.com/story', growth_quote: 'x launched', growth_date: today,
      team_source: good.team_source, team_quote: 'We are a team of 40.', feed: good.feed,
    }), { ...deps, readFeed: async () => '<html>a page</html>' });
    expect(result.confirmed).toEqual([]);
    expect(result.rejected.join(' ')).toContain("growth: that page is not the company's own");
    expect(result.rejected.join(' ')).toContain('40 people');
    expect(result.rejected.join(' ')).toContain('feed: that address is not a feed');
    const old = await verifyLeadClaims(scope, lead, JSON.stringify({ growth_source: good.growth_source, growth_quote: good.growth_quote, growth_date: '2020-01-01' }), deps);
    expect(old.rejected.join(' ')).toContain('not within the last year');
  });

  it('accepts the company\'s own hosted blog', async () => {
    const blog = 'https://transistor.substack.com/p/launch';
    const result = await verifyLeadClaims(scope, lead, JSON.stringify({ growth_source: blog, growth_quote: 'We launched today', growth_date: today }), { ...deps, open: async (url) => ({ url, text: 'We launched today' }) });
    expect(result.confirmed).toEqual(['growth']);
  });

  it('treats a page that redirects away as unproven', async () => {
    const result = await verifyLeadClaims(scope, lead, JSON.stringify({ email: good.email, contact_source: good.contact_source }), { ...deps, open: async () => ({ url: 'https://elsewhere.com/', text: good.email }) });
    expect(result.confirmed).toEqual([]);
    expect(result.rejected.join(' ')).toContain('redirected');
  });

  it('survives an unreadable reply and leaves saved facts alone', async () => {
    expect((await verifyLeadClaims(scope, lead, 'I could not find anything.', deps)).confirmed).toEqual([]);
    expect((await ResearchEvidence.findOne({ domain: 'transistor.fm' }).lean())?.facts).toHaveLength(1);
  });

  it('replaces an unconfirmed link with the confirmed fact', async () => {
    await ResearchEvidence.updateOne({ domain: 'transistor.fm' }, { $push: { facts: { field: 'feed', value: 'https://transistor.fm/features/rss', method: 'Link found on the official homepage' } } });
    const current = (await ResearchEvidence.findOne({ domain: 'transistor.fm' }).lean())!;
    const result = await verifyLeadClaims(scope, { ...lead, facts: current.facts }, JSON.stringify({ feed: good.feed }), deps);
    expect(result.facts.filter((fact) => fact.field === 'feed').map((fact) => fact.value)).toEqual([good.feed]);
  });
});
