import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));

type ChatInput = { systemPrompt: string; userText: string; model: string; modelProfileId: string };
const chat = vi.fn<(input: ChatInput) => Promise<{ role: string; text: string; costMicros?: number; runId?: string; requestId: string }>>();
vi.mock('@/lib/ai/companyChat', () => ({ attemptCompanyCredentialChat: (input: ChatInput) => chat(input) }));

import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import { AiModelProfile, AiRolePipeline } from '@/lib/models/AiRolePipeline';
import { MetricSnapshot } from '@/lib/models/Metric';
import { CapabilityInvocation } from '@/lib/models/Capability';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { resolvePortfolioContext } from '@/lib/context/resolveCompanyContext';
import { AiRouteBinding, assignRoute, resolveRoute } from '@/lib/ai/routing/resolveRoute';
import { ROGLY_MODELS } from '@/lib/ai/routing/routes';
import { factSheet, runAskOrchestrator, untracedNumbers } from './askOrchestrator';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const admin: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: org, employeeId: null, role: 'Administrator' };
let paidProfile: string;
let roglyProfile: string;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_orchestrator_test'));
  await Promise.all([AiRouteBinding.syncIndexes(), MetricSnapshot.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  chat.mockReset();
  await Promise.all([Client.deleteMany({}), Project.deleteMany({}), AiModelProfile.deleteMany({}), AiRolePipeline.deleteMany({}), AiRouteBinding.deleteMany({}), MetricSnapshot.deleteMany({}), CapabilityInvocation.deleteMany({})]);
  const paid = await AiModelProfile.create({ key: 'anthropic', label: 'Anthropic', provider: 'openrouter', tier: 'commercial', protocol: 'openai-chat', endpoint: 'https://x.test/v1/chat/completions', secretCiphertext: 'x', secretLast4: '1234', enabled: true });
  const rogly = await AiModelProfile.create({ key: 'rogly', label: 'Rogly', provider: 'custom', tier: 'local_remote', protocol: 'openai-chat', endpoint: 'https://rogly.test/v1/chat/completions', secretCiphertext: 'x', secretLast4: '1234', enabled: true });
  paidProfile = String(paid._id);
  roglyProfile = String(rogly._id);
  await AiRolePipeline.create({
    organizationId: String(org),
    employee: 'product',
    planner: { modelProfileId: paid._id, model: 'claude-sonnet' },
    worker: { modelProfileId: rogly._id, model: ROGLY_MODELS.general },
    reviewer: { modelProfileId: paid._id, model: 'claude-sonnet' },
  });
  const hub = await Project.create({ name: 'Frugal Gambler', projectType: 'internal', category: 'website', status: 'launched', color: '#111', userId: new Types.ObjectId() });
  const fg = await Client.create({ organizationId: org, name: 'Frugal Gambler', color: '#111', relationship: 'owned', domain: 'frugalgambler.club', hubProjectId: hub._id });
  await Project.updateOne({ _id: hub._id }, { $set: { clientId: fg._id } });
  const today = new Date();
  for (let i = 1; i <= 14; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10);
    await MetricSnapshot.create({ organizationId: org, companyId: fg._id, metricKey: 'sessions', date: d, value: i <= 7 ? 300 : 200 });
  }
});

function reply(text: string, costMicros = 0) {
  return { role: 'assistant', text, costMicros, runId: String(new Types.ObjectId()), requestId: 'r' };
}

function stageOf(input: ChatInput): 'plan' | 'work' | 'review' {
  if (input.systemPrompt.startsWith('You plan answers')) return 'plan';
  if (input.systemPrompt.startsWith('You review')) return 'review';
  return 'work';
}

async function ask(text: string) {
  const context = await resolvePortfolioContext(admin, { message: text });
  return runAskOrchestrator(admin, { text, context, projectId: new Types.ObjectId(), history: [] });
}

describe('routes', () => {
  it('inherit AI Team, default free routes to Rogly, and prefer explicit assignments', async () => {
    expect(await resolveRoute(String(org), 'assistant.plan')).toMatchObject({ source: 'ai_team', primary: { model: 'claude-sonnet', free: false } });
    expect(await resolveRoute(String(org), 'assistant.work')).toMatchObject({ source: 'rogly_default', primary: { model: ROGLY_MODELS.general, free: true } });
    expect(await resolveRoute(String(org), 'ide.work')).toMatchObject({ primary: { model: ROGLY_MODELS.code, free: true } });

    await assignRoute(String(org), 'assistant.work', { profileId: roglyProfile, model: ROGLY_MODELS.code }, admin.userId);
    expect(await resolveRoute(String(org), 'assistant.work')).toMatchObject({ source: 'assigned', primary: { model: ROGLY_MODELS.code } });
    expect(await assignRoute(String(org), 'assistant.work', { profileId: roglyProfile, model: '' }, admin.userId)).toMatchObject({ ok: false });
  });

  it('never allows a paid fallback without a fallback model', async () => {
    await assignRoute(String(org), 'assistant.work', { profileId: roglyProfile, model: ROGLY_MODELS.general, allowPaidFallback: true }, admin.userId);
    expect(await resolveRoute(String(org), 'assistant.work')).toMatchObject({ allowPaidFallback: false });
  });
});

describe('number check and facts', () => {
  it('converts money from cents so written figures match', () => {
    const sheet = factSheet([{ company: 'FG', tool: 'company_metrics', result: { ok: true, metrics: [{ label: 'Net revenue', unit: 'USD cents', kind: 'daily', last7OrCurrent: 123456, previous: 100000, changePct: 23.5 }] } }]);
    expect(sheet).toContain('Net revenue: $1,235 (previous $1,000, +23.5%)');
  });

  it('flags numbers that appear in no source', () => {
    expect(untracedNumbers('Sessions were 2,100, up from 1,400.', ['Sessions: 2,100 (previous 1,400)'])).toEqual([]);
    expect(untracedNumbers('Sessions were 9,999.', ['Sessions: 2,100'])).toEqual(['9999']);
  });
});

describe('orchestrated Ask', () => {
  it('plans on the paid model without the data, fetches in code, and writes on Rogly; simple lookups skip review', async () => {
    chat.mockImplementation(async (input) => {
      const stage = stageOf(input);
      if (stage === 'plan') {
        expect(input.systemPrompt).not.toContain('previous 1,400');
        return reply('```json\n{"kind":"answer","fetch":[{"company":"Frugal Gambler","tool":"company_metrics"}],"outline":["State sessions"],"review":false}\n```', 3000);
      }
      if (stage === 'work') {
        expect(input.model).toBe(ROGLY_MODELS.general);
        expect(input.userText).toContain('Sessions: 2,100 (previous 1,400, +50%)');
        return reply('Frugal Gambler had 2,100 sessions in the last 7 days, up 50% from 1,400.');
      }
      throw new Error('review should not run');
    });
    const out = await ask('How many sessions did frugal get this week?');
    expect(out.role).toBe('assistant');
    expect(out.text).toContain('2,100');
    expect(out.stages.map((s) => s.stage)).toEqual(['plan', 'fetch', 'work', 'check']);
    expect(out.stages.find((s) => s.stage === 'work')).toMatchObject({ free: true });
    expect(out.costMicros).toBe(3000);
  });

  it('sends answers with untraced numbers to the paid reviewer, which can correct them', async () => {
    chat.mockImplementation(async (input) => {
      const stage = stageOf(input);
      if (stage === 'plan') return reply('{"kind":"answer","fetch":[{"company":"Frugal Gambler","tool":"company_metrics"}],"outline":[],"review":false}', 2000);
      if (stage === 'work') return reply('Frugal Gambler had 9,999 sessions.');
      expect(input.userText).toContain('Numbers not found in the facts: 9999');
      return reply('{"verdict":"revise","answer":"Frugal Gambler had 2,100 sessions in the last 7 days.","notes":"fixed a number"}', 4000);
    });
    const out = await ask('How many sessions did frugal get?');
    expect(out.text).toBe('Frugal Gambler had 2,100 sessions in the last 7 days.');
    expect(out.stages.map((s) => s.stage)).toEqual(['plan', 'fetch', 'work', 'check', 'review']);
    expect(out.costMicros).toBe(6000);
  });

  it('escalates a failed Rogly write to a paid model only with explicit consent', async () => {
    const plan = '{"kind":"answer","fetch":[],"outline":[],"review":false}';
    chat.mockImplementation(async (input) => (stageOf(input) === 'plan' ? reply(plan) : { role: 'status', text: 'Rogly unavailable', requestId: 'r' }));
    const noConsent = await ask('summarize');
    expect(noConsent.role).toBe('status');
    expect(chat.mock.calls.filter((c) => stageOf(c[0]) === 'work')).toHaveLength(1);

    chat.mockReset();
    await assignRoute(String(org), 'assistant.work', { profileId: roglyProfile, model: ROGLY_MODELS.general, fallbackProfileId: paidProfile, fallbackModel: 'gpt-5-mini', allowPaidFallback: true }, admin.userId);
    chat.mockImplementation(async (input) => {
      if (stageOf(input) === 'plan') return reply(plan);
      if (input.model === ROGLY_MODELS.general) return { role: 'status', text: 'Rogly unavailable', requestId: 'r' };
      return reply('Here is a summary.', 1000);
    });
    const withConsent = await ask('summarize');
    expect(withConsent.role).toBe('assistant');
    expect(withConsent.stages.filter((s) => s.stage === 'work').map((s) => s.note ?? 'primary')).toEqual(['primary', 'paid fallback (allowed)']);
  });

  it('ignores tools the plan invents and handles unusable plans and clarifying questions', async () => {
    chat.mockImplementation(async (input) =>
      stageOf(input) === 'plan'
        ? reply('{"kind":"answer","fetch":[{"company":"Frugal Gambler","tool":"delete_everything"}],"actions":[{"company":"Frugal Gambler","tool":"finance_cash_read"}],"outline":[],"review":false}')
        : reply('No data was available.')
    );
    const out = await ask('do something');
    expect(out.stages.find((s) => s.stage === 'fetch')?.note).toBe('0 job(s), no model');
    expect(await CapabilityInvocation.countDocuments()).toBe(0);

    chat.mockImplementation(async () => reply('not json at all'));
    expect((await ask('hello?')).role).toBe('status');

    chat.mockImplementation(async () => reply('{"kind":"clarify","clarifyQuestion":"Which business do you mean?"}'));
    const clarify = await ask('how is it going?');
    expect(clarify).toMatchObject({ role: 'assistant', text: 'Which business do you mean?' });
    expect(chat).toHaveBeenCalledTimes(1 + 2 + 1);
  });
});
