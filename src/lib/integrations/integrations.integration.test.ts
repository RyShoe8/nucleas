import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import { IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { getCompanyProfile, listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import { applyDeclaredConnections, planDeclaredConnections } from './declareConnections';
import { connectWithApiKey, listCompanyConnections, readConnectionCredential } from './connections';

let replica: MongoMemoryReplSet;
const orgId = new Types.ObjectId();
const teamEmployee = new Types.ObjectId();

const admin: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: orgId, employeeId: null, role: 'Administrator' };
const member: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: orgId, employeeId: String(teamEmployee), role: 'User' };
const outsider: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: orgId, employeeId: String(new Types.ObjectId()), role: 'User' };

beforeAll(async () => {
  vi.stubEnv('NUCLEAS_SECRETS_KEY', 'integration-test-master-key');
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_integrations_test'));
  await Promise.all([Client.syncIndexes(), IntegrationConnection.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose.disconnect();
  await replica?.stop();
});

let ownedId: string;
let clientId: string;

beforeEach(async () => {
  await Promise.all([Client.deleteMany({}), Project.deleteMany({}), IntegrationConnection.deleteMany({}), IntegrationSecret.deleteMany({})]);
  const hub = await Project.create({
    name: 'PlayBound',
    projectType: 'internal',
    category: 'website',
    status: 'launched',
    color: '#111111',
    userId: new Types.ObjectId(),
    devUrl: 'https://playbound.vercel.app',
    marketingStack: [{ category: 'analytics', toolId: 'posthog' }, { category: 'social', toolId: 'buffer' }],
    assignedToEmployeeIds: [teamEmployee],
  });
  const owned = await Client.create({
    organizationId: orgId,
    name: 'Stale copied name',
    color: '#999999',
    relationship: 'owned',
    domain: 'playbound.club',
    hubProjectId: hub._id,
    devUrl: 'https://stale.example',
  });
  await Project.updateOne({ _id: hub._id }, { $set: { clientId: owned._id } });
  const client = await Client.create({ organizationId: orgId, name: 'Senior By Design', color: '#222222' });
  const otherOrg = await Client.create({ organizationId: new Types.ObjectId(), name: 'Other tenant', color: '#333333' });
  ownedId = String(owned._id);
  clientId = String(client._id);
  void otherOrg;
});

describe('company profiles', () => {
  it('reads owned company profile fields from the hub project, not the copied client fields', async () => {
    const profile = await getCompanyProfile(admin, ownedId);
    expect(profile).toMatchObject({
      name: 'PlayBound',
      color: '#111111',
      devUrl: 'https://playbound.vercel.app',
      domain: 'playbound.club',
      relationship: 'owned',
      profileSource: 'hub_project',
    });
  });

  it('keeps the org boundary and team visibility', async () => {
    expect((await listCompanyProfiles(admin)).map((c) => c.name)).toEqual(['PlayBound', 'Senior By Design']);
    expect((await listCompanyProfiles(member)).map((c) => c.name)).toEqual(['PlayBound']);
    expect(await listCompanyProfiles(outsider)).toEqual([]);
    expect(await getCompanyProfile(outsider, ownedId)).toBeNull();
  });
});

describe('declared connections', () => {
  it('declares the owned baseline plus mapped stack tools and the org Ahrefs account', async () => {
    const plan = await planDeclaredConnections(orgId);
    const owned = plan.items.filter((i) => i.companyId === ownedId).map((i) => i.provider).sort();
    expect(owned).toEqual(['brevo', 'ga4', 'gsc', 'posthog', 'stripe']);
    expect(plan.items.filter((i) => i.companyId === clientId)).toEqual([]);
    expect(plan.items.find((i) => i.provider === 'ahrefs')).toMatchObject({ companyId: null, scope: 'org' });
    expect(plan.unmappedTools.PlayBound).toEqual(['buffer']);
  });

  it('is idempotent and never overwrites a connected integration', async () => {
    const first = await applyDeclaredConnections(orgId);
    expect(first.created).toBe(6);
    await IntegrationConnection.updateOne({ companyId: new Types.ObjectId(ownedId), provider: 'brevo' }, { $set: { status: 'connected' } });
    const second = await applyDeclaredConnections(orgId);
    expect(second).toMatchObject({ created: 0, existing: 6 });
    expect((await IntegrationConnection.findOne({ provider: 'brevo' }).lean())?.status).toBe('connected');
  });
});

describe('connecting with an API key', () => {
  async function brevoConnectionId() {
    await applyDeclaredConnections(orgId);
    const row = await IntegrationConnection.findOne({ companyId: new Types.ObjectId(ownedId), provider: 'brevo' }).lean();
    return String(row!._id);
  }

  it('only managers can connect', async () => {
    const id = await brevoConnectionId();
    const res = await connectWithApiKey(member, id, 'xkeysib-secret-value', async () => ({ ok: true }));
    expect(res).toMatchObject({ ok: false, status: 403 });
  });

  it('stores nothing when verification fails', async () => {
    const id = await brevoConnectionId();
    const res = await connectWithApiKey(admin, id, 'xkeysib-bad', async () => ({ ok: false, reason: 'invalid_credential', message: 'nope' }));
    expect(res).toMatchObject({ ok: false, status: 422 });
    expect(await IntegrationSecret.countDocuments()).toBe(0);
    expect((await IntegrationConnection.findById(id).lean())?.status).toBe('declared');
  });

  it('encrypts the credential, returns a safe view and lets executors read it back', async () => {
    const id = await brevoConnectionId();
    const res = await connectWithApiKey(admin, id, 'xkeysib-secret-value-9876', async () => ({ ok: true, accountLabel: 'PlayBound', planLabel: 'free' }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.connection).toMatchObject({ status: 'connected', credentialHint: '…9876', accountLabel: 'PlayBound' });
    expect(JSON.stringify(res.connection)).not.toContain('secret-value');

    const raw = await IntegrationSecret.findOne().select('+sealed').lean();
    expect(raw?.sealed).toMatch(/^v1\./);
    expect(raw?.sealed).not.toContain('secret-value');
    expect(JSON.stringify(await IntegrationSecret.findOne().lean())).not.toContain('v1.');

    expect(await readConnectionCredential(orgId, new Types.ObjectId(id))).toBe('xkeysib-secret-value-9876');
    expect(await readConnectionCredential(new Types.ObjectId(), new Types.ObjectId(id))).toBeNull();
  });

  it('rotates in place on reconnect and stores plan-limited state', async () => {
    await applyDeclaredConnections(orgId);
    const ahrefs = await IntegrationConnection.findOne({ provider: 'ahrefs' }).lean();
    const id = String(ahrefs!._id);
    await connectWithApiKey(admin, id, 'ahrefs-key-one-1111', async () => ({ ok: true, planLimited: true, planLabel: 'No API access on current plan' }));
    await connectWithApiKey(admin, id, 'ahrefs-key-two-2222', async () => ({ ok: true, planLabel: 'Standard' }));
    expect(await IntegrationSecret.countDocuments()).toBe(1);
    const view = (await listCompanyConnections(admin, ownedId))!.find((c) => c.provider === 'ahrefs');
    expect(view).toMatchObject({ scope: 'org', credentialHint: '…2222', planLimited: false, planLabel: 'Standard' });
  });

  it('hides connections of companies the viewer cannot see', async () => {
    expect(await listCompanyConnections(outsider, ownedId)).toBeNull();
  });
});
