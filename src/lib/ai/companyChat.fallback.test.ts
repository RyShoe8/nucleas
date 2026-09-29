import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { GatewayError } from '@nucleas/ai-core/gateway';

const runId = new Types.ObjectId();

const mocks = vi.hoisted(() => ({
  gatewayFromProfile: vi.fn(),
  getPolicy: vi.fn(),
  transaction: vi.fn(),
  toolLoop: vi.fn(),
  invokeModel: vi.fn(),
  settle: vi.fn(),
  decrementFree: vi.fn(),
  reserveBudget: vi.fn(),
  findLock: vi.fn(),
  updateLock: vi.fn(),
  deleteLock: vi.fn(),
  createRun: vi.fn(),
  updateRun: vi.fn(),
  findUpdateRun: vi.fn(),
  createEvent: vi.fn(),
  findBudget: vi.fn(),
  webSearch: vi.fn(),
  imageSearch: vi.fn(),
  repoAssist: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/rolePipeline/profiles', () => ({ gatewayFromModelProfile: mocks.gatewayFromProfile }));
vi.mock('@/lib/ai/control/config', () => ({ getPipelineInferencePolicy: mocks.getPolicy }));
vi.mock('@/lib/ai/control/transaction', () => ({ aiTransaction: mocks.transaction }));
vi.mock('@/lib/ai/control/budgets', () => ({
  reserveRunBudget: mocks.reserveBudget,
  settleRunBudget: mocks.settle,
}));
vi.mock('@/lib/ai/control/freePool', () => ({ decrementFreePoolRemaining: mocks.decrementFree }));
vi.mock('@/lib/ai/control/dispatchLimits', () => ({
  DISPATCH_USAGE_ID: 'dispatch',
}));
vi.mock('@/lib/ai/tools/runToolLoop', () => ({ runIdeToolLoop: mocks.toolLoop }));
vi.mock('@/lib/ai/tools/webSearch', () => ({
  webSearch: mocks.webSearch,
  imageSearch: mocks.imageSearch,
}));
vi.mock('@/lib/ai/tools/serverRepoAssist', () => ({
  gatherRepoAssistContext: mocks.repoAssist,
  formatRepoAssistContext: (result: { contextBlock: string }) => result.contextBlock,
}));
vi.mock('@nucleas/ai-core/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nucleas/ai-core/gateway')>();
  return { ...actual, invokeModel: mocks.invokeModel };
});
vi.mock('@/lib/models/AiControl', () => ({
  AiBudget: { findOneAndUpdate: (...args: unknown[]) => mocks.findBudget(...args) },
  AiDispatchLock: {
    findById: (...args: unknown[]) => mocks.findLock(...args),
    updateOne: (...args: unknown[]) => mocks.updateLock(...args),
    deleteOne: (...args: unknown[]) => mocks.deleteLock(...args),
  },
  AiRun: {
    create: (...args: unknown[]) => mocks.createRun(...args),
    updateOne: (...args: unknown[]) => mocks.updateRun(...args),
    findOneAndUpdate: (...args: unknown[]) => mocks.findUpdateRun(...args),
  },
  AiRunEvent: { create: (...args: unknown[]) => mocks.createEvent(...args) },
}));

import { attemptCompanyCredentialChat } from '@/lib/ai/companyChat';

describe('Direct local gateway diagnostics and project context', () => {
  it.each([
    ['credentials', 401], ['rate_limit', 429], ['unavailable', 400], ['unavailable', 503],
  ] as const)('preserves %s HTTP %i rather than inventing a web-search failure', async (code, httpStatus) => {
    mocks.toolLoop.mockRejectedValue(new GatewayError(code, { kind: 'http', httpStatus }));
    mocks.invokeModel.mockRejectedValue(new GatewayError(code, { kind: 'http', httpStatus }));
    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'Assistant', organizationId: 'org', projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24), userText: 'What feature could PlayBound add?',
      priorTurns: [], modelProfileId: 'b'.repeat(24), model: 'qwen3-vl-8b-thinking-fp8',
      includeRepoTools: true,
    });
    expect(turn.failureCategory).toBe(code);
    expect(turn.debugHint).toContain('kind=http');
    expect(turn.debugHint).toContain('httpStatus=' + httpStatus);
    expect(turn.text).not.toContain('web search could not ground');
    expect(mocks.webSearch).not.toHaveBeenCalled();
  });

  it('shows the sanitized local provider reason and identifies a context-window rejection', async () => {
    const failure = new GatewayError('unavailable', {
      kind: 'http',
      httpStatus: 500,
      providerMessage: 'Input exceeds maximum context length for this deployment',
    });
    mocks.toolLoop.mockRejectedValue(failure);
    mocks.invokeModel.mockRejectedValue(failure);
    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'Assistant', organizationId: 'org', projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24), userText: 'Plan the change', priorTurns: [],
      modelProfileId: 'b'.repeat(24), model: 'rogly/model', includeRepoTools: true,
      stopOnUpstreamFailure: true,
    });

    expect(turn.text).toContain('exceeded that deployment’s context window');
    expect(turn.text).toContain('Model provider returned HTTP 500: Input exceeds maximum context length');
  });

  it('grounds a named-project feature question in repository context before asking the local model', async () => {
    mocks.repoAssist.mockResolvedValue({ contextBlock: 'Verified repository evidence', toolsUsed: ['repo_tree', 'repo_read'] });
    mocks.invokeModel.mockResolvedValue({ content: 'A grounded suggestion', inputTokens: 3, outputTokens: 4, latencyMs: 5 });
    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'Assistant', organizationId: 'org', projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24), userText: 'What is the biggest missing feature that PlayBound could add to enhance it for users?',
      projectName: 'Playbound.club', priorTurns: [], modelProfileId: 'b'.repeat(24),
      model: 'qwen3-vl-8b-thinking-fp8', includeRepoTools: true,
    });
    expect(turn.role).toBe('assistant');
    expect(turn.toolsUsed).toEqual(['repo_tree', 'repo_read']);
    expect(mocks.repoAssist).toHaveBeenCalledTimes(1);
    expect(mocks.webSearch).not.toHaveBeenCalled();
    expect(mocks.toolLoop).not.toHaveBeenCalled();
    expect(mocks.invokeModel.mock.calls[0][1].messages.at(-1).content).toContain('Verified repository evidence');
  });
});


it('does not restart an orchestra tool loop after an upstream 504', async () => {
  mocks.toolLoop.mockRejectedValueOnce(new GatewayError('unavailable', { kind: 'http', httpStatus: 504 }));
  const turn = await attemptCompanyCredentialChat({
    systemPrompt: 'Worker verification', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'a'.repeat(24),
    userText: 'Plan briefing ' + 'x'.repeat(7000) + 'VERIFY_LAST_STEP', priorTurns: [], modelProfileId: 'a'.repeat(24), model: 'local',
    forceToolLoop: true, stopOnUpstreamFailure: true, toolProfile: 'repo', repoContextBlock: 'REPO_EVIDENCE',
  });
  expect(turn.role).toBe('status');
  expect(turn.text).toContain('HTTP 504 (upstream timeout)');
  expect(turn.debugHint).toContain('httpStatus=504');
  expect(mocks.toolLoop).toHaveBeenCalledTimes(1);
  expect(mocks.invokeModel).not.toHaveBeenCalled();
  const message = mocks.toolLoop.mock.calls[0][0].messages.at(-1).content;
  expect(message).toContain('VERIFY_LAST_STEP');
  expect(message).toContain('REPO_EVIDENCE');
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reserveBudget.mockResolvedValue(undefined);
  mocks.settle.mockResolvedValue(undefined);
  mocks.decrementFree.mockResolvedValue(undefined);
  mocks.findLock.mockImplementation(() => {
    const p = Promise.resolve(null);
    return Object.assign(p, { session: () => Promise.resolve(null) });
  });
  mocks.updateLock.mockResolvedValue({});
  mocks.deleteLock.mockImplementation(() => Promise.resolve({}));
  mocks.createRun.mockResolvedValue([{ _id: runId }]);
  mocks.updateRun.mockResolvedValue({});
  mocks.findUpdateRun.mockResolvedValue({ _id: runId, revision: 1 });
  mocks.createEvent.mockResolvedValue([]);
  mocks.findBudget.mockResolvedValue({ _id: new Types.ObjectId() });
  // Default: repo assist unavailable so free digs still exercise the tool loop.
  mocks.repoAssist.mockRejectedValue(new Error('repo assist offline'));
  mocks.imageSearch.mockResolvedValue({
    query: '',
    hits: [],
    note: 'No image hits.',
    providersTried: [],
    toolsUsed: ['image_search'],
    hitCount: 0,
  });
  mocks.gatewayFromProfile.mockResolvedValue({
    gateway: {
      endpoint: 'https://rogly.example/v1/chat/completions',
      bearerToken: 'tok',
      model: 'local',
      protocol: 'openai-chat',
      timeoutMs: 120000,
    },
    profile: { provider: 'custom', tier: 'local_remote' },
  });
  mocks.getPolicy.mockResolvedValue({
    reservationMicros: 0,
    organizationLimitMicros: 100,
    projectLimitMicros: 75,
    noProviderFee: true,
    dailyRequestLimit: 100,
    minimumIntervalSeconds: 1,
    maxOutputTokens: 1024,
    digest: 'd',
  });
  mocks.transaction.mockImplementation(async (work: (session: unknown) => Promise<unknown>) =>
    work({})
  );
});

describe('attemptCompanyCredentialChat free tools', () => {
  it('prefers plain invoke for free greetings without the tool loop', async () => {
    mocks.invokeModel.mockResolvedValue({
      content: 'plain hello',
      model: 'local',
      inputTokens: 1,
      outputTokens: 2,
      latencyMs: 5,
      finishReason: 'stop',
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'hello',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
    });

    expect(mocks.toolLoop).not.toHaveBeenCalled();
    expect(mocks.invokeModel).toHaveBeenCalled();
    expect(turn).toMatchObject({ role: 'assistant', text: 'plain hello', noProviderFee: true });
  });

  it('uses the tool loop for free image-style asks', async () => {
    mocks.toolLoop.mockResolvedValue({
      content: 'drew something',
      toolCallsMade: ['image_generate'],
      artifacts: [],
      inputTokens: 1,
      outputTokens: 2,
      latencyMs: 5,
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'please generate an image of a cat',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
    });

    expect(mocks.toolLoop).toHaveBeenCalled();
    expect(mocks.toolLoop.mock.calls[0]?.[0]).toMatchObject({ includeImageTool: true });
    expect(turn).toMatchObject({ role: 'assistant', text: 'drew something', noProviderFee: true });
  });

  it('falls back to plain when free plain-first fails and tools also fail', async () => {
    mocks.invokeModel
      .mockRejectedValueOnce(new GatewayError('invalid_response'))
      .mockResolvedValue({
        content: 'plain local reply',
        model: 'local',
        inputTokens: 1,
        outputTokens: 2,
        latencyMs: 5,
        finishReason: 'stop',
      });
    mocks.toolLoop.mockRejectedValue(new GatewayError('invalid_response'));

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'hello',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
    });

    expect(mocks.toolLoop).toHaveBeenCalled();
    expect(mocks.invokeModel).toHaveBeenCalled();
    expect(mocks.webSearch).not.toHaveBeenCalled();
    expect(turn).toMatchObject({
      role: 'assistant',
      text: 'plain local reply',
      noProviderFee: true,
    });
  });

  it('prefers Nucleas web_search assist before the tool loop on factual lookups', async () => {
    mocks.webSearch.mockResolvedValue({
      query: 'who are the top 5 scorers for Arsenal all time?',
      note: 'Sparse.',
      hits: [{ title: 'Thierry Henry', url: 'https://example.com/h', snippet: '226 goals' }],
    });
    mocks.invokeModel.mockResolvedValue({
      content: 'Thierry Henry is Arsenal’s all-time top scorer.',
      model: 'local',
      inputTokens: 1,
      outputTokens: 2,
      latencyMs: 5,
      finishReason: 'stop',
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'who are the top 5 scorers for Arsenal all time?',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: false,
    });

    expect(mocks.toolLoop).not.toHaveBeenCalled();
    expect(mocks.webSearch).toHaveBeenCalled();
    expect(mocks.invokeModel).toHaveBeenCalled();
    const invokeArg = mocks.invokeModel.mock.calls[0]?.[1] as {
      messages: { role: string; content: string }[];
    };
    const userMsg = invokeArg.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).toMatch(/Web search results/);
    expect(userMsg).toMatch(/Thierry Henry/);
    expect(turn).toMatchObject({
      role: 'assistant',
      text: 'Thierry Henry is Arsenal’s all-time top scorer.',
      toolsUsed: expect.arrayContaining(['web_search', 'image_search']),
      noProviderFee: true,
    });
    expect(mocks.imageSearch).toHaveBeenCalled();
  });

  it('runs web + image assist for info digs that ask for screenshots without tool loop', async () => {
    mocks.webSearch.mockResolvedValue({
      query: 'Castlevania Revamped',
      note: 'From searxng.',
      hits: [
        {
          title: 'Castlevania ReVamped',
          url: 'https://www.inverteddungeon.com/index.php?section=fanworks&page=game_castlevania_revamped',
          snippet: 'Fan game',
          provider: 'searxng',
        },
      ],
      toolsUsed: ['web_search', 'web_fetch'],
      providersTried: ['searxng'],
      hitCount: 1,
      fetchCount: 1,
    });
    mocks.imageSearch.mockResolvedValue({
      query: 'Castlevania Revamped',
      note: 'Found 1.',
      hits: [
        {
          title: 'ReVamped screenshot',
          imageUrl: 'https://cdn.example.com/revamped.png',
          contextUrl: 'https://example.com/page',
          provider: 'searxng',
          snippet: 'Gameplay',
        },
      ],
      providersTried: ['searxng'],
      toolsUsed: ['image_search'],
      hitCount: 1,
    });
    mocks.invokeModel.mockResolvedValue({
      content: 'Castlevania ReVamped is a fan remake. Screenshot: https://cdn.example.com/revamped.png',
      model: 'local',
      inputTokens: 1,
      outputTokens: 2,
      latencyMs: 5,
      finishReason: 'stop',
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText:
        'find me as much information as possible about the game Castlevania Revamped, including screenshots',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: false,
    });

    expect(mocks.toolLoop).not.toHaveBeenCalled();
    expect(mocks.webSearch).toHaveBeenCalled();
    expect(mocks.imageSearch).toHaveBeenCalled();
    const invokeArg = mocks.invokeModel.mock.calls[0]?.[1] as {
      messages: { role: string; content: string }[];
    };
    const userMsg = invokeArg.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).toMatch(/Web search results/);
    expect(userMsg).toMatch(/Image search results/);
    expect(userMsg).toMatch(/cdn\.example\.com\/revamped\.png/);
    expect(turn).toMatchObject({
      role: 'assistant',
      toolsUsed: expect.arrayContaining(['web_search', 'image_search']),
      noProviderFee: true,
      artifacts: [
        expect.objectContaining({
          kind: 'image',
          url: 'https://cdn.example.com/revamped.png',
        }),
      ],
    });
  });

  it('resolves anaphoric follow-ups using prior user turns for search', async () => {
    mocks.webSearch.mockResolvedValue({
      query: 'Castlevania',
      note: 'ok',
      hits: [{ title: 'Castlevania ReVamped', url: 'https://example.com/c', snippet: 'Fan remake' }],
      toolsUsed: ['web_search'],
      providersTried: ['searxng'],
      hitCount: 1,
      fetchCount: 0,
    });
    mocks.invokeModel.mockResolvedValue({
      content: 'Found it — Castlevania ReVamped.',
      model: 'local',
      inputTokens: 1,
      outputTokens: 2,
      latencyMs: 5,
      finishReason: 'stop',
    });

    await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: "it's a fan remake, and it does exist. see if you can find it",
      priorTurns: [
        {
          role: 'user',
          text: 'find me as much information as possible about the game Castlevania Revamped, including screenshots',
        },
        { role: 'assistant', text: 'I could not find it.' },
      ],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: false,
    });

    expect(mocks.toolLoop).not.toHaveBeenCalled();
    const searchArg = String(mocks.webSearch.mock.calls[0]?.[0] ?? '');
    expect(searchArg).toMatch(/Castlevania Revamped/i);
  });

  it('retries plain invoke once after assist when the free host returns 504', async () => {
    mocks.webSearch.mockResolvedValue({
      query: 'who are the top 5 scorers for Arsenal all time?',
      note: 'Sparse.',
      hits: [{ title: 'Thierry Henry', url: 'https://example.com/h', snippet: '226 goals' }],
      toolsUsed: ['web_search'],
      providersTried: ['wikipedia'],
      hitCount: 1,
      fetchCount: 0,
    });
    mocks.invokeModel
      .mockRejectedValueOnce(new GatewayError('unavailable', { kind: 'http', httpStatus: 504 }))
      .mockResolvedValue({
        content: 'Thierry Henry leads.',
        model: 'local',
        inputTokens: 1,
        outputTokens: 2,
        latencyMs: 5,
        finishReason: 'stop',
      });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'who are the top 5 scorers for Arsenal all time?',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: false,
    });

    expect(mocks.invokeModel).toHaveBeenCalledTimes(2);
    expect(turn).toMatchObject({
      role: 'assistant',
      text: 'Thierry Henry leads.',
      toolsUsed: expect.arrayContaining(['web_search', 'image_search']),
      noProviderFee: true,
    });
  });

  it('skips proactive web_search assist when project repo tools are enabled', async () => {
    mocks.toolLoop.mockResolvedValue({
      content: 'From the repo rules system…',
      toolCallsMade: ['repo_tree', 'repo_read'],
      artifacts: [],
      inputTokens: 1,
      outputTokens: 2,
      latencyMs: 5,
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'who are the top 5 scorers for Arsenal all time?',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: true,
    });

    expect(mocks.webSearch).not.toHaveBeenCalled();
    expect(mocks.toolLoop).toHaveBeenCalled();
    expect(turn).toMatchObject({
      role: 'assistant',
      text: 'From the repo rules system…',
      toolsUsed: ['repo_tree', 'repo_read'],
      noProviderFee: true,
    });
  });

  it('uses Nucleas repo assist for project-internal rules questions on free credentials', async () => {
    mocks.repoAssist.mockResolvedValue({
      ok: true,
      okReads: 2,
      note: 'Read 2 file(s).',
      toolsUsed: ['repo_tree', 'repo_read'],
      contextBlock: 'Repository dig: task rules in IdeTaskRulesPanel',
      evidenceBlock: 'File loadTaskRules.ts:\nexport async function loadIdeTaskRuleTexts',
    });
    mocks.invokeModel.mockResolvedValue({
      content: 'Task rules live in IdeTaskRulesPanel and loadIdeTaskRuleTexts.',
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 5,
      finishReason: 'stop',
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'what does our rules system do and how exactly does it work?',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: true,
    });

    expect(mocks.webSearch).not.toHaveBeenCalled();
    expect(mocks.repoAssist).toHaveBeenCalled();
    expect(mocks.toolLoop).not.toHaveBeenCalled();
    expect(mocks.invokeModel).toHaveBeenCalled();
    expect(turn).toMatchObject({
      role: 'assistant',
      toolsUsed: ['repo_tree', 'repo_read'],
      noProviderFee: true,
      costMicros: 0,
    });
  });

  it('skips proactive repo assist when repoContextBlock is provided', async () => {
    mocks.toolLoop.mockResolvedValue({
      content: 'IDE context loads via chatHistory.',
      toolCallsMade: ['repo_read'],
      artifacts: [],
      inputTokens: 1,
      outputTokens: 2,
      latencyMs: 1,
    });

    await attemptCompanyCredentialChat({
      systemPrompt: 'Worker stage.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'how do we handle context in our IDE?',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: true,
      forceToolLoop: true,
      repoContextBlock: 'File chatHistory.ts:\nexport async function loadIdeChatHistory',
    });

    expect(mocks.repoAssist).not.toHaveBeenCalled();
    expect(mocks.toolLoop).toHaveBeenCalled();
  });

  it('falls back to the tool loop for project-internal asks when repo assist fails', async () => {
    mocks.toolLoop.mockResolvedValue({
      content: 'Task rules live in IdeTaskRulesPanel and loadIdeTaskRuleTexts.',
      toolCallsMade: ['repo_tree', 'repo_read'],
      artifacts: [],
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 5,
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'what does our rules system do and how exactly does it work?',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: true,
    });

    expect(mocks.webSearch).not.toHaveBeenCalled();
    expect(mocks.toolLoop).toHaveBeenCalled();
    expect(turn).toMatchObject({
      role: 'assistant',
      toolsUsed: ['repo_tree', 'repo_read'],
      noProviderFee: true,
      costMicros: 0,
    });
  });

  it('forces the tool loop for orchestra-wrapped Worker text over 500 chars', async () => {
    mocks.toolLoop.mockResolvedValue({
      content: 'Rules are stored as project task rules and injected into prompts.',
      toolCallsMade: ['repo_tree', 'repo_read'],
      artifacts: [],
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 5,
    });

    const wrapped = [
      'User request:',
      'what does our rules system actually do and how does it work?',
      '',
      'Planner briefing / jobs:',
      'Dig the repo thoroughly. '.repeat(40),
    ].join('\n');
    expect(wrapped.length).toBeGreaterThan(500);

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: wrapped,
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: true,
    });

    expect(mocks.invokeModel).not.toHaveBeenCalled();
    expect(mocks.toolLoop).toHaveBeenCalled();
    expect(turn).toMatchObject({
      role: 'assistant',
      toolsUsed: ['repo_tree', 'repo_read'],
      noProviderFee: true,
    });
  });

  it('retries with a larger token budget after empty_content finishReason=length', async () => {
    mocks.toolLoop.mockRejectedValue(
      new GatewayError('invalid_response', {
        kind: 'empty_content',
        finishReason: 'length',
        contentChars: 0,
        hasToolCalls: false,
        hasReasoning: false,
      })
    );
    mocks.invokeModel.mockResolvedValue({
      content: '```nucleas-plan\n{"title":"Blog","summary":"Add a blog","steps":["IA","UX"]}\n```',
      inputTokens: 10,
      outputTokens: 200,
      latencyMs: 5,
      finishReason: 'stop',
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'Planner stage.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'Plan a blog for Playbound with UX mockups.',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: true,
      forceToolLoop: true,
      maxOutputTokensOverride: 8192,
    });

    expect(turn.role).toBe('assistant');
    expect(turn.text).toMatch(/nucleas-plan|Blog/);
    expect(mocks.invokeModel).toHaveBeenCalled();
    const invokeArg = mocks.invokeModel.mock.calls.at(-1)?.[1] as { maxOutputTokens?: number };
    // Even the length retry remains within one quarter of this deployment's context window.
    expect(invokeArg.maxOutputTokens).toBeLessThanOrEqual(4096);
  });

  it('forces the tool loop when forceToolLoop is set even for short non-lookup asks', async () => {
    mocks.toolLoop.mockResolvedValue({
      content: 'Noted.',
      toolCallsMade: ['repo_tree'],
      artifacts: [],
      inputTokens: 5,
      outputTokens: 5,
      latencyMs: 3,
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'thanks',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: true,
      forceToolLoop: true,
    });

    expect(mocks.invokeModel).not.toHaveBeenCalled();
    expect(mocks.toolLoop).toHaveBeenCalled();
    expect(turn).toMatchObject({ role: 'assistant', toolsUsed: ['repo_tree'] });
  });

  it('retries assist when tools fail with a non-GatewayError on a factual lookup', async () => {
    mocks.webSearch
      .mockRejectedValueOnce(new Error('search briefly unavailable'))
      .mockResolvedValue({
        query: 'who won the latest champions league final?',
        note: 'Sparse.',
        hits: [{ title: 'Final', url: 'https://example.com/f', snippet: 'Result' }],
      });
    mocks.invokeModel
      .mockRejectedValueOnce(new GatewayError('invalid_response'))
      .mockResolvedValue({
        content: 'Grounded from Nucleas search.',
        model: 'local',
        inputTokens: 1,
        outputTokens: 2,
        latencyMs: 5,
        finishReason: 'stop',
      });
    mocks.toolLoop.mockRejectedValue(new Error('unexpected tool schema'));

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'who won the latest champions league final?',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: false,
    });

    expect(mocks.toolLoop).toHaveBeenCalled();
    expect(mocks.webSearch).toHaveBeenCalledTimes(2);
    expect(turn).toMatchObject({
      role: 'assistant',
      text: 'Grounded from Nucleas search.',
      toolsUsed: expect.arrayContaining(['web_search', 'image_search']),
      noProviderFee: true,
    });
    expect(turn.text).not.toMatch(/model call failed/i);
  });

  it('degrades to plain knowledge when Nucleas search throws on a lookup', async () => {
    mocks.webSearch.mockRejectedValue(new Error('ddg unavailable'));
    mocks.invokeModel.mockResolvedValue({
      content: 'Answer from model knowledge.',
      model: 'local',
      inputTokens: 1,
      outputTokens: 2,
      latencyMs: 5,
      finishReason: 'stop',
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'who are the top 5 scorers for Arsenal all time?',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
      includeRepoTools: false,
    });

    expect(mocks.toolLoop).not.toHaveBeenCalled();
    expect(turn).toMatchObject({
      role: 'assistant',
      text: 'Answer from model knowledge.',
      noProviderFee: true,
    });
    expect(turn.text).not.toMatch(/model call failed/i);
  });

  it('retries plain invokeModel when free tools fail with a non-GatewayError', async () => {
    mocks.invokeModel
      .mockRejectedValueOnce(new GatewayError('invalid_response'))
      .mockResolvedValue({
        content: 'plain after unknown tool failure',
        model: 'local',
        inputTokens: 1,
        outputTokens: 2,
        latencyMs: 5,
        finishReason: 'stop',
      });
    mocks.toolLoop.mockRejectedValue(new Error('unexpected tool schema'));

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'hello',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
    });

    expect(mocks.toolLoop).toHaveBeenCalled();
    expect(mocks.invokeModel).toHaveBeenCalled();
    expect(turn).toMatchObject({
      role: 'assistant',
      text: 'plain after unknown tool failure',
      noProviderFee: true,
    });
  });

  it('uses host-focused invalid_response copy when free tools and plain both fail', async () => {
    mocks.toolLoop.mockRejectedValue(new GatewayError('invalid_response'));
    mocks.invokeModel.mockRejectedValue(new GatewayError('invalid_response'));

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'hello',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
    });

    expect(turn).toMatchObject({
      role: 'status',
      failureCategory: 'invalid_response',
      noProviderFee: true,
    });
    expect(turn.debugHint).toMatch(/code=invalid_response/);
    expect(turn.text).toMatch(/invalid response/i);
    expect(turn.text).not.toMatch(/commercial/i);
    expect(turn.text).not.toMatch(/image generation/i);
  });

  it('uses clearer unavailable copy when the free host fails after tool retry', async () => {
    mocks.toolLoop.mockRejectedValue(new GatewayError('unavailable'));
    mocks.invokeModel.mockRejectedValue(new GatewayError('unavailable'));

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'hello',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'local',
    });

    expect(turn).toMatchObject({
      role: 'status',
      failureCategory: 'unavailable',
    });
    expect(turn.text).toMatch(/Local model request failed/);
    expect(turn.text).toMatch(/diagnostic details/);
  });
});

describe('attemptCompanyCredentialChat commercial', () => {
  beforeEach(() => {
    mocks.gatewayFromProfile.mockResolvedValue({
      gateway: {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        bearerToken: 'tok',
        model: 'gpt',
        protocol: 'openai-chat',
        timeoutMs: 60000,
      },
      profile: { provider: 'openai', tier: 'commercial' },
    });
    mocks.getPolicy.mockResolvedValue({
      reservationMicros: 25,
      organizationLimitMicros: 100,
      projectLimitMicros: 75,
      noProviderFee: true,
      dailyRequestLimit: 100,
      minimumIntervalSeconds: 1,
      maxOutputTokens: 1024,
      digest: 'd',
    });
  });

  it('ignores platform noProviderFee for commercial credentials', async () => {
    mocks.toolLoop.mockResolvedValue({
      content: 'paid reply',
      toolCallsMade: [],
      artifacts: [],
      inputTokens: 1,
      outputTokens: 2,
      latencyMs: 5,
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'hello',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'gpt',
    });

    expect(turn).toMatchObject({
      role: 'assistant',
      text: 'paid reply',
      noProviderFee: false,
      reservedMicros: 25,
    });
  });

  it('settles paid turns with list-price estimates when usage is known', async () => {
    mocks.gatewayFromProfile.mockResolvedValue({
      gateway: {
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        bearerToken: 'tok',
        model: 'openai/gpt-5.6-sol',
        protocol: 'openai-chat',
        timeoutMs: 60000,
      },
      profile: { provider: 'openrouter', tier: 'commercial' },
    });
    mocks.toolLoop.mockResolvedValue({
      content: 'sol reply',
      toolCallsMade: [],
      artifacts: [],
      inputTokens: 10_000,
      outputTokens: 2_000,
      latencyMs: 5,
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'hello',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'openai/gpt-5.6-sol',
    });

    // 10k * $4/1M + 2k * $20/1M = $0.04 + $0.04 = $0.08 = 80_000 micros
    expect(turn).toMatchObject({
      role: 'assistant',
      text: 'sol reply',
      noProviderFee: false,
      costMicros: 80_000,
    });
  });

  it('retries plain invokeModel when the tool loop fails', async () => {
    mocks.toolLoop.mockRejectedValue(new GatewayError('unavailable'));
    mocks.invokeModel.mockResolvedValue({
      content: 'plain paid reply',
      model: 'gpt',
      inputTokens: 1,
      outputTokens: 2,
      latencyMs: 5,
      finishReason: 'stop',
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'hello',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'gpt',
    });

    expect(mocks.toolLoop).toHaveBeenCalled();
    expect(mocks.invokeModel).toHaveBeenCalled();
    expect(mocks.repoAssist).not.toHaveBeenCalled();
    expect(turn).toMatchObject({
      role: 'assistant',
      text: 'plain paid reply',
      noProviderFee: false,
    });
  });

  it('uses Nucleas repo assist after commercial tool-loop failure on project-internal asks', async () => {
    mocks.toolLoop.mockRejectedValue(new GatewayError('unavailable'));
    mocks.repoAssist.mockResolvedValue({
      ok: true,
      okReads: 3,
      note: 'Read 3 file(s).',
      toolsUsed: ['repo_tree', 'repo_read'],
      contextBlock: 'Repository dig: loadTaskRules injects rule texts',
      evidenceBlock: 'File loadTaskRules.ts:\nexport async function loadIdeTaskRuleTexts',
    });
    mocks.invokeModel.mockResolvedValue({
      content: 'Rules are prompt-injected project docs loaded by loadIdeTaskRuleTexts.',
      model: 'gpt',
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 5,
      finishReason: 'stop',
    });

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'how does our rules system work exactly?',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'gpt',
      includeRepoTools: true,
    });

    expect(mocks.toolLoop).toHaveBeenCalled();
    expect(mocks.repoAssist).toHaveBeenCalled();
    expect(mocks.invokeModel).toHaveBeenCalled();
    const invokeArg = mocks.invokeModel.mock.calls[0]?.[1] as {
      messages?: { role: string; content: string }[];
    };
    const system = String(invokeArg?.messages?.[0]?.content ?? '');
    expect(system).toMatch(/Do not claim tools failed/i);
    expect(system).not.toMatch(/Tools failed on this host/i);
    expect(turn).toMatchObject({
      role: 'assistant',
      toolsUsed: ['repo_tree', 'repo_read'],
      noProviderFee: false,
    });
  });

  it('surfaces unavailable when tools and plain both fail', async () => {
    mocks.toolLoop.mockRejectedValue(new GatewayError('unavailable'));
    mocks.invokeModel.mockRejectedValue(new GatewayError('unavailable'));

    const turn = await attemptCompanyCredentialChat({
      systemPrompt: 'You are helpful.',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'a'.repeat(24),
      userText: 'hello',
      priorTurns: [],
      modelProfileId: 'b'.repeat(24),
      model: 'gpt',
    });

    expect(turn).toMatchObject({
      role: 'status',
      failureCategory: 'unavailable',
      text: 'The remote model endpoint was unreachable or returned an error.',
      noProviderFee: false,
    });
  });
});
