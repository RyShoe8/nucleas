import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { z } from 'zod';
import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import { ExternalResource, IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { CapabilityApproval, CapabilityInvocation } from '@/lib/models/Capability';
import { sealSecret } from '@/lib/security/secretBox';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { decideApproval, invokeCapability, listInvocations } from './runtime';
import { CAPABILITIES } from './registry';
import type { CapabilityDefinition } from './types';

let replica: MongoMemoryReplSet;
const orgId = new Types.ObjectId();
const admin: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: orgId, employeeId: null, role: 'Administrator' };
const member: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: orgId, employeeId: String(new Types.ObjectId()), role: 'User' };
let companyId: string;

beforeAll(async () => {
  vi.stubEnv('NUCLEAS_SECRETS_KEY', 'capability-test-key');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csecret');
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_capabilities_test'));
  await Promise.all([IntegrationConnection.syncIndexes(), ExternalResource.syncIndexes(), CapabilityApproval.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose.disconnect();
  await replica?.stop();
});

async function connect(provider: string, credential: string, opts: { org?: boolean; planLimited?: boolean; secretProvider?: string } = {}) {
  const secretProvider = opts.secretProvider ?? provider;
  const secret = await IntegrationSecret.create({ organizationId: orgId, provider: secretProvider, sealed: sealSecret(`integration:${secretProvider}`, credential), hint: '…' });
  return IntegrationConnection.create({
    organizationId: orgId,
    companyId: opts.org ? null : new Types.ObjectId(companyId),
    provider,
    scope: opts.org ? 'org' : 'company',
    status: 'connected',
    source: 'manual',
    secretId: secret._id,
    planLimited: Boolean(opts.planLimited),
  });
}

async function pin(provider: string, resourceType: string, externalId: string) {
  await ExternalResource.create({ organizationId: orgId, companyId: new Types.ObjectId(companyId), provider, resourceType, externalId, canonicalType: 'Company', canonicalId: new Types.ObjectId(companyId) });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(async () => {
  await Promise.all([
    Client.deleteMany({}),
    Project.deleteMany({}),
    IntegrationConnection.deleteMany({}),
    IntegrationSecret.deleteMany({}),
    ExternalResource.deleteMany({}),
    CapabilityInvocation.deleteMany({}),
    CapabilityApproval.deleteMany({}),
  ]);
  const hub = await Project.create({ name: 'PlayBound', projectType: 'internal', category: 'website', status: 'launched', color: '#111', userId: new Types.ObjectId() });
  const company = await Client.create({ organizationId: orgId, name: 'PlayBound', color: '#111', relationship: 'owned', domain: 'playbound.club', hubProjectId: hub._id });
  companyId = String(company._id);
});

describe('setup states', () => {
  it('reports needs_setup when the integration is only declared', async () => {
    await IntegrationConnection.create({ organizationId: orgId, companyId: new Types.ObjectId(companyId), provider: 'ga4', scope: 'company', status: 'declared', source: 'baseline' });
    const f = vi.fn();
    const res = await invokeCapability(admin, companyId, 'analytics.traffic.read', { days: 7 }, { fetchImpl: f });
    expect(res).toMatchObject({ ok: true, invocation: { status: 'needs_setup' } });
    expect(f).not.toHaveBeenCalled();
  });

  it('never queries without a pinned resource, even when the credential works', async () => {
    await connect('ga4', 'refresh-token', { secretProvider: 'google' });
    const f = vi.fn();
    const res = await invokeCapability(admin, companyId, 'analytics.traffic.read', { days: 7 }, { fetchImpl: f });
    expect(res).toMatchObject({ ok: true, invocation: { status: 'needs_setup', error: expect.stringContaining('pinned') } });
    expect(f).not.toHaveBeenCalled();
  });

  it('skips plan-limited providers without calling them', async () => {
    await connect('ahrefs', 'ahrefs-key', { org: true, planLimited: true });
    const f = vi.fn();
    const res = await invokeCapability(admin, companyId, 'seo.overview.read', {}, { fetchImpl: f });
    expect(res).toMatchObject({ ok: true, invocation: { status: 'plan_limited' } });
    expect(f).not.toHaveBeenCalled();
  });

  it('rejects invalid input and unknown capabilities', async () => {
    expect(await invokeCapability(admin, companyId, 'analytics.traffic.read', { days: 9999 })).toMatchObject({ ok: false, status: 400 });
    expect(await invokeCapability(admin, companyId, 'nope.read', {})).toMatchObject({ ok: false, status: 404 });
  });
});

describe('reading Google Analytics', () => {
  function fakeGa4(tokenError = false) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('oauth2.googleapis.com/token')) return tokenError ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'at' });
      if (url.includes('properties/547684058:runReport')) {
        const body = JSON.parse(String(init?.body));
        if (body.dimensions[0].name === 'date') {
          return json({
            rows: [
              { dimensionValues: [{ value: '20260901' }], metricValues: [{ value: '10' }, { value: '8' }, { value: '5' }, { value: '30' }] },
              { dimensionValues: [{ value: '20260902' }], metricValues: [{ value: '20' }, { value: '15' }, { value: '9' }, { value: '44' }] },
            ],
          });
        }
        return json({ rows: [{ dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '18' }] }] });
      }
      return json({}, 404);
    });
  }

  it('queries only the pinned property and records a receipt, then reuses it from cache', async () => {
    await connect('ga4', 'refresh-token', { secretProvider: 'google' });
    await pin('ga4', 'property', '547684058');
    const f = fakeGa4();
    const first = await invokeCapability(admin, companyId, 'analytics.traffic.read', { days: 7 }, { fetchImpl: f });
    expect(first).toMatchObject({
      ok: true,
      invocation: { status: 'succeeded', output: { propertyId: '547684058', totals: { sessions: 30, pageViews: 74 }, topChannels: [{ channel: 'Organic Search', sessions: 18 }] } },
    });
    const calledUrls = f.mock.calls.map((c) => c[0] as string);
    expect(calledUrls.filter((u) => u.includes('runReport')).every((u) => u.includes('547684058'))).toBe(true);

    const second = await invokeCapability(admin, companyId, 'analytics.traffic.read', { days: 7 }, { fetchImpl: f });
    expect(second).toMatchObject({ ok: true, invocation: { cached: true } });
    expect(f).toHaveBeenCalledTimes(calledUrls.length);
    expect(await CapabilityInvocation.countDocuments()).toBe(1);
  });

  it('marks the connection for re-sign-in when Google revokes access', async () => {
    const conn = await connect('ga4', 'refresh-token', { secretProvider: 'google' });
    await pin('ga4', 'property', '547684058');
    const res = await invokeCapability(admin, companyId, 'analytics.traffic.read', { days: 7 }, { fetchImpl: fakeGa4(true) });
    expect(res).toMatchObject({ ok: true, invocation: { status: 'needs_reauth' } });
    expect((await IntegrationConnection.findById(conn._id).lean())?.status).toBe('needs_reauth');
  });
});

describe('Ahrefs project setup (write)', () => {
  function fakeAhrefs(state: { projects: { project_id: string; project_name: string; url: string; mode: string }[] }) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/management/projects') && (init?.method ?? 'GET') === 'GET') return json({ projects: state.projects });
      if (url.endsWith('/management/projects') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        const p = { project_id: '777', project_name: body.project_name, url: body.url, mode: body.mode };
        state.projects.push(p);
        return json({ projects: [p] });
      }
      return json({}, 404);
    });
  }

  it('creates once, verifies by read-back and pins the project; re-running is a no-op', async () => {
    await connect('ahrefs', 'ahrefs-key', { org: true });
    const state = { projects: [] as { project_id: string; project_name: string; url: string; mode: string }[] };
    const f = fakeAhrefs(state);

    const first = await invokeCapability(admin, companyId, 'seo.project.create', {}, { fetchImpl: f });
    expect(first).toMatchObject({ ok: true, invocation: { status: 'verified', output: { projectId: '777', created: true }, resource: { externalId: '777' } } });
    expect(f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);

    const second = await invokeCapability(admin, companyId, 'seo.project.create', {}, { fetchImpl: f });
    expect(second).toMatchObject({ ok: true, invocation: { status: 'verified', output: { created: false } } });
    expect(f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
    expect(await ExternalResource.countDocuments({ provider: 'ahrefs', externalId: '777' })).toBe(1);
  });

  it('is manager-only', async () => {
    expect(await invokeCapability(member, companyId, 'seo.project.create', {})).toMatchObject({ ok: false });
  });
});

describe('approvals', () => {
  const run = vi.fn(async () => ({ output: { done: true }, summary: 'Did the thing' }));
  const guarded: CapabilityDefinition<{ amount: number }, { done: boolean }> = {
    id: 'test.guarded.write',
    version: 1,
    title: 'Guarded write',
    domain: 'test',
    kind: 'write',
    risk: 'spend',
    approval: 'required',
    provider: 'brevo',
    input: z.object({ amount: z.number() }).strict(),
    run,
  };
  const registry = [...CAPABILITIES, guarded] as CapabilityDefinition[];

  beforeEach(async () => {
    run.mockClear();
    await connect('brevo', 'xkeysib-test');
  });

  it('waits for approval, runs exactly once when approved, and cannot be approved twice', async () => {
    const res = await invokeCapability(admin, companyId, 'test.guarded.write', { amount: 49 }, { registry });
    expect(res).toMatchObject({ ok: true, invocation: { status: 'pending_approval' } });
    expect(run).not.toHaveBeenCalled();
    const approvalId = res.ok ? res.invocation.approvalId! : '';

    expect(await decideApproval(member, approvalId, 'approve', { registry })).toMatchObject({ ok: false, status: 403 });
    const approved = await decideApproval(admin, approvalId, 'approve', { registry });
    expect(approved).toMatchObject({ ok: true, invocation: { status: 'succeeded', summary: 'Did the thing' } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]).toEqual([expect.anything(), { amount: 49 }]);

    expect(await decideApproval(admin, approvalId, 'approve', { registry })).toMatchObject({ ok: false, status: 409 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('denial never runs the action', async () => {
    const res = await invokeCapability(admin, companyId, 'test.guarded.write', { amount: 5 }, { registry });
    const denied = await decideApproval(admin, res.ok ? res.invocation.approvalId! : '', 'deny', { registry });
    expect(denied).toMatchObject({ ok: true, invocation: { status: 'denied' } });
    expect(run).not.toHaveBeenCalled();
  });

  it('expired approvals cancel the action', async () => {
    const res = await invokeCapability(admin, companyId, 'test.guarded.write', { amount: 5 }, { registry });
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    expect(await decideApproval(admin, res.ok ? res.invocation.approvalId! : '', 'approve', { registry, now: later })).toMatchObject({ ok: false, status: 409 });
    expect(run).not.toHaveBeenCalled();
    expect((await CapabilityInvocation.findOne().lean())?.status).toBe('cancelled');
  });

  it('activity lists writes and problems but hides routine reads by default', async () => {
    await invokeCapability(admin, companyId, 'test.guarded.write', { amount: 1 }, { registry });
    await CapabilityInvocation.create({
      organizationId: orgId, companyId: new Types.ObjectId(companyId), capabilityId: 'analytics.traffic.read', capabilityVersion: 1,
      kind: 'read', risk: 'read', provider: 'ga4', status: 'succeeded', inputDigest: 'x', finishedAt: new Date(),
    });
    const activity = await listInvocations(admin, companyId, { registry });
    expect(activity!.map((a) => a.capabilityId)).toEqual(['test.guarded.write']);
    expect((await listInvocations(admin, companyId, { registry, includeReads: true }))!).toHaveLength(2);
  });
});
