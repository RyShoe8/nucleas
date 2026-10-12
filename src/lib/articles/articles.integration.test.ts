import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
const company = vi.hoisted(() => ({ id: 'c'.repeat(24) }));
vi.mock('@/lib/companies/companyProfile', () => ({
  isCompanyManager: () => true,
  getCompanyProfile: async (_v: unknown, id: string) => (id === company.id ? { id, name: 'FrugalGambler' } : null),
}));

import { ArticleDraft } from '@/lib/models/ArticleDraft';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { advanceArticle, assess, buildVoiceInputs, parseJson, resumeStaleArticles, type ArticleDeps } from './pipeline';
import { createArticle, getArticle, listArticles, requeueArticle, restartArticle, saveArticleText } from './articles';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const user = new Types.ObjectId();
const viewer = { userId: String(user), organizationId: org, employeeId: null, role: 'Manager' as const };

const EXAMPLES = `# Free spins, explained

We test every bonus ourselves. We never recommend one we would not take.

Most welcome offers hide the catch in the wagering terms. We read them so you do not have to.

# What we look for

A 35x playthrough on $50 is $1,750 of play. That is the real price. We say so.

No fluff.`;

const MACHINE_DRAFT = `# Welcome Bonuses

In today's fast-paced world, it's worth noting that welcome bonuses are a game-changing way to maximize your fun. Players can leverage a plethora of offers.

## Key Takeaways

In conclusion, don't miss out on this exciting opportunity — act now!`;

const GOOD_DRAFT = `# What a welcome bonus really costs

We read the terms so you do not have to. A bonus is only as good as its wagering rule.

## The playthrough is the price

A 35x playthrough on $50 is $1,750 of play. We think that is the number to look at first. https://example.com/terms covers the rules.

## What we would take

We take the small ones with low playthrough. We skip the rest.

No fluff.`;

function deps(overrides: Partial<ArticleDeps> & { drafts?: string[] } = {}): ArticleDeps & { calls: string[] } {
  const calls: string[] = [];
  const drafts = [...(overrides.drafts ?? [MACHINE_DRAFT, GOOD_DRAFT])];
  return {
    calls,
    async ask({ need, user: prompt }) {
      calls.push(need);
      if (need === 'utility' && /search/i.test(prompt + 'x') && calls.filter((c) => c === 'utility').length === 1) return { text: '{"queries":["welcome bonus wagering"]}', model: 'util-1' };
      if (need === 'research') return { text: '{"facts":[{"text":"A 35x playthrough on a $50 bonus means $1,750 of wagering.","source":"https://example.com/terms"}]}', model: 'research-1' };
      if (need === 'plan') return { text: '{"title":"What a welcome bonus really costs","angle":"The math","sections":[{"heading":"The playthrough is the price","points":["35x on $50"]},{"heading":"What we would take","points":["low playthrough"]}]}', model: 'plan-1' };
      if (need === 'write') return { text: drafts.shift() ?? GOOD_DRAFT, model: 'write-1' };
      return { text: 'How a welcome bonus really costs you, in plain numbers.', model: 'util-1' };
    },
    search: overrides.search ?? (async () => [{ title: 'Terms', url: 'https://example.com/terms', text: 'A 35x playthrough on a $50 bonus means you must wager $1,750 before withdrawing. '.repeat(3) }]),
    fetchPage: overrides.fetchPage ?? (async () => null),
  };
}

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_articles_test'));
  await Promise.all([ArticleDraft.syncIndexes(), BrandVoice.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  await Promise.all([ArticleDraft.deleteMany({}), BrandVoice.deleteMany({})]);
});

const approveVoice = (examples = EXAMPLES) => BrandVoice.create({ organizationId: org, companyId: new Types.ObjectId(company.id), persona: 'Dry, plain-spoken gambling nerd.', examples, status: 'approved', revision: 3, updatedByUserId: user });
const start = async (extra: Record<string, unknown> = {}) => {
  const created = await createArticle(viewer, { companyId: company.id, topic: 'How welcome bonuses work', notes: '', length: 'short', faq: false, referenceUrls: [], links: [{ url: 'https://example.com/terms' }], ...extra } as never);
  if (!created.ok) throw new Error(created.error);
  await ArticleDraft.updateOne({ _id: created.data.id }, { targetWords: 90 });
  return created.data.id;
};

describe('creating an article', () => {
  it('needs an approved Voice and a visible company', async () => {
    const noVoice = await createArticle(viewer, { companyId: company.id, topic: 'Anything', notes: '', length: 'short', faq: false, referenceUrls: [], links: [] });
    expect(noVoice).toMatchObject({ ok: false, status: 409 });
    await approveVoice();
    expect(await createArticle(viewer, { companyId: 'd'.repeat(24), topic: 'Anything', notes: '', length: 'short', faq: false, referenceUrls: [], links: [] })).toMatchObject({ ok: false, status: 404 });
    expect((await createArticle(viewer, { companyId: company.id, topic: 'Anything', notes: '', length: 'long', faq: false, referenceUrls: [], links: [] })).ok).toBe(true);
    expect((await listArticles(viewer))[0]).toMatchObject({ status: 'queued', targetWords: 1800 });
  });
});

describe('the pipeline', () => {
  it('researches, outlines, drafts and revises a machine-sounding first draft until it matches the Voice', async () => {
    await approveVoice();
    const id = await start();
    const d = deps();
    expect(await advanceArticle(id, d)).toBe('done');
    const article = (await getArticle(viewer, id))!;
    expect(article.status).toBe('done');
    expect(article.title).toBe('What a welcome bonus really costs');
    expect(article.body).toContain('A 35x playthrough on $50');
    expect(article.body).not.toMatch(/fast-paced|game-changing|[–—]/);
    expect(article.fidelityMeasured).toBe(true);
    expect(article.fidelity).toBeGreaterThanOrEqual(72);
    expect(article.sources).toEqual(['https://example.com/terms']);
    expect(article.metaDescription).toMatch(/welcome bonus/);
    expect(article.modelPath).toEqual(expect.arrayContaining(['util-1', 'research-1', 'plan-1', 'write-1']));
    // two writer calls: the machine draft, then the revision
    expect(d.calls.filter((c) => c === 'write')).toHaveLength(2);
    const stored = await ArticleDraft.findById(id).lean();
    expect(stored?.attempts?.[0]?.issues?.length).toBeGreaterThan(0);
    expect(stored?.voiceRevision).toBe(3);
  });

  it('keeps the best attempt and warns when the draft never fully matches', async () => {
    await approveVoice();
    const id = await start({ links: [] });
    const d = deps({ drafts: [MACHINE_DRAFT, MACHINE_DRAFT, MACHINE_DRAFT] });
    expect(await advanceArticle(id, d)).toBe('done');
    const article = (await getArticle(viewer, id))!;
    expect(article.warnings.join(' ')).toMatch(/Voice match|generic/);
    expect(d.calls.filter((c) => c === 'write')).toHaveLength(3);
    expect(article.body).not.toMatch(/[–—]/);
  });

  it('warns about missing links and missing research instead of inventing sources', async () => {
    await approveVoice();
    const id = await start({ links: [{ url: 'https://example.com/never-mentioned' }] });
    const d = deps({ search: async () => [], drafts: [GOOD_DRAFT, GOOD_DRAFT, GOOD_DRAFT] });
    expect(await advanceArticle(id, d)).toBe('done');
    const article = (await getArticle(viewer, id))!;
    expect((await ArticleDraft.findById(id).lean())?.facts ?? []).toEqual([]);
    expect(article.warnings.join(' ')).toMatch(/Link not placed: https:\/\/example.com\/never-mentioned/);
    expect(article.warnings.join(' ')).toMatch(/No web sources/);
  });

  it('says so when the Voice has no samples, rather than faking a match score', async () => {
    await approveVoice('');
    const id = await start({ links: [] });
    await advanceArticle(id, deps({ drafts: [GOOD_DRAFT] }));
    const article = (await getArticle(viewer, id))!;
    expect(article.fidelityMeasured).toBe(false);
    expect(article.warnings.join(' ')).toMatch(/no writing samples/);
  });

  it('fails cleanly when the Voice is no longer approved, and resumes at the saved stage after a failure', async () => {
    const voice = await approveVoice();
    const id = await start({ links: [] });
    await BrandVoice.updateOne({ _id: voice._id }, { status: 'draft' });
    expect(await advanceArticle(id, deps())).toBe('failed');
    expect((await getArticle(viewer, id))!.error).toMatch(/Approve/);
    await BrandVoice.updateOne({ _id: voice._id }, { status: 'approved' });

    // Plan model fails the first time: the research checkpoint must survive.
    let planFails = true;
    const base = deps({ drafts: [GOOD_DRAFT] });
    const flaky: ArticleDeps = { ...base, ask: async (input) => (input.need === 'plan' && planFails ? null : base.ask(input)) };
    expect(await advanceArticle(id, flaky)).toBe('failed');
    const mid = await ArticleDraft.findById(id).lean();
    expect(mid?.stage).toBe('outline');
    expect(mid?.facts?.length).toBe(1);
    planFails = false;
    expect(await requeueArticle(viewer, id)).toBe(true);
    expect(await advanceArticle(id, flaky)).toBe('done');
    expect(base.calls.filter((c) => c === 'research')).toHaveLength(1);
  });

  it('does not run twice at once, and the cron resumes queued and abandoned runs', async () => {
    await approveVoice();
    const id = await start({ links: [] });
    await ArticleDraft.updateOne({ _id: id }, { status: 'running', leaseUntil: new Date(Date.now() + 60_000) });
    expect(await advanceArticle(id, deps())).toBe('busy');
    expect(await advanceArticle(new Types.ObjectId(), deps())).toBe('missing');
    await ArticleDraft.updateOne({ _id: id }, { leaseUntil: new Date(Date.now() - 1000) });
    expect(await resumeStaleArticles(deps({ drafts: [GOOD_DRAFT] }), 5)).toBe(1);
    expect((await getArticle(viewer, id))!.status).toBe('done');
  });

  it('restarts from research and keeps hand edits to the finished text', async () => {
    await approveVoice();
    const id = await start({ links: [] });
    await advanceArticle(id, deps({ drafts: [GOOD_DRAFT] }));
    const edited = await saveArticleText(viewer, id, { title: 'My title', body: 'Edited by hand.' });
    expect(edited).toMatchObject({ ok: true, data: { title: 'My title', body: 'Edited by hand.' } });
    expect(await restartArticle(viewer, id)).toBe(true);
    const row = await ArticleDraft.findById(id).lean();
    expect(row).toMatchObject({ status: 'queued', stage: 'research', body: '' });
  });
});

describe('helpers', () => {
  it('parses JSON out of chatty model replies', () => {
    expect(parseJson<{ a: number }>('Sure! {"a": 1} Hope that helps')).toEqual({ a: 1 });
    expect(parseJson('no json here')).toBeNull();
    expect(parseJson('{broken')).toBeNull();
  });

  it('assesses length, links and style together', () => {
    const voice = buildVoiceInputs({ persona: 'x', examples: EXAMPLES });
    const good = assess(GOOD_DRAFT, voice, { targetWords: 100, links: [{ url: 'https://example.com/terms' }] });
    expect(good.issues).toEqual([]);
    const bad = assess(MACHINE_DRAFT, voice, { targetWords: 600, links: [{ url: 'https://example.com/x' }] });
    expect(bad.issues.join(' ')).toMatch(/Too short/);
    expect(bad.issues.join(' ')).toMatch(/link https:\/\/example.com\/x is missing/);
    expect(bad.score).toBeLessThan(good.score);
  });
});
