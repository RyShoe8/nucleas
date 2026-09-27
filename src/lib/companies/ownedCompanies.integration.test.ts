import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import User from '@/lib/models/User';
import {
  applyOwnedCompanyConversion,
  domainFromProject,
  planOwnedCompanyConversion,
} from './ownedCompanies';

let replica: MongoMemoryReplSet;
const orgId = new Types.ObjectId();

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_owned_companies_test'));
  await Client.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  await Promise.all([Client.deleteMany({}), Project.deleteMany({}), User.collection.deleteMany({})]);
});

async function seedProperty(overrides: Record<string, unknown> = {}) {
  const userId = new Types.ObjectId();
  await User.collection.insertOne({ _id: userId, email: `${userId}@example.com`, name: 'Owner', organizationId: orgId });
  const taskId = new Types.ObjectId();
  const project = await Project.create({
    name: 'Frugal Gambler',
    projectType: 'internal',
    category: 'generic',
    status: 'launched',
    color: '#123456',
    userId,
    liveUrl: 'https://www.frugalgambler.club/',
    marketingStack: [{ category: 'email', toolId: 'brevo' }],
    techStack: [{ category: 'hosting', technologyId: 'cloudflare' }],
    tasks: [{ _id: taskId, name: 'Existing task', status: 'active' }],
    ...overrides,
  });
  return { project, taskId };
}

describe('domainFromProject', () => {
  it('normalizes hosts from liveUrl, url or urls', () => {
    expect(domainFromProject({ liveUrl: 'https://www.tailnote.io/app' })).toBe('tailnote.io');
    expect(domainFromProject({ url: 'nucleas.app' })).toBe('nucleas.app');
    expect(domainFromProject({ urls: ['', 'https://playbound.club'] })).toBe('playbound.club');
    expect(domainFromProject({})).toBeUndefined();
  });
});

describe('owned company conversion', () => {
  it('dry run writes nothing', async () => {
    const { project } = await seedProperty();
    const plan = await planOwnedCompanyConversion([String(project._id)]);
    expect(plan[0].action).toBe('create_company_and_attach');
    expect(plan[0].domain).toBe('frugalgambler.club');
    expect(await Client.countDocuments()).toBe(0);
    expect((await Project.findById(project._id).lean())?.clientId).toBeUndefined();
  });

  it('creates an owned company, attaches the project and preserves its data', async () => {
    const { project, taskId } = await seedProperty();
    const result = await applyOwnedCompanyConversion([String(project._id)]);
    expect(result).toMatchObject({ created: 1, attached: 1 });

    const company = await Client.findOne({ hubProjectId: project._id }).lean();
    expect(company).toMatchObject({ name: 'Frugal Gambler', relationship: 'owned', domain: 'frugalgambler.club', color: '#123456' });
    expect(String(company?.organizationId)).toBe(String(orgId));
    expect(company?.marketingStack?.map((m) => m.toolId)).toEqual(['brevo']);

    const after = await Project.findById(project._id).lean();
    expect(String(after?.clientId)).toBe(String(company?._id));
    expect(after?.projectType).toBe('internal');
    expect(after?.tasks?.map((t) => String(t._id))).toEqual([String(taskId)]);
  });

  it('is idempotent when re-run', async () => {
    const { project } = await seedProperty();
    await applyOwnedCompanyConversion([String(project._id)]);
    const second = await applyOwnedCompanyConversion([String(project._id)]);
    expect(second).toMatchObject({ created: 0, attached: 0, unchanged: 1 });
    expect(await Client.countDocuments()).toBe(1);
  });

  it('never re-parents a project that already belongs to a client', async () => {
    const otherClient = new Types.ObjectId();
    const { project } = await seedProperty({ clientId: otherClient });
    const result = await applyOwnedCompanyConversion([String(project._id)]);
    expect(result.items[0].action).toBe('skip_has_other_client');
    expect(await Client.countDocuments()).toBe(0);
    expect(String((await Project.findById(project._id).lean())?.clientId)).toBe(String(otherClient));
  });

  it('applies relationship and domain overrides', async () => {
    const { project } = await seedProperty({ name: 'Playbound.club', liveUrl: undefined });
    const id = String(project._id);
    await applyOwnedCompanyConversion([id], { relationships: { [id]: 'internal' }, domains: { [id]: 'https://playbound.club' } });
    const company = await Client.findOne({ hubProjectId: project._id }).lean();
    expect(company).toMatchObject({ relationship: 'internal', domain: 'playbound.club' });
  });

  it('flags non-internal project types without changing them', async () => {
    const { project } = await seedProperty({ name: 'Playbound.club', projectType: 'client', liveUrl: undefined });
    const plan = await planOwnedCompanyConversion([String(project._id)]);
    expect(plan[0].notes.join(' ')).toContain("projectType is 'client'");
    expect(plan[0].notes.join(' ')).toContain('No URL');
  });
});
