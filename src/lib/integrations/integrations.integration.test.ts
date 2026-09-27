import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import { ExternalResource, IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
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
  await Promise.all([Client.deleteMany({}), Project.deleteMany({}), IntegrationConnection.deleteMany({}), IntegrationSecret.deleteMany({}), ExternalResource.deleteMany({})]);
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

describe('Google sign-in', () => {
  function fakeGoogle(opts: { scope?: string; refresh?: boolean } = {}) {
    return vi.fn(async (url: string) => {
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return json({
          access_token: 'access-token',
          ...(opts.refresh === false ? {} : { refresh_token: 'google-refresh-token-abcd' }),
          scope:
            opts.scope ??
            'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly email',
        });
      }
      if (url.includes('openidconnect')) return json({ email: 'ryan@example.com' });
      if (url.includes('accountSummaries')) {
        return json({ accountSummaries: [{ propertySummaries: [{ property: 'properties/111', displayName: 'PlayBound GA4' }] }] });
      }
      if (url.includes('/properties/111/dataStreams')) return json({ dataStreams: [{ webStreamData: { defaultUri: 'https://www.playbound.club' } }] });
      if (url.includes('webmasters/v3/sites')) return json({ siteEntry: [{ siteUrl: 'sc-domain:playbound.club', permissionLevel: 'siteOwner' }] });
      return json({}, 404);
    });
  }

  beforeEach(() => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csecret');
  });

  it('connects GA4 and Search Console for every company whose domain matches', async () => {
    await applyDeclaredConnections(orgId);
    const { completeGoogleConnection } = await import('./google/connectGoogle');
    const result = await completeGoogleConnection(admin, { code: 'code', redirectUri: 'https://os.nucleas.app/cb' }, fakeGoogle());
    expect(result).toMatchObject({
      ok: true,
      summary: { accountEmail: 'ryan@example.com', analytics: { connected: ['PlayBound'] }, searchConsole: { connected: ['PlayBound'] } },
    });

    const views = (await listCompanyConnections(admin, ownedId))!;
    expect(views.find((v) => v.provider === 'ga4')).toMatchObject({ status: 'connected', accountLabel: 'PlayBound GA4', credentialHint: 'ryan@example.com' });
    expect(views.find((v) => v.provider === 'gsc')).toMatchObject({ status: 'connected', accountLabel: 'sc-domain:playbound.club' });

    const { ExternalResource } = await import('@/lib/models/Integration');
    expect(await ExternalResource.find({ companyId: new Types.ObjectId(ownedId) }).select('provider externalId -_id').lean()).toEqual(
      expect.arrayContaining([
        { provider: 'ga4', externalId: '111' },
        { provider: 'gsc', externalId: 'sc-domain:playbound.club' },
      ])
    );

    // One secret for the Google account, readable for both connections.
    expect(await IntegrationSecret.countDocuments({ provider: 'google' })).toBe(1);
    const ga4 = views.find((v) => v.provider === 'ga4')!;
    expect(await readConnectionCredential(orgId, new Types.ObjectId(ga4.id))).toBe('google-refresh-token-abcd');
  });

  it('re-signing in with the same account rotates the secret instead of duplicating it', async () => {
    await applyDeclaredConnections(orgId);
    const { completeGoogleConnection } = await import('./google/connectGoogle');
    await completeGoogleConnection(admin, { code: 'a', redirectUri: 'https://os.nucleas.app/cb' }, fakeGoogle());
    await completeGoogleConnection(admin, { code: 'b', redirectUri: 'https://os.nucleas.app/cb' }, fakeGoogle());
    expect(await IntegrationSecret.countDocuments({ provider: 'google' })).toBe(1);
  });

  it('honours partially granted scopes and refuses missing offline access', async () => {
    await applyDeclaredConnections(orgId);
    const { completeGoogleConnection } = await import('./google/connectGoogle');
    const partial = await completeGoogleConnection(
      admin,
      { code: 'c', redirectUri: 'https://os.nucleas.app/cb' },
      fakeGoogle({ scope: 'https://www.googleapis.com/auth/webmasters.readonly' })
    );
    expect(partial).toMatchObject({ ok: true, summary: { analytics: { granted: false, connected: [] }, searchConsole: { connected: ['PlayBound'] } } });

    const noRefresh = await completeGoogleConnection(admin, { code: 'd', redirectUri: 'https://os.nucleas.app/cb' }, fakeGoogle({ refresh: false }));
    expect(noRefresh).toMatchObject({ ok: false });
  });

  it('is manager-only', async () => {
    const { completeGoogleConnection } = await import('./google/connectGoogle');
    const f = fakeGoogle();
    expect(await completeGoogleConnection(member, { code: 'x', redirectUri: 'https://os.nucleas.app/cb' }, f)).toMatchObject({ ok: false });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('adding and removing integrations', () => {
  it('removing hides the integration, clears its credential and survives the backfill', async () => {
    await applyDeclaredConnections(orgId);
    const stripe = await IntegrationConnection.findOne({ companyId: new Types.ObjectId(ownedId), provider: 'stripe' }).lean();
    await connectWithApiKey(admin, String(stripe!._id), 'rk_live_remove_me_1234', async () => ({ ok: true }));
    expect(await IntegrationSecret.countDocuments()).toBe(1);

    const { removeConnection, listAddableProviders } = await import('./connections');
    expect(await removeConnection(member, String(stripe!._id))).toMatchObject({ ok: false, status: 403 });
    expect(await removeConnection(admin, String(stripe!._id))).toEqual({ ok: true });

    expect((await listCompanyConnections(admin, ownedId))!.map((c) => c.provider)).not.toContain('stripe');
    expect(await IntegrationSecret.countDocuments()).toBe(0);
    expect((await listAddableProviders(admin, ownedId))!.map((p) => p.id)).toContain('stripe');

    await applyDeclaredConnections(orgId);
    expect((await IntegrationConnection.findById(stripe!._id).lean())?.status).toBe('disabled');
  });

  it('keeps a shared Google credential when other connections still use it', async () => {
    await applyDeclaredConnections(orgId);
    const secret = await IntegrationSecret.create({ organizationId: orgId, provider: 'google', sealed: 'v1.x', hint: 'a@b.c' });
    await IntegrationConnection.updateMany({ companyId: new Types.ObjectId(ownedId), provider: { $in: ['ga4', 'gsc'] } }, { $set: { status: 'connected', secretId: secret._id } });
    const ga4 = await IntegrationConnection.findOne({ companyId: new Types.ObjectId(ownedId), provider: 'ga4' }).lean();

    const { removeConnection } = await import('./connections');
    await removeConnection(admin, String(ga4!._id));
    expect(await IntegrationSecret.countDocuments()).toBe(1);
  });

  it('adds new providers and re-enables removed ones', async () => {
    await applyDeclaredConnections(orgId);
    const { addConnection, removeConnection } = await import('./connections');
    expect(await addConnection(admin, ownedId, 'shopify')).toEqual({ ok: true });
    expect(await addConnection(admin, ownedId, 'nope')).toMatchObject({ ok: false, status: 400 });
    expect(await addConnection(member, ownedId, 'shopify')).toMatchObject({ ok: false, status: 403 });

    const stripe = await IntegrationConnection.findOne({ companyId: new Types.ObjectId(ownedId), provider: 'stripe' }).lean();
    await removeConnection(admin, String(stripe!._id));
    await addConnection(admin, ownedId, 'stripe');
    const providers = (await listCompanyConnections(admin, ownedId))!.map((c) => c.provider);
    expect(providers).toEqual(expect.arrayContaining(['shopify', 'stripe']));
    expect(await IntegrationConnection.countDocuments({ companyId: new Types.ObjectId(ownedId), provider: 'stripe' })).toBe(1);
  });
});
