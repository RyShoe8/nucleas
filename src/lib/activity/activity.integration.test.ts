import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
const company = vi.hoisted(() => ({ id: 'c'.repeat(24) }));
vi.mock('@/lib/companies/companyProfile', () => ({
  isCompanyManager: () => true,
  getCompanyProfile: async (_v: unknown, id: string) => (id === company.id ? { id, name: 'PlayBound' } : null),
  listCompanyProfiles: async () => [{ id: company.id, name: 'PlayBound' }],
}));
vi.mock('@/lib/building/builds', () => ({
  listBuilds: async () => [
    { id: 'b1', companyId: company.id, companyName: 'PlayBound', status: 'building', request: 'Add a sitemap', title: 'Add a sitemap', repository: { fullName: 'acme/site' }, startedAt: new Date().toISOString(), attempts: 1, result: null, error: null },
    { id: 'b2', companyId: company.id, companyName: 'PlayBound', status: 'proposed', request: 'Fix footer', title: 'Fix footer', repository: { fullName: 'acme/site' }, startedAt: null, attempts: 0, result: null, error: null },
    { id: 'b3', companyId: company.id, companyName: 'PlayBound', status: 'pr_opened', request: 'Done thing', title: 'Done thing', repository: { fullName: 'acme/site' }, startedAt: null, attempts: 1, result: null, error: null },
  ],
}));

import { ContentWatch, WatchItem, WatchMailbox } from '@/lib/models/Watch';
import { ArticleDraft } from '@/lib/models/ArticleDraft';
import { PropertyOverview } from '@/lib/models/PropertyOverview';
import { listActivity } from './activity';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const viewer = { userId: String(new Types.ObjectId()), organizationId: org, employeeId: null, role: 'Manager' as const };

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_activity_test'));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  await Promise.all([ContentWatch.deleteMany({}), WatchItem.deleteMany({}), WatchMailbox.deleteMany({}), ArticleDraft.deleteMany({}), PropertyOverview.deleteMany({})]);
});

describe('activity', () => {
  it('lists watches, articles, builds and overview crawls in the right groups', async () => {
    const mailbox = await WatchMailbox.create({ organizationId: org, emailAddress: 'me@example.org', refreshTokenSealed: 'x', status: 'connected' });
    const companyId = new Types.ObjectId(company.id);
    await ContentWatch.create({ organizationId: org, createdByUserId: new Types.ObjectId(), mailboxId: mailbox._id, companyId, name: 'Deals', description: 'd', scanLeaseUntil: new Date(Date.now() + 60_000) });
    await ContentWatch.create({ organizationId: org, createdByUserId: new Types.ObjectId(), mailboxId: mailbox._id, name: 'News', description: 'd', lastScanAt: new Date(), lastScanOk: true, lastScanStats: { fresh: 4, flagged: 2 } });
    await ContentWatch.create({ organizationId: org, createdByUserId: new Types.ObjectId(), mailboxId: mailbox._id, name: 'Paused', description: 'd', active: false });
    await ArticleDraft.create({ organizationId: org, companyId, createdByUserId: new Types.ObjectId(), topic: 'Weekly digest', kind: 'digest', status: 'running', progress: 'Outlining' });
    await ArticleDraft.create({ organizationId: org, companyId, createdByUserId: new Types.ObjectId(), topic: 'Finished', status: 'done' });
    await PropertyOverview.create({ organizationId: org, companyId, rootUrl: 'https://playbound.club', status: 'crawling', progress: '40 pages' });

    const items = await listActivity(viewer as never);
    const by = (id: string) => items.find((i) => i.title === id);
    expect(by('Deals')).toMatchObject({ kind: 'watch', group: 'working', status: 'Scanning', category: 'marketing', companyName: 'PlayBound' });
    expect(by('News')).toMatchObject({ group: 'set', detail: expect.stringContaining('4 new, 2 flagged') });
    expect(by('Paused')).toBeUndefined();
    expect(by('Weekly digest')).toMatchObject({ kind: 'article', group: 'working', category: 'content', detail: 'Digest · Outlining' });
    expect(by('Finished')).toBeUndefined();
    expect(by('Add a sitemap')).toMatchObject({ kind: 'build', group: 'working', category: 'building', open: { window: 'building' } });
    expect(by('Fix footer')).toMatchObject({ group: 'you', status: 'Plan ready' });
    expect(by('Done thing')).toBeUndefined();
    expect(by('Company Overview · PlayBound')).toMatchObject({ kind: 'overview', group: 'working', detail: expect.stringContaining('40 pages') });
  });

  it('drops an old overview failure once a newer crawl of the same company runs', async () => {
    const companyId = new Types.ObjectId(company.id);
    await PropertyOverview.create({ organizationId: org, companyId, rootUrl: 'https://playbound.club', status: 'failed', error: 'timeout' });
    expect((await listActivity(viewer as never)).filter((i) => i.kind === 'overview')).toMatchObject([{ group: 'failed' }]);
    await PropertyOverview.create({ organizationId: org, companyId, rootUrl: 'https://playbound.club', status: 'queued' });
    expect((await listActivity(viewer as never)).filter((i) => i.kind === 'overview')).toMatchObject([{ group: 'working', status: 'Starting' }]);
  });
});
