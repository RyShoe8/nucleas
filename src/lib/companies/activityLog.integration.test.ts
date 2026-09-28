import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/building/companyCode', () => ({
  resolveCompanyRepository: async () => ({ projectId: new Types.ObjectId(), projectName: 'PlayBound', repository: { fullName: 'RyShoe8/playbound' } }),
}));
vi.mock('@/lib/ai/repo/history', () => ({
  recentCommits: async () => ({
    ok: true,
    branch: 'main',
    commits: [
      { sha: 'a1b2c3d4e5f6', message: 'Remove OpenHV edition from OpenRA\n\nlonger body', author: 'Ryan', date: '2026-09-27T12:00:00.000Z', files: [{ path: 'src/games/openra.ts', status: 'modified', additions: 0, deletions: 1 }] },
    ],
  }),
}));

import Client from '@/lib/models/Client';
import { CapabilityInvocation } from '@/lib/models/Capability';
import { BuildRequest } from '@/lib/models/BuildRequest';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { ActivityEvent, companyTimeline, recordActivity, renderTimeline } from './activityLog';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const admin: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: org, employeeId: null, role: 'Administrator' };
let companyId: Types.ObjectId;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_activity_test'));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  await Promise.all([Client.deleteMany({}), CapabilityInvocation.deleteMany({}), BuildRequest.deleteMany({}), ActivityEvent.deleteMany({})]);
  const company = await Client.create({ organizationId: org, name: 'Playbound.club', color: '#222', relationship: 'owned' });
  companyId = company._id;
});

describe('company timeline', () => {
  it('merges commits, build steps, actions and integration changes, newest first, without reads', async () => {
    await CapabilityInvocation.collection.insertMany([
      { organizationId: org, companyId, capabilityId: 'email.campaign.send', kind: 'write', status: 'succeeded', summary: 'Sent to 1,204 subscribers', createdAt: new Date('2026-09-26T09:00:00Z') },
      { organizationId: org, companyId, capabilityId: 'analytics.traffic.read', kind: 'read', status: 'succeeded', createdAt: new Date('2026-09-28T09:00:00Z') },
    ]);
    await BuildRequest.collection.insertOne({
      organizationId: org,
      companyId,
      projectId: new Types.ObjectId(),
      title: 'Hide OpenHV under OpenRA',
      status: 'pr_opened',
      pullRequest: { url: 'https://github.com/RyShoe8/playbound/pull/9' },
      events: [
        { at: new Date('2026-09-27T13:00:00Z'), action: 'approved' },
        { at: new Date('2026-09-27T14:00:00Z'), action: 'pr_opened' },
      ],
      updatedAt: new Date('2026-09-27T14:00:00Z'),
    });
    await recordActivity({ organizationId: org, companyId, kind: 'integration', title: 'Stripe removed', actorUserId: admin.userId });
    await ActivityEvent.updateOne({}, { $set: { at: new Date('2026-09-25T08:00:00Z') } });

    const items = await companyTimeline(admin, String(companyId));
    expect(items?.map((i) => `${i.kind}: ${i.title}`)).toEqual([
      'build: Build "Hide OpenHV under OpenRA": pull request opened',
      'build: Build "Hide OpenHV under OpenRA": approved for building',
      'code: Remove OpenHV edition from OpenRA (a1b2c3d)',
      'action: email.campaign.send: succeeded',
      'integration: Stripe removed',
    ]);
    expect(items?.[0].detail).toBe('https://github.com/RyShoe8/playbound/pull/9');
    expect(items?.[2]).toMatchObject({ by: 'Ryan', detail: '1 file: src/games/openra.ts' });
    expect(renderTimeline(items!.slice(2, 3))).toBe('- 2026-09-27 12:00 [code] Remove OpenHV edition from OpenRA (a1b2c3d) — Ryan (1 file: src/games/openra.ts)');
  });

  it('respects the limit and returns null for companies the viewer cannot see', async () => {
    for (let i = 0; i < 5; i += 1) await recordActivity({ organizationId: org, companyId, kind: 'company', title: `Change ${i}` });
    expect(await companyTimeline(admin, String(companyId), { limit: 3, includeCode: false })).toHaveLength(3);
    expect(await companyTimeline({ ...admin, organizationId: new Types.ObjectId() }, String(companyId))).toBeNull();
  });
});
