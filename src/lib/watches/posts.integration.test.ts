import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/companyChat', () => ({ attemptCompanyCredentialChat: vi.fn() }));
const company = vi.hoisted(() => ({ id: 'c'.repeat(24) }));
vi.mock('@/lib/companies/companyProfile', () => ({
  isCompanyManager: (v: { role: string }) => v.role === 'Administrator' || v.role === 'Manager',
  getCompanyProfile: async (_v: unknown, id: string) => (id === company.id ? { id, name: 'PlayBound', socialLinks: [{ network: 'x', url: 'https://x.com/pb' }, { network: 'bluesky', url: 'https://bsky.app/profile/pb' }, { network: 'github', url: 'https://github.com/pb' }] } : null),
}));

import { ContentWatch, WatchItem, WatchMailbox, WatchPost } from '@/lib/models/Watch';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { cleanPostCopy, dealsToPost, draftPostsForItem, draftPostsForNewlyFlagged, listPosts, platformsForLinks, postSystemPrompt, postUserPrompt, updatePost, type AskWriter } from './posts';
import { buildDealMetricsFromAmounts } from './dealMetrics';
import type { DealMetrics } from './types';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const user = new Types.ObjectId();
const viewer = { userId: String(user), organizationId: org, employeeId: null, role: 'Manager' as const };

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_watch_posts_test'));
  await Promise.all([ContentWatch.syncIndexes(), WatchItem.syncIndexes(), WatchPost.syncIndexes(), BrandVoice.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

const deal = (pay: number, credit: number): DealMetrics => buildDealMetricsFromAmounts(pay, credit, 'pay_vs_credited_value', 0.6, 'regex', 'USD', 'SC')!;

describe('drafting rules', () => {
  it('drafts for the company’s linked platforms, defaulting to X', () => {
    expect(platformsForLinks([{ network: 'bluesky' }, { network: 'github' }, { network: 'x' }, { network: 'bluesky' }])).toEqual(['bluesky', 'twitter']);
    expect(platformsForLinks([{ network: 'github' }])).toEqual(['twitter']);
  });

  it('posts a deal tier only when it reaches the threshold, strongest first, and a content post otherwise', () => {
    const strong = deal(20, 30);
    const weak = deal(20, 22);
    expect(dealsToPost({ deals: [weak, strong] }, 'deal', 30).map((t) => t.deal)).toEqual([strong]);
    expect(dealsToPost({ deals: [weak] }, 'deal', 30)).toEqual([]);
    expect(dealsToPost({ deals: [] }, 'match', 60)).toEqual([{ key: 'content-only', deal: null }]);
  });

  it('cleans model output into plain post text', () => {
    expect(cleanPostCopy('```\n**Big** news: "ships Friday"\n```')).toBe('Big news: "ships Friday"');
    expect(cleanPostCopy('"A quoted post."')).toBe('A quoted post.');
    expect(cleanPostCopy('# Heading\n\n\n\nBody')).toBe('Heading\n\nBody');
  });

  it('puts the Voice and the hard limit in the prompt and keeps the email as data', () => {
    const system = postSystemPrompt({ persona: 'Dry, nostalgic gamer.', platform: 'bluesky', hasDeal: true });
    expect(system).toContain('Dry, nostalgic gamer.');
    expect(system).toContain('Hard limit 300 characters');
    expect(system).toContain('untrusted data');
    expect(postUserPrompt({ subject: 'S', from: 'a@b.com', deal: deal(20, 26), link: 'https://x.test/y', platform: 'twitter', keyPoints: [{ text: 'Ends Friday' }] })).toContain('Deal: $20 → 26 SC');
  });
});

let watchId: Types.ObjectId;
let itemId: Types.ObjectId;
async function setup(over: { mode?: 'match' | 'deal'; companyId?: Types.ObjectId | null; approved?: boolean; deals?: DealMetrics[] } = {}) {
  await Promise.all([ContentWatch.deleteMany({}), WatchItem.deleteMany({}), WatchPost.deleteMany({}), WatchMailbox.deleteMany({}), BrandVoice.deleteMany({})]);
  const companyId = over.companyId === undefined ? new Types.ObjectId(company.id) : over.companyId;
  const w = await ContentWatch.create({ organizationId: org, createdByUserId: user, mailboxId: new Types.ObjectId(), name: 'W', mode: over.mode ?? 'deal', threshold: 25, autoPosts: true, ...(companyId ? { companyId } : {}) });
  watchId = w._id;
  const d = over.deals ?? [deal(20, 30)];
  const item = await WatchItem.create({ organizationId: org, watchId, mailboxId: w.mailboxId, gmailId: 'g1', subject: 'Big offer', fromEmail: 'deals@shop.com', summary: 'Twenty dollars buys thirty credits.', flagged: true, score: 50, deals: d, bestDeal: d[0], link: 'https://shop.com/claim' });
  itemId = item._id;
  if (over.approved !== false) await BrandVoice.create({ organizationId: org, companyId: new Types.ObjectId(company.id), persona: 'Dry, nostalgic gamer who keeps it short.', status: 'approved', updatedByUserId: user });
}

const ask = (reply: string | null = 'Twenty bucks, thirty credits. Not bad. https://shop.com/claim'): AskWriter & { calls: { system: string }[] } => {
  const calls: { system: string }[] = [];
  const fn = (async (input: { system: string }) => {
    calls.push({ system: input.system });
    return reply;
  }) as unknown as AskWriter & { calls: { system: string }[] };
  fn.calls = calls;
  return fn;
};

describe('drafting posts for an email', () => {
  beforeEach(() => setup());

  it('writes one post per qualifying deal, with copy for each linked platform, in the Voice', async () => {
    const writer = ask();
    const result = await draftPostsForItem(org, String(user), String(itemId), { source: 'manual', ask: writer });
    expect(result).toMatchObject({ ok: true, data: { created: 1 } });
    if (!result.ok) throw new Error('x');
    expect(Object.keys(result.data.posts[0]!.copyByPlatform).sort()).toEqual(['bluesky', 'twitter']);
    expect(result.data.posts[0]).toMatchObject({ title: 'Big offer', link: 'https://shop.com/claim', status: 'draft', dealSummary: expect.stringContaining('$20') });
    expect(writer.calls).toHaveLength(2);
    expect(writer.calls[0]!.system).toContain('Dry, nostalgic gamer');
  });

  it('never writes the same post twice', async () => {
    const writer = ask();
    await draftPostsForItem(org, String(user), String(itemId), { source: 'manual', ask: writer });
    const again = await draftPostsForItem(org, String(user), String(itemId), { source: 'auto', ask: writer });
    expect(again).toMatchObject({ ok: true, data: { created: 0 } });
    expect(writer.calls).toHaveLength(2);
    expect(await WatchPost.countDocuments({ itemId })).toBe(1);
  });

  it('falls back to the subject and deal line when no model answers, within the platform limit', async () => {
    const result = await draftPostsForItem(org, String(user), String(itemId), { source: 'manual', ask: ask(null) });
    if (!result.ok) throw new Error('x');
    expect(result.data.posts[0]!.copyByPlatform.twitter).toContain('Big offer');
    expect(result.data.posts[0]!.copyByPlatform.bluesky!.length).toBeLessThanOrEqual(300);
  });

  it('needs a company and an approved Voice', async () => {
    await setup({ companyId: null });
    expect(await draftPostsForItem(org, String(user), String(itemId), { source: 'manual', ask: ask() })).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('company') });
    await setup({ approved: false });
    expect(await draftPostsForItem(org, String(user), String(itemId), { source: 'manual', ask: ask() })).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('Voice') });
  });

  it('drafts nothing for a deal below the threshold, and one content post for a match watch', async () => {
    await setup({ deals: [deal(20, 22)] });
    expect(await draftPostsForItem(org, String(user), String(itemId), { source: 'manual', ask: ask() })).toMatchObject({ ok: true, data: { created: 0, posts: [] } });
    await setup({ mode: 'match' });
    const result = await draftPostsForItem(org, String(user), String(itemId), { source: 'manual', ask: ask() });
    expect(result).toMatchObject({ ok: true, data: { created: 1 } });
    expect(await WatchPost.findOne({ itemId }).lean()).toMatchObject({ dealKey: 'content-only' });
  });

  it('keeps organizations apart', async () => {
    expect(await draftPostsForItem(new Types.ObjectId(), String(user), String(itemId), { source: 'manual', ask: ask() })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('after a scan, and managing drafts', () => {
  beforeEach(() => setup());

  it('drafts for newly flagged emails only when the watch asks for it', async () => {
    const writer = ask();
    expect(await draftPostsForNewlyFlagged(watchId, new Date(Date.now() - 60_000), writer)).toEqual({ drafted: 1 });
    await WatchPost.deleteMany({});
    await ContentWatch.updateOne({ _id: watchId }, { $set: { autoPosts: false } });
    expect(await draftPostsForNewlyFlagged(watchId, new Date(Date.now() - 60_000), writer)).toEqual({ drafted: 0 });
    await ContentWatch.updateOne({ _id: watchId }, { $set: { autoPosts: true } });
    expect(await draftPostsForNewlyFlagged(watchId, new Date(Date.now() + 60_000), writer)).toEqual({ drafted: 0 });
  });

  it('lists, edits and archives drafts', async () => {
    await draftPostsForItem(org, String(user), String(itemId), { source: 'manual', ask: ask() });
    const listed = await listPosts(viewer, String(watchId));
    if (!listed.ok) throw new Error('x');
    const id = listed.data[0]!.id;
    expect(await updatePost(viewer, id, { platform: 'twitter', copy: 'Edited by hand.' })).toMatchObject({ ok: true, data: { copyByPlatform: { twitter: 'Edited by hand.' } } });
    expect(await updatePost(viewer, id, { copy: 'No platform' })).toMatchObject({ ok: false, status: 400 });
    expect(await updatePost(viewer, id, { status: 'archived' })).toMatchObject({ ok: true, data: { status: 'archived' } });
    expect((await listPosts(viewer, String(watchId)) as { data: unknown[] }).data).toHaveLength(0);
    expect((await listPosts(viewer, String(watchId), 'archived') as { data: unknown[] }).data).toHaveLength(1);
    expect(await updatePost({ ...viewer, organizationId: new Types.ObjectId() }, id, { status: 'draft' })).toMatchObject({ ok: false, status: 404 });
    expect(await updatePost({ ...viewer, role: 'User' as unknown as 'Manager' }, id, { status: 'draft' })).toMatchObject({ ok: false, status: 403 });
  });
});
