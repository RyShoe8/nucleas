import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));

import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import { createCompany } from './createCompany';
import { resolveCompanyProfile } from './companyProfile';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const user = new Types.ObjectId();
const manager = { userId: String(user), organizationId: org, employeeId: null, role: 'Manager' as const };

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_create_company_test'));
  await Client.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  await Promise.all([Client.deleteMany({}), Project.deleteMany({})]);
});

describe('createCompany', () => {
  it('adds an owned company with a hub project that carries its name and website', async () => {
    const result = await createCompany(manager, { name: '  PlayBound  ', domain: 'https://www.PlayBound.club/', relationship: 'owned' });
    expect(result).toMatchObject({ ok: true, name: 'PlayBound' });
    const company = await Client.findById((result as { id: string }).id).lean();
    expect(company).toMatchObject({ name: 'PlayBound', domain: 'playbound.club', relationship: 'owned' });
    const hub = await Project.findById(company!.hubProjectId).lean();
    expect(hub).toMatchObject({ name: 'PlayBound', projectType: 'internal', url: 'https://playbound.club', liveUrl: 'https://playbound.club' });
    expect(String(hub!.clientId)).toBe(String(company!._id));
    const profile = resolveCompanyProfile(company as never, hub as never);
    expect(profile).toMatchObject({ name: 'PlayBound', relationship: 'owned', profileSource: 'hub_project' });
  });

  it('adds a client with the client-admin project the Clients page makes', async () => {
    const result = await createCompany(manager, { name: 'Acme Plumbing', relationship: 'client' });
    const id = (result as { id: string }).id;
    expect(await Client.findById(id).lean()).toMatchObject({ name: 'Acme Plumbing', relationship: 'client' });
    expect(await Project.findOne({ clientId: id }).lean()).toMatchObject({ projectType: 'client-admin', name: 'Acme Plumbing' });
  });

  it('refuses non-managers, bad input, and duplicate names or websites', async () => {
    expect(await createCompany({ ...manager, role: 'User' }, { name: 'Nope', relationship: 'owned' })).toMatchObject({ ok: false, status: 403 });
    expect(await createCompany(manager, { name: 'A', relationship: 'owned' })).toMatchObject({ ok: false, status: 400 });
    expect(await createCompany(manager, { name: 'Valid Name', relationship: 'owner' })).toMatchObject({ ok: false, status: 400 });
    expect(await createCompany(manager, { name: 'Valid Name', domain: 'not a domain', relationship: 'owned' })).toMatchObject({ ok: false, status: 400 });
    expect(await Client.countDocuments()).toBe(0);

    await createCompany(manager, { name: 'PlayBound', domain: 'playbound.club', relationship: 'owned' });
    expect(await createCompany(manager, { name: 'playbound', relationship: 'client' })).toMatchObject({ ok: false, status: 409 });
    expect(await createCompany(manager, { name: 'Other Name', domain: 'https://playbound.club', relationship: 'client' })).toMatchObject({ ok: false, status: 409 });
    expect(await Client.countDocuments()).toBe(1);
    // A different organization may use the same name.
    expect(await createCompany({ ...manager, organizationId: new Types.ObjectId() }, { name: 'PlayBound', relationship: 'owned' })).toMatchObject({ ok: true });
  });
});
