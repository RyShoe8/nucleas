import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));

type ChatInput = { systemPrompt: string; userText: string; model: string; modelProfileId: string; toolProfile?: string; forceToolLoop?: boolean };
const chat = vi.fn<(input: ChatInput) => Promise<{ role: string; text: string; costMicros?: number; runId?: string; requestId: string }>>();
vi.mock('@/lib/ai/companyChat', () => ({ attemptCompanyCredentialChat: (input: ChatInput) => chat(input) }));
const search = vi.fn();
vi.mock('@/lib/ai/tools/webSearch', () => ({ webSearch: (q: string) => search(q) }));
vi.mock('@/lib/ai/tools/serverBrowseAssist', () => ({
  formatResearchResultContext: (r: { query: string; hits: { title: string; url: string; snippet: string }[] }) =>
    [`Search: ${r.query}`, ...r.hits.map((h) => `- [${h.title}](${h.url}): ${h.snippet}`)].join('\n'),
}));

const propose = vi.fn();
vi.mock('@/lib/building/builds', () => ({ proposeCodeChange: (...args: unknown[]) => propose(...args) }));

import Client from '@/lib/models/Client';
import { AiProjectRepository } from '@/lib/models/AiProjectRepository';
import Project from '@/lib/models/Project';
import { AiModelProfile } from '@/lib/models/AiModelProfile';
import { MetricSnapshot } from '@/lib/models/Metric';
import { CapabilityInvocation } from '@/lib/models/Capability';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { resolvePortfolioContext } from '@/lib/context/resolveCompanyContext';
import { AiModelCatalogSnapshot } from '@/lib/ai/engine/catalog';
import { AiEngineSettings, saveEngineSettings, type CostLevel } from '@/lib/ai/engine/select';
import { AiModelHealth, recordModelFailure } from '@/lib/ai/engine/health';

const ROGLY_MODELS = {
  general: 'google/gemma-4-12B-it-qat-w4a16-ct',
  code: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ',
  vision: 'Qwen/Qwen3-VL-8B-Thinking-FP8',
};
const PAID_MODELS = ['o4-mini', 'anthropic/claude-sonnet-5', 'gpt-6-astra'];
import { factSheet, runAskOrchestrator, untracedNumbers } from './askOrchestrator';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const admin: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: org, employeeId: null, role: 'Administrator' };
let roglyProfile: string;

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_orchestrator_test'));
  await Promise.all([AiEngineSettings.syncIndexes(), AiModelCatalogSnapshot.syncIndexes(), MetricSnapshot.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  chat.mockReset();
  search.mockReset();
  await Promise.all([Client.deleteMany({}), Project.deleteMany({}), AiModelProfile.deleteMany({}), AiEngineSettings.deleteMany({}), AiModelCatalogSnapshot.deleteMany({}), MetricSnapshot.deleteMany({}), CapabilityInvocation.deleteMany({}), AiModelHealth.deleteMany({})]);
  const paid = await AiModelProfile.create({ key: 'anthropic', label: 'Anthropic', provider: 'openrouter', tier: 'commercial', protocol: 'openai-chat', endpoint: 'https://x.test/v1/chat/completions', secretCiphertext: 'x', secretLast4: '1234', enabled: true });
  const rogly = await AiModelProfile.create({ key: 'rogly', label: 'Rogly', provider: 'custom', tier: 'local_remote', protocol: 'openai-chat', endpoint: 'https://rogly.test/v1/chat/completions', secretCiphertext: 'x', secretLast4: '1234', enabled: true });
  roglyProfile = String(rogly._id);
  // Fresh cached model lists so selection never calls a provider.
  await AiModelCatalogSnapshot.create([
    { profileId: paid._id, modelIds: PAID_MODELS, fetchedAt: new Date() },
    { profileId: rogly._id, modelIds: Object.values(ROGLY_MODELS), fetchedAt: new Date() },
  ]);
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

function stageOf(input: ChatInput): 'plan' | 'research' | 'work' | 'review' {
  if (input.systemPrompt.startsWith('You plan answers')) return 'plan';
  if (input.systemPrompt.startsWith('You are a research agent')) return 'research';
  if (input.systemPrompt.startsWith('You review')) return 'review';
  return 'work';
}

async function ask(text: string, level: CostLevel = 'low') {
  const context = await resolvePortfolioContext(admin, { message: text });
  return runAskOrchestrator(admin, { text, context, projectId: new Types.ObjectId(), history: [], level });
}

describe('engine selection in Ask', () => {
  it('low: #3 paid planner, Rogly writer; high: #1 paid planner and writer, always reviewed', async () => {
    const seen: Record<string, string[]> = {};
    chat.mockImplementation(async (input) => {
      const stage = stageOf(input);
      (seen[stage] ??= []).push(input.model);
      if (stage === 'plan') return reply('{"kind":"answer","scope":"general","outline":[],"review":false}');
      if (stage === 'review') return reply('{"verdict":"accept","notes":"ok"}');
      return reply('An answer.');
    });
    await ask('summarize', 'low');
    expect(seen).toEqual({ plan: ['o4-mini'], work: [ROGLY_MODELS.general] });

    for (const k of Object.keys(seen)) delete seen[k];
    await ask('summarize', 'high');
    expect(seen.plan).toEqual(['gpt-6-astra']);
    expect(seen.work?.[0]).not.toBe(ROGLY_MODELS.general);
    expect(seen.review).toEqual(['gpt-6-astra']);
  });

  it('a pinned model overrides automatic selection at every level', async () => {
    await saveEngineSettings(String(org), { pin: { need: 'write', profileId: roglyProfile, model: ROGLY_MODELS.code } }, admin.userId);
    const writers: string[] = [];
    chat.mockImplementation(async (input) => {
      if (stageOf(input) === 'plan') return reply('{"kind":"answer","scope":"general","outline":[],"review":false}');
      if (stageOf(input) === 'review') return reply('{"verdict":"accept"}');
      writers.push(input.model);
      return reply('An answer.');
    });
    await ask('summarize', 'high');
    expect(writers).toEqual([ROGLY_MODELS.code]);
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
    expect(untracedNumbers('As of September 2026, the offer is 120,000 coins.', ['120,000 Gold Coins'])).toEqual([]);
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

  it('low never pays to retry a failed Rogly write; medium retries on a paid model', async () => {
    const plan = '{"kind":"answer","scope":"general","fetch":[],"outline":[],"review":false}';
    chat.mockImplementation(async (input) => (stageOf(input) === 'plan' ? reply(plan) : { role: 'status', text: 'Rogly unavailable', requestId: 'r' }));
    const low = await ask('summarize', 'low');
    expect(low.role).toBe('status');
    expect(chat.mock.calls.filter((c) => stageOf(c[0]) === 'work')).toHaveLength(1);

    chat.mockReset();
    chat.mockImplementation(async (input) => {
      if (stageOf(input) === 'plan') return reply(plan);
      if (input.model === ROGLY_MODELS.general) return { role: 'status', text: 'Rogly unavailable', requestId: 'r' };
      return reply('Here is a summary.', 1000);
    });
    const medium = await ask('summarize', 'medium');
    expect(medium.role).toBe('assistant');
    expect(medium.stages.filter((s) => s.stage === 'work').map((s) => s.note ?? 'primary')).toEqual(['primary', 'paid retry (medium cost)']);
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
    // 2 calls (plan + write), 3 plan attempts (retry, then one step up), 1 clarify.
    expect(chat).toHaveBeenCalledTimes(2 + 3 + 1);
  });
});

describe('general questions', () => {
  it('answers from general knowledge without company data, number checks or review', async () => {
    chat.mockImplementation(async (input) => {
      const stage = stageOf(input);
      if (stage === 'plan') return reply('{"kind":"answer","scope":"general","outline":["Give a pick"],"review":false}', 1000);
      if (stage === 'work') {
        expect(input.userText).not.toContain('Nucleas facts');
        expect(input.userText).not.toContain('Frugal Gambler');
        expect(input.systemPrompt).toContain('you may use your own knowledge');
        return reply('Many rank Patrick Mahomes first; it is a judgement call. He has 3 titles and 1000 things.');
      }
      throw new Error('review should not run');
    });
    const out = await ask('Who is the best quarterback in the NFL?');
    expect(out.role).toBe('assistant');
    expect(out.stages.find((s) => s.stage === 'check')?.note).toBe('not applicable (general knowledge)');
    expect(out.stages.map((s) => s.stage)).not.toContain('review');
    expect(search).not.toHaveBeenCalled();
  });

  it('runs requested web research in code and gives the writer cited sources', async () => {
    search.mockResolvedValue({ query: 'best NFL quarterback 2026', hits: [{ title: 'QB rankings', url: 'https://example.com/qb', snippet: 'Josh Allen leads with 4,300 yards' }] });
    chat.mockImplementation(async (input) => {
      const stage = stageOf(input);
      if (stage === 'plan') return reply('{"kind":"answer","scope":"general","research":[{"query":"best NFL quarterback 2026"}],"outline":[],"review":false}');
      if (stage === 'work') {
        expect(input.userText).toContain('# Web research');
        expect(input.userText).toContain('[QB rankings](https://example.com/qb)');
        return reply('Josh Allen leads with 4,300 yards ([QB rankings](https://example.com/qb)).');
      }
      throw new Error('review should not run');
    });
    const out = await ask('Who is the best quarterback right now?');
    expect(search).toHaveBeenCalledWith('best NFL quarterback 2026');
    expect(out.stages.find((s) => s.stage === 'fetch')?.note).toBe('0 job(s), 1 web search(es), no model');
    expect(out.stages.find((s) => s.stage === 'check')?.note).toBe('all numbers traced to data');
  });
});

describe('deep research', () => {
  const plan = '{"kind":"answer","scope":"general","deepResearch":{"question":"What bonus offers are top casino affiliates promoting this month?"},"outline":[],"review":false}';

  it('hands multi-step research to Rogly in the tool loop and gives its findings to the writer', async () => {
    chat.mockImplementation(async (input) => {
      const stage = stageOf(input);
      if (stage === 'plan') return reply(plan, 1500);
      if (stage === 'research') {
        expect(input.model).toBe(ROGLY_MODELS.code);
        expect(input.toolProfile).toBe('full');
        expect(input.forceToolLoop).toBe(true);
        return { ...reply('Findings\n- Site A offers 250 free spins ([A](https://a.example))'), toolsUsed: ['web_search', 'web_fetch', 'web_search'] };
      }
      if (stage === 'work') {
        expect(input.userText).toContain('Site A offers 250 free spins');
        return reply('Site A leads with 250 free spins ([A](https://a.example)).');
      }
      throw new Error('review should not run');
    });
    const out = await ask('What are casino affiliates promoting this month?');
    expect(out.stages.map((s) => s.stage)).toEqual(['plan', 'fetch', 'research', 'work', 'check']);
    expect(out.stages.find((s) => s.stage === 'research')).toMatchObject({ free: true, note: 'tools: web_search, web_fetch' });
    expect(out.stages.find((s) => s.stage === 'check')?.note).toBe('all numbers traced to data');
  });

  it('continues honestly when research fails, without paying unless allowed', async () => {
    chat.mockImplementation(async (input) => {
      const stage = stageOf(input);
      if (stage === 'plan') return reply(plan);
      if (stage === 'research') return { role: 'status', text: 'Rogly timed out', requestId: 'r' };
      expect(input.userText).toContain('could not be completed (Rogly timed out)');
      return reply('I could not complete the research this time.');
    });
    const out = await ask('What are casino affiliates promoting this month?');
    expect(out.role).toBe('assistant');
    expect(chat.mock.calls.filter((c) => stageOf(c[0]) === 'research')).toHaveLength(1);
  });
});

describe('planner robustness', () => {
  it('retries a bad plan once, then escalates one rank up, and records each attempt', async () => {
    const planners: string[] = [];
    chat.mockImplementation(async (input) => {
      if (stageOf(input) === 'plan') {
        planners.push(input.model);
        if (input.model === 'o4-mini') return reply('');
        return reply('{"kind":"answer","scope":"general","outline":[],"review":false}');
      }
      return reply('An answer.');
    });
    const out = await ask('summarize', 'low');
    expect(out.role).toBe('assistant');
    expect(planners).toEqual(['o4-mini', 'o4-mini', 'anthropic/claude-sonnet-5']);
    expect(out.stages.filter((s) => s.stage === 'plan').map((s) => s.note ?? 'ok')).toEqual(['unusable plan (not valid JSON)', 'unusable plan (not valid JSON)', 'ok']);
  });

  it('a corrective retry on the same model is enough when it works', async () => {
    let calls = 0;
    chat.mockImplementation(async (input) => {
      if (stageOf(input) === 'plan') {
        calls += 1;
        if (calls === 1) return reply('Sure! Here is my plan: step one...');
        expect(input.userText).toContain('Reply with ONLY the JSON object');
        return reply('{"kind":"answer","scope":"general","outline":[],"review":false}');
      }
      return reply('An answer.');
    });
    expect((await ask('summarize', 'low')).role).toBe('assistant');
    expect(calls).toBe(2);
  });
});

describe('code changes', () => {
  async function connectRepository() {
    const fg = await Client.findOne({ name: 'Frugal Gambler' }).lean<{ _id: Types.ObjectId; hubProjectId: Types.ObjectId }>();
    await AiProjectRepository.create({ organizationId: String(org), projectId: fg!.hubProjectId, owner: 'RyShoe8', repo: 'frugalgambler', installationId: '42' });
    return String(fg!._id);
  }

  it('tells the planner which companies have code, and turns a code request into a proposal awaiting approval', async () => {
    await AiProjectRepository.deleteMany({});
    const companyId = await connectRepository();
    let plannerSystem = '';
    chat.mockImplementation(async (input) => {
      plannerSystem = input.systemPrompt;
      return reply('{"kind":"answer","scope":"company","codeChange":{"company":"Frugal Gambler","request":"Add a FAQ page linked from the footer"},"outline":[],"review":false}');
    });
    propose.mockResolvedValue({ ok: true, costMicros: 900, build: { id: 'b1', title: 'Add a FAQ page', summary: 'Static FAQ.', status: 'proposed', repository: { fullName: 'RyShoe8/frugalgambler' } } });
    const answer = await ask('Plan a FAQ page for Frugal Gambler');
    expect(plannerSystem).toContain('- Frugal Gambler: RyShoe8/frugalgambler');
    expect(propose).toHaveBeenCalledWith(admin, expect.objectContaining({ companyId, request: 'Add a FAQ page linked from the footer', level: 'low' }));
    expect(answer.build).toMatchObject({ id: 'b1', status: 'proposed' });
    expect(answer.text).toContain('Add a FAQ page');
    expect(answer.stages.map((s) => s.stage)).toEqual(['plan', 'code']);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('explains when the company has no repository instead of planning', async () => {
    await AiProjectRepository.deleteMany({});
    propose.mockReset();
    chat.mockImplementation(async () => reply('{"kind":"answer","scope":"company","codeChange":{"company":"Frugal Gambler","request":"Add a FAQ page"},"outline":[],"review":false}'));
    const answer = await ask('Plan a FAQ page for Frugal Gambler');
    expect(propose).not.toHaveBeenCalled();
    expect(answer.text).toMatch(/no GitHub repository connected/);
  });
});

describe('provider failures', () => {
  it('when a provider rejects its key, the planner retries on a different provider, not the same account', async () => {
    const other = await AiModelProfile.create({ key: 'openai', label: 'OpenAI', provider: 'openai', tier: 'commercial', protocol: 'openai-chat', endpoint: 'https://api.openai.test/v1/chat/completions', secretCiphertext: 'x', secretLast4: '1234', enabled: true });
    await AiModelCatalogSnapshot.create({ profileId: other._id, modelIds: ['o3'], fetchedAt: new Date() });
    const planners: string[] = [];
    chat.mockImplementation(async (input) => {
      const stage = stageOf(input);
      if (stage === 'plan') {
        planners.push(input.model);
        if (planners.length === 1) {
          // What companyChat does on a 401: bench the whole credential, then report the failure.
          await recordModelFailure({ profileId: input.modelProfileId, model: input.model, httpStatus: 401, message: 'Invalid API key' });
          return { role: 'status', text: 'Remote authentication was rejected.', requestId: 'r' };
        }
        return reply('{"kind":"answer","scope":"general","outline":[],"review":false}');
      }
      return reply('An answer.');
    });
    const answer = await ask('summarize', 'low');
    expect(answer.role).toBe('assistant');
    expect(planners).toEqual(['o4-mini', 'o3']);
    expect(answer.stages[0].note).toMatch(/Remote authentication was rejected/);
  });
});

describe('attached files', () => {
  it('the planner gets a summary, the writer the content, and figures from files count as sourced', async () => {
    const prompts: Record<string, string> = {};
    chat.mockImplementation(async (input) => {
      const stage = stageOf(input);
      prompts[stage] = input.userText;
      if (stage === 'plan') return reply('{"kind":"answer","scope":"general","outline":["Summarize the file"],"review":false}');
      if (stage === 'review') return reply('{"verdict":"accept","notes":"ok"}');
      return reply('The report shows revenue of 48,213 for the quarter.');
    });
    const context = await resolvePortfolioContext(admin, { message: 'summarize this' });
    const attachments = '## File "q3.csv"\nquarter,revenue\nQ3,48213\n' + 'x'.repeat(9000);
    const answer = await runAskOrchestrator(admin, { text: 'summarize this', context, projectId: new Types.ObjectId(), history: [], level: 'low', attachments });
    expect(prompts.plan).toContain('# Attached files');
    expect(prompts.plan.length).toBeLessThan(7000);
    expect(prompts.work).toContain('# Files the user attached');
    expect(prompts.work).toContain('Q3,48213');
    expect(answer.stages.map((s) => s.stage)).not.toContain('review');
  });
});
