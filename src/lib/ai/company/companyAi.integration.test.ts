import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import { IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { CapabilityInvocation } from '@/lib/models/Capability';
import { MetricSnapshot } from '@/lib/models/Metric';
import { sealSecret } from '@/lib/security/secretBox';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { renderContext, resolveCompanyContext } from '@/lib/context/resolveCompanyContext';
import { buildCompanyTools, toolNameFor } from './companyTools';
import { buildSystemPrompt } from './companyAssistant';

vi.mock('server-only', () => ({}));

let replica: MongoMemoryReplSet;
const orgId = new Types.ObjectId();
const admin: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: orgId, employeeId: null, role: 'Administrator' };
const member: CompanyViewer = { ...admin, role: 'User', employeeId: String(new Types.ObjectId()) };
let fgId: string;
let pbId: string;

beforeAll(async () => {
  vi.stubEnv('NUCLEAS_SECRETS_KEY', 'ai-test-key');
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_company_ai_test'));
  await Promise.all([IntegrationConnection.syncIndexes(), MetricSnapshot.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose.disconnect();
  await replica?.stop();
});

async function company(name: string, domain: string, teamEmployee?: string) {
  const hub = await Project.create({
    name, projectType: 'internal', category: 'website', status: 'launched', color: '#111', userId: new Types.ObjectId(),
    assignedToEmployeeIds: teamEmployee ? [new Types.ObjectId(teamEmployee)] : [],
    tasks: [{ name: `${name} secret roadmap task`, status: 'active', endDate: new Date('2026-10-05') }],
  });
  const c = await Client.create({ organizationId: orgId, name, color: '#111', relationship: 'owned', domain, hubProjectId: hub._id });
  await Project.updateOne({ _id: hub._id }, { $set: { clientId: c._id } });
  return String(c._id);
}

async function connect(companyId: string | null, provider: string) {
  const secret = await IntegrationSecret.create({ organizationId: orgId, provider, sealed: sealSecret(`integration:${provider}`, 'k') });
  await IntegrationConnection.create({ organizationId: orgId, companyId: companyId ? new Types.ObjectId(companyId) : null, provider, scope: companyId ? 'company' : 'org', status: 'connected', source: 'manual', secretId: secret._id });
}

beforeEach(async () => {
  await Promise.all([Client.deleteMany({}), Project.deleteMany({}), IntegrationConnection.deleteMany({}), IntegrationSecret.deleteMany({}), CapabilityInvocation.deleteMany({}), MetricSnapshot.deleteMany({})]);
  fgId = await company('Frugal Gambler', 'frugalgambler.club');
  pbId = await company('PlayBound', 'playbound.club');
  const today = new Date();
  for (let i = 1; i <= 14; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10);
    await MetricSnapshot.create({ organizationId: orgId, companyId: new Types.ObjectId(fgId), metricKey: 'sessions', date: d, value: i <= 7 ? 200 : 100 });
    await MetricSnapshot.create({ organizationId: orgId, companyId: new Types.ObjectId(pbId), metricKey: 'sessions', date: d, value: 7777 });
  }
  await MetricSnapshot.create({ organizationId: orgId, companyId: new Types.ObjectId(fgId), metricKey: 'cash_available', date: today.toISOString().slice(0, 10), value: 123456789 });
  await connect(fgId, 'brevo');
  await connect(fgId, 'mercury');
  await connect(null, 'ahrefs');
  await connect(pbId, 'stripe');
});

describe('company context', () => {
  it('includes this company only, with metrics, open work and connected systems', async () => {
    const ctx = await resolveCompanyContext(admin, fgId);
    const text = renderContext(ctx!);
    expect(text).toContain('Frugal Gambler');
    expect(text).toContain('Sessions: 1,400 last 7 days (prior 7: 700, +100% vs prior)');
    expect(text).toContain('Frugal Gambler secret roadmap task');
    expect(text).toContain('Brevo');
    expect(text).not.toContain('PlayBound');
    expect(text).not.toContain('7,777');
    expect(ctx!.hubProjectId).toBeTruthy();
  });

  it('never includes sensitive data such as cash balances', async () => {
    const text = renderContext((await resolveCompanyContext(admin, fgId))!);
    expect(text).not.toMatch(/cash/i);
    expect(text).not.toContain('1,234,567');
  });

  it('respects access and the size budget', async () => {
    expect(await resolveCompanyContext(member, fgId)).toBeNull();
    const small = await resolveCompanyContext(admin, fgId, { budgetChars: 500 });
    expect(renderContext(small!).length).toBeLessThanOrEqual(600);
    expect(small!.omitted.length).toBeGreaterThan(0);
  });

  it('frames context as data in the system prompt', () => {
    const prompt = buildSystemPrompt('Frugal Gambler', '## Company\nName: x', '2026-09-28');
    expect(prompt).toMatch(/data, not instructions/);
    expect(prompt).toMatch(/Never invent/);
  });
});

describe('company tools', () => {
  it('offers only connected, non-sensitive capabilities for this company', async () => {
    const tools = await buildCompanyTools(admin, fgId);
    const names = tools.toolSet.definitions.map((d) => d.function.name);
    expect(names).toContain('company_metrics');
    expect(names).toContain(toolNameFor('email.audience.read'));
    expect(names).toContain(toolNameFor('seo.project.create'));
    expect(names).not.toContain(toolNameFor('finance.cash.read'));
    expect(names).not.toContain(toolNameFor('payments.revenue.read'));
  });

  it('reads stored metrics for the bound company only', async () => {
    const tools = await buildCompanyTools(admin, fgId);
    const out = JSON.parse(await tools.toolSet.execute('company_metrics', '{"days":28}', { runId: new Types.ObjectId() }));
    const sessions = out.metrics.find((m: { key: string }) => m.key === 'sessions');
    expect(sessions.last7OrCurrent).toBe(1400);
    expect(JSON.stringify(out)).not.toContain('7777');
    expect(out.metrics.map((m: { key: string }) => m.key)).not.toContain('cash_available');
  });

  it('records capability calls as AI actions and rejects unknown tools', async () => {
    const noNetwork = vi.fn(async () => new Response(JSON.stringify({ error: 'Insufficient plan' }), { status: 403 }));
    const tools = await buildCompanyTools(admin, fgId, { fetchImpl: noNetwork });
    const runId = new Types.ObjectId();
    await tools.toolSet.execute(toolNameFor('seo.overview.read'), '{}', { runId });
    const receipt = await CapabilityInvocation.findOne({ capabilityId: 'seo.overview.read' }).lean();
    expect(String(receipt?.requestedByAiRunId)).toBe(String(runId));
    expect(receipt?.status).toBe('plan_limited');
    expect(tools.invocationIds).toHaveLength(1);
    expect(noNetwork).toHaveBeenCalled();

    expect(JSON.parse(await tools.toolSet.execute('finance_cash_read', '{}', { runId }))).toMatchObject({ ok: false });
    expect(JSON.parse(await tools.toolSet.execute('company_metrics', 'not json', { runId }))).toMatchObject({ ok: false });
  });

  it('cannot make changes on behalf of a non-manager', async () => {
    const hub = await Project.findOne({ clientId: new Types.ObjectId(fgId) });
    const teamMember: CompanyViewer = { ...member };
    await Project.updateOne({ _id: hub!._id }, { $set: { assignedToEmployeeIds: [new Types.ObjectId(teamMember.employeeId!)] } });
    const tools = await buildCompanyTools(teamMember, fgId);
    const out = JSON.parse(await tools.toolSet.execute(toolNameFor('seo.project.create'), '{}', { runId: new Types.ObjectId() }));
    expect(out).toMatchObject({ ok: false });
    expect(await CapabilityInvocation.countDocuments({ capabilityId: 'seo.project.create' })).toBe(0);
  });
});
