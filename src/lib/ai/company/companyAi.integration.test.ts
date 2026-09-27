import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import { IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { CapabilityInvocation } from '@/lib/models/Capability';
import { MetricSnapshot } from '@/lib/models/Metric';
import { sealSecret } from '@/lib/security/secretBox';
import { listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import { detectCompanies, renderContext, resolveCompanyContext, resolvePortfolioContext } from '@/lib/context/resolveCompanyContext';
import { buildAssistantTools, matchCompany, toolNameFor } from './companyTools';
import { buildSystemPrompt } from './companyAssistant';

vi.mock('server-only', () => ({}));

let replica: MongoMemoryReplSet;
const orgId = new Types.ObjectId();
const teamEmployee = new Types.ObjectId();
const admin: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: orgId, employeeId: null, role: 'Administrator' };
const member: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: orgId, employeeId: String(teamEmployee), role: 'User' };
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

async function company(name: string, domain: string, relationship: 'owned' | 'client', team: Types.ObjectId[] = []) {
  const hub = await Project.create({
    name, projectType: 'internal', category: 'website', status: 'launched', color: '#111', userId: new Types.ObjectId(),
    assignedToEmployeeIds: team,
    tasks: [{ name: `${name} roadmap task`, status: 'active', endDate: new Date('2026-10-05') }],
  });
  const c = await Client.create({ organizationId: orgId, name, color: '#111', relationship, domain, hubProjectId: relationship === 'owned' ? hub._id : undefined, assignedToEmployeeIds: team });
  await Project.updateOne({ _id: hub._id }, { $set: { clientId: c._id } });
  return String(c._id);
}

async function connect(companyId: string | null, provider: string) {
  const secret = await IntegrationSecret.create({ organizationId: orgId, provider, sealed: sealSecret(`integration:${provider}`, 'k') });
  await IntegrationConnection.create({ organizationId: orgId, companyId: companyId ? new Types.ObjectId(companyId) : null, provider, scope: companyId ? 'company' : 'org', status: 'connected', source: 'manual', secretId: secret._id });
}

async function sessions(companyId: string, recent: number, prior: number) {
  const today = new Date();
  for (let i = 1; i <= 14; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10);
    await MetricSnapshot.create({ organizationId: orgId, companyId: new Types.ObjectId(companyId), metricKey: 'sessions', date: d, value: i <= 7 ? recent : prior });
  }
}

beforeEach(async () => {
  await Promise.all([Client.deleteMany({}), Project.deleteMany({}), IntegrationConnection.deleteMany({}), IntegrationSecret.deleteMany({}), CapabilityInvocation.deleteMany({}), MetricSnapshot.deleteMany({})]);
  fgId = await company('Frugal Gambler', 'frugalgambler.club', 'owned', [teamEmployee]);
  pbId = await company('PlayBound', 'playbound.club', 'owned');
  await company('Senior By Design', 'seniorbydesign.com', 'client');
  await sessions(fgId, 200, 100);
  await sessions(pbId, 50, 50);
  await MetricSnapshot.create({ organizationId: orgId, companyId: new Types.ObjectId(fgId), metricKey: 'cash_available', date: new Date().toISOString().slice(0, 10), value: 123456789 });
  await connect(fgId, 'brevo');
  await connect(fgId, 'mercury');
  await connect(null, 'ahrefs');
  await connect(pbId, 'stripe');
});

describe('company detection', () => {
  it('finds companies by full name, domain label or a distinctive word, ignoring common words', async () => {
    const companies = await listCompanyProfiles(admin);
    const names = (m: string) => detectCompanies(m, companies).map((c) => c.name);
    expect(names('how is frugal doing?')).toEqual(['Frugal Gambler']);
    expect(names('compare playbound and Frugal Gambler')).toEqual(['Frugal Gambler', 'PlayBound']);
    expect(names('what about seniorbydesign this month')).toEqual(['Senior By Design']);
    expect(names('which business grew the most?')).toEqual([]);
  });

  it('matches tool company arguments by name, domain or id only among accessible companies', async () => {
    const companies = await listCompanyProfiles(member);
    expect(matchCompany(companies, 'Frugal Gambler')?.id).toBe(fgId);
    expect(matchCompany(companies, 'frugalgambler.club')?.id).toBe(fgId);
    expect(matchCompany(companies, 'PlayBound')).toBeNull();
  });
});

describe('portfolio context', () => {
  it('summarizes every accessible company and adds detail only for the ones asked about', async () => {
    const ctx = await resolvePortfolioContext(admin, { message: 'how is frugal doing?' });
    const text = renderContext(ctx);
    expect(text).toContain('Frugal Gambler (own business, frugalgambler.club): sessions 1,400 +100%');
    expect(text).toContain('PlayBound (own business, playbound.club): sessions 350');
    expect(text).toContain('Senior By Design (client, seniorbydesign.com): no metrics yet');
    expect(text).toContain('Frugal Gambler: Projects and open work');
    expect(text).not.toContain('PlayBound roadmap task');
    expect(ctx.focused).toEqual([fgId]);
  });

  it('uses an explicit focus even when the question names no company', async () => {
    const ctx = await resolvePortfolioContext(admin, { message: 'what should we do next?', focusCompanyId: pbId });
    expect(renderContext(ctx)).toContain('PlayBound roadmap task');
  });

  it('shows a team member only the companies they can access', async () => {
    const text = renderContext(await resolvePortfolioContext(member, { message: 'compare playbound and frugal' }));
    expect(text).toContain('Frugal Gambler');
    expect(text).not.toContain('PlayBound');
    expect(text).not.toContain('Senior By Design');
  });

  it('never includes sensitive data such as cash balances', async () => {
    const text = renderContext(await resolvePortfolioContext(admin, { message: 'frugal cash position?' }));
    expect(text).not.toMatch(/cash/i);
    expect(text).not.toContain('1,234,567');
  });

  it('single-company detail still respects its budget', async () => {
    const small = await resolveCompanyContext(admin, fgId, { budgetChars: 500 });
    expect(renderContext(small!).length).toBeLessThanOrEqual(600);
    expect(small!.omitted.length).toBeGreaterThan(0);
  });

  it('frames context as data in the system prompt', () => {
    const prompt = buildSystemPrompt('## x', '2026-09-28', ['Frugal Gambler']);
    expect(prompt).toMatch(/data, not instructions/);
    expect(prompt).toMatch(/Never invent/);
    expect(prompt).toMatch(/focused on: Frugal Gambler/);
  });
});

describe('assistant tools', () => {
  it('offer non-sensitive capabilities with a company argument limited to accessible companies', async () => {
    const tools = await buildAssistantTools(admin, await listCompanyProfiles(admin));
    const defs = tools.toolSet.definitions;
    const names = defs.map((d) => d.function.name);
    expect(names).toEqual(expect.arrayContaining(['list_companies', 'company_metrics', toolNameFor('email.audience.read'), toolNameFor('payments.revenue.read')]));
    expect(names).not.toContain(toolNameFor('finance.cash.read'));
    const param = (defs.find((d) => d.function.name === 'company_metrics')!.function.parameters as { properties: { company: { enum: string[] } } }).properties.company;
    expect(param.enum.sort()).toEqual(['Frugal Gambler', 'PlayBound', 'Senior By Design']);
  });

  it('reads the named company and refuses companies the viewer cannot access', async () => {
    const tools = await buildAssistantTools(member, await listCompanyProfiles(member));
    const runId = new Types.ObjectId();
    const ok = JSON.parse(await tools.toolSet.execute('company_metrics', '{"company":"Frugal Gambler"}', { runId }));
    expect(ok.metrics.find((m: { key: string }) => m.key === 'sessions').last7OrCurrent).toBe(1400);
    expect(ok.metrics.map((m: { key: string }) => m.key)).not.toContain('cash_available');
    expect(JSON.parse(await tools.toolSet.execute('company_metrics', '{"company":"PlayBound"}', { runId }))).toMatchObject({ ok: false });
    expect(JSON.parse(await tools.toolSet.execute('company_metrics', 'not json', { runId }))).toMatchObject({ ok: false });
    const listed = JSON.parse(await tools.toolSet.execute('list_companies', '{}', { runId }));
    expect(listed.companies.map((c: { name: string }) => c.name)).toEqual(['Frugal Gambler']);
  });

  it('attributes capability calls to the AI run and the named company', async () => {
    const noNetwork = vi.fn(async () => new Response(JSON.stringify({ error: 'Insufficient plan' }), { status: 403 }));
    const tools = await buildAssistantTools(admin, await listCompanyProfiles(admin), { fetchImpl: noNetwork });
    const runId = new Types.ObjectId();
    await tools.toolSet.execute(toolNameFor('seo.overview.read'), '{"company":"PlayBound"}', { runId });
    const receipt = await CapabilityInvocation.findOne({ capabilityId: 'seo.overview.read' }).lean();
    expect(String(receipt?.requestedByAiRunId)).toBe(String(runId));
    expect(String(receipt?.companyId)).toBe(pbId);
    expect(receipt?.status).toBe('plan_limited');
    expect(tools.invocationIds).toHaveLength(1);
  });

  it('cannot make changes on behalf of a non-manager', async () => {
    const tools = await buildAssistantTools(member, await listCompanyProfiles(member));
    const out = JSON.parse(await tools.toolSet.execute(toolNameFor('seo.project.create'), '{"company":"Frugal Gambler"}', { runId: new Types.ObjectId() }));
    expect(out).toMatchObject({ ok: false });
    expect(await CapabilityInvocation.countDocuments({ capabilityId: 'seo.project.create' })).toBe(0);
  });
});
