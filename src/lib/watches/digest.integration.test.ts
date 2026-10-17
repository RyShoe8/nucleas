import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/companies/upstreamContext', () => ({ upstreamContext: async () => 'Approved Marketing Plan:\n- Positioning: plain-spoken AI coverage' }));

import { ContentWatch, WatchItem } from '@/lib/models/Watch';
import { ArticleDraft } from '@/lib/models/ArticleDraft';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { startDigest, startDueDigests } from './digest';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const user = new Types.ObjectId();
const companyId = new Types.ObjectId();
const DAY = 86_400_000;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_digest_test'));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  await Promise.all([ContentWatch.deleteMany({}), WatchItem.deleteMany({}), ArticleDraft.deleteMany({}), BrandVoice.deleteMany({})]);
  await BrandVoice.collection.insertOne({ organizationId: org, companyId, status: 'approved', persona: 'Plain-spoken and curious.' });
});

async function makeWatch(over: Record<string, unknown> = {}) {
  const w = await ContentWatch.create({
    organizationId: org, createdByUserId: user, mailboxId: new Types.ObjectId(), companyId, name: 'AI news', description: 'AI industry news', noun: 'story', rank: 'fit', threshold: 50,
    fields: [{ key: 'company', label: 'Company', kind: 'text' }], digest: { enabled: true, cadence: 'weekly', maxItems: 3, lastRunAt: new Date(Date.now() - 8 * DAY) }, ...over,
  });
  return w._id as Types.ObjectId;
}

async function item(watchId: Types.ObjectId, n: number, over: Record<string, unknown> = {}) {
  return WatchItem.create({ organizationId: org, watchId, mailboxId: new Types.ObjectId(), gmailId: `g${n}`, subject: `Story ${n}`, summary: `What happened in story ${n}.`, sentAt: new Date(Date.now() - n * 3600_000), flagged: true, score: n * 10, values: { company: `Co ${n}` }, link: `https://news.example/${n}`, ...over });
}

describe('digests', () => {
  it('writes the period\'s top-ranked flagged items as a digest article that starts at the outline', async () => {
    const watchId = await makeWatch();
    await item(watchId, 1);
    await item(watchId, 3);
    await item(watchId, 2);
    await item(watchId, 6);
    await item(watchId, 4, { flagged: false });
    await item(watchId, 5, { sentAt: new Date(Date.now() - 9 * DAY) });
    const outcome = await startDigest(watchId);
    expect(outcome).toMatchObject({ ok: true, items: 3 });
    if (!outcome.ok) throw new Error('setup');
    const article = await ArticleDraft.findById(outcome.articleId).lean();
    expect(article).toMatchObject({ kind: 'digest', stage: 'outline', status: 'queued', companyId, watchId });
    // Ranked by score and capped at three: story 1, the unflagged one and the old one are left out.
    expect(article?.facts.map((f) => (f.text ?? '').split('.')[0])).toEqual(['Story 6', 'Story 3', 'Story 2']);
    expect(article?.facts[0]?.text).toContain('Company: Co 6');
    expect(article?.facts[0]?.source).toBe('https://news.example/6');
    expect(article?.notes).toContain('plain-spoken AI coverage');
    expect(article?.links.map((l) => l.url)).toEqual(['https://news.example/6', 'https://news.example/3', 'https://news.example/2']);
    expect(await ContentWatch.findById(watchId).lean()).toMatchObject({ digest: { lastArticleId: article?._id } });
  });

  it('never writes the same period twice', async () => {
    const watchId = await makeWatch();
    await item(watchId, 1);
    const [a, b] = await Promise.all([startDigest(watchId), startDigest(watchId)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await ArticleDraft.countDocuments({ watchId })).toBe(1);
    expect(await startDigest(watchId, { manual: true })).toMatchObject({ ok: false, error: expect.stringContaining('Nothing was flagged') });
  });

  it('needs an approved Voice, and says why on the watch', async () => {
    await BrandVoice.deleteMany({});
    const watchId = await makeWatch();
    await item(watchId, 1);
    expect(await startDigest(watchId)).toMatchObject({ ok: false, error: expect.stringContaining('Voice') });
    expect(await ContentWatch.findById(watchId).lean()).toMatchObject({ digest: { lastError: expect.stringContaining('Voice') } });
  });

  it('starts only the digests whose period is over, and moves an empty period on', async () => {
    const due = await makeWatch();
    await item(due, 1);
    const empty = await makeWatch({ name: 'Empty' });
    await makeWatch({ name: 'Recent', digest: { enabled: true, cadence: 'weekly', lastRunAt: new Date(Date.now() - DAY) } });
    await makeWatch({ name: 'Off', digest: { enabled: false, lastRunAt: new Date(Date.now() - 30 * DAY) } });
    expect(await startDueDigests({ limit: 5 })).toEqual({ started: 1 });
    expect(await ArticleDraft.countDocuments({})).toBe(1);
    expect(Date.now() - ((await ContentWatch.findById(empty).lean())?.digest?.lastRunAt?.getTime() ?? 0)).toBeLessThan(60_000);
  });
});
