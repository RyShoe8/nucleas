import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));

import Client from '@/lib/models/Client';
import { IntegrationConnection } from '@/lib/models/Integration';
import { listCompanyProfiles, getCompanyProfile, type CompanyViewer } from './companyProfile';
import { archivedCompanyIds, setCompanyArchived } from './archive';
import { processMetricSync } from '@/lib/metrics/sync';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const admin: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: org, employeeId: null, role: 'Administrator' };
const manager: CompanyViewer = { ...admin, userId: String(new Types.ObjectId()), role: 'Manager' };
let kept: string;
let gone: string;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_archive_test'));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  await Promise.all([Client.deleteMany({}), IntegrationConnection.deleteMany({})]);
  kept = String((await Client.create({ organizationId: org, name: 'Frugal Gambler', color: '#111', relationship: 'owned' }))._id);
  gone = String((await Client.create({ organizationId: org, name: 'Old Client', color: '#222', relationship: 'client' }))._id);
});

describe('archiving a company', () => {
  it('hides it everywhere, keeps the record, and restores it exactly', async () => {
    expect(await setCompanyArchived(manager, gone, true)).toMatchObject({ ok: false, status: 403 });
    expect(await setCompanyArchived(admin, gone, true)).toEqual({ ok: true, name: 'Old Client' });
    expect(await setCompanyArchived(admin, gone, true)).toMatchObject({ ok: false, status: 409 });

    expect((await listCompanyProfiles(admin)).map((c) => c.name)).toEqual(['Frugal Gambler']);
    expect(await getCompanyProfile(admin, gone)).toBeNull();
    expect((await listCompanyProfiles(admin, { archived: true })).map((c) => c.name)).toEqual(['Old Client']);
    expect(await Client.countDocuments()).toBe(2);
    expect((await archivedCompanyIds()).map(String)).toEqual([gone]);

    expect(await setCompanyArchived(admin, gone, false)).toEqual({ ok: true, name: 'Old Client' });
    expect((await listCompanyProfiles(admin)).map((c) => c.name)).toEqual(['Frugal Gambler', 'Old Client']);
    expect(await Client.findById(gone).lean()).not.toHaveProperty('archivedAt');
  });

  it('stops metric syncs for it', async () => {
    await IntegrationConnection.create({ organizationId: org, companyId: new Types.ObjectId(gone), provider: 'ga4', scope: 'company', status: 'connected', source: 'manual' });
    await setCompanyArchived(admin, gone, true);
    expect(await processMetricSync({ fetchImpl: vi.fn() })).toEqual({ synced: 0, skipped: 0, failed: 0 });
  });
});
