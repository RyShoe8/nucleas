import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const mocks = vi.hoisted(() => ({
  companyChat: vi.fn(),
  repoDig: vi.fn(),
  selectModel: vi.fn(),
  findObjectives: vi.fn(),
  findRuns: vi.fn(),
  readSettings: vi.fn(),
  execute: vi.fn(),
  listModels: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/companyChat', () => ({
  attemptCompanyCredentialChat: (...args: unknown[]) => mocks.companyChat(...args),
}));
vi.mock('@/lib/ai/engine/catalog', () => ({
  listAvailableModels: (...args: unknown[]) => mocks.listModels(...args),
  outputBudgetTokens: (_context: number, requested: number) => requested,
  contextBudgetChars: () => 48_000,
}));
vi.mock('@/lib/ai/engine/select', () => ({
  readEngineSettings: async () => ({ defaultCostLevel: 'low', priceCeilings: { low: 1.5, medium: 5, high: null }, pins: {} }),
  selectModel: (...args: unknown[]) => mocks.selectModel(...args),
}));
vi.mock('@/lib/models/AiControl', () => ({
  AiBudget: {},
  AiDispatchLock: {},
  AiObjective: {
    find: (...args: unknown[]) => mocks.findObjectives(...args),
  },
  AiRun: {
    find: (...args: unknown[]) => mocks.findRuns(...args),
  },
  AiRunEvent: {},
}));
vi.mock('@/lib/ai/control/settings', () => ({
  readSettings: (...args: unknown[]) => mocks.readSettings(...args),
  platformSettingsId: () => 'platform',
}));
vi.mock('@/lib/ai/control/config', () => ({
  getChatInferencePolicy: vi.fn(),
  getPipelineInferencePolicy: vi.fn().mockResolvedValue({
    reservationMicros: 1000,
    organizationLimitMicros: 100000,
    projectLimitMicros: 50000,
  }),
}));
vi.mock('@/lib/ai/repo/snapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/repo/snapshot')>()),
  getRepoSnapshot: (...args: unknown[]) => mocks.snapshot(...args),
}));
vi.mock('@/lib/ai/tools/serverRepoAssist', () => ({
  gatherRepoAssistContext: (...args: unknown[]) => mocks.repoDig(...args),
}));
vi.mock('@/lib/ai/rolePipeline/profiles', () => ({
  gatewayFromModelProfile: async (profileId: string, model: string) => ({
    gateway: { endpoint: `https://${profileId}.test/v1/chat/completions`, bearerToken: 'key', model, protocol: 'openai-chat' },
    profile: { id: profileId },
  }),
}));
vi.mock('@/lib/ai/executionWorkerClient', () => ({
  executeInRemoteSandbox: (...args: unknown[]) => mocks.execute(...args),
}));

import { attemptOrchestratedIdeReply, distillPlannerBriefing, isTrivialTeamChatRequest } from '@/lib/ai/teamChat';
import { buildEvidencePack } from '@/lib/ai/repo/evidencePack';
/** A complete plan, as the Planner is now required to write it. */
const structuredPlan = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  title: 'Blog', summary: 'Add blog', symptom: 'The site has no blog.',
  path: [{ file: 'app/routes.ts', line: 1, note: 'declares the routes' }],
  rootCause: { explanation: '1. Routes are declared in one file. 2. There is no blog route.', evidence: [{ file: 'app/routes.ts', line: 1, quote: 'export const routes = []' }] },
  filesToChange: ['app/routes.ts'], expectedResult: 'A /blog page appears because app/routes.ts:1 now lists it.',
  sideEffects: [], unverified: [], outOfScope: [], steps: ['Add routes in app/routes.ts'], ...overrides,
});
const PLAN_FENCE = `\`\`\`nucleas-plan\n${structuredPlan()}\n\`\`\``;


function leanChain(result: unknown) {
  return {
    select: () => ({
      sort: () => ({
        limit: () => ({
          maxTimeMS: () => ({
            lean: async () => result,
          }),
        }),
      }),
      maxTimeMS: () => ({
        lean: async () => result,
      }),
    }),
  };
}

const readySettings = {
  planningEnabled: true,
  remoteEnabled: true,
  dispatchEnabled: true,
  protocol: 'openai-chat' as const,
  endpoint: 'https://llm.rogly.net/v1/chat/completions',
  model: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ',
  noProviderFee: false,
  dailyRequestLimit: 48,
  minimumIntervalSeconds: 300,
  maxOutputTokens: 2048,
  reservationMicros: 1000,
  organizationLimitMicros: 100000,
  projectLimitMicros: 50000,
  freePoolLimitMicros: 0,
  freePoolRemainingMicros: 0,
};

describe('attemptOrchestratedIdeReply full orchestra', () => {
  const plannerId = 'a'.repeat(24);
  const workerId = 'b'.repeat(24);
  const reviewerId = 'c'.repeat(24);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshot.mockResolvedValue({ ok: false, reason: 'no snapshot' });
    mocks.repoDig.mockResolvedValue({
      ok: true,
      okReads: 2,
      note: 'Read 2 file(s).',
      toolsUsed: ['repo_tree', 'repo_read'],
      contextBlock: 'File loadTaskRules.ts:\nexport async function loadIdeTaskRuleTexts',
      evidenceBlock: 'File loadTaskRules.ts:\nexport async function loadIdeTaskRuleTexts',
    });
    mocks.readSettings.mockResolvedValue({ value: readySettings });
    mocks.execute.mockResolvedValue(null);
    mocks.listModels.mockResolvedValue([]);
    mocks.findObjectives.mockReturnValue(leanChain([]));
    mocks.findRuns.mockReturnValue(leanChain([]));
    // The engine picks: planner for plan, reviewer for review, worker for the work itself.
    mocks.selectModel.mockImplementation(async (_org: string, need: string) => ({
      primary:
        need === 'plan'
          ? { profileId: plannerId, model: 'sol', free: false, label: 'paid' }
          : need === 'review'
            ? { profileId: reviewerId, model: 'sol-review', free: false, label: 'paid' }
            : { profileId: workerId, model: 'qwen', free: true, label: 'Rogly' },
      fallback: null,
    }));
  });

  it.each(['worker', 'reviewer'] as const)('preserves an unverified draft when %s fails without making it approvable', async failedStage => {
    const draft = `Blog layout and integration. ${'detail '.repeat(1000)}End-of-briefing acceptance checks.\n${PLAN_FENCE}`;
    mocks.companyChat.mockResolvedValueOnce({ requestId: 'p', role: 'assistant', text: draft, costMicros: 74000 });
    if (failedStage === 'reviewer') mocks.companyChat.mockResolvedValueOnce({ requestId: 'w', role: 'assistant', text: 'Verified routes.', costMicros: 0 });
    mocks.companyChat.mockResolvedValueOnce({ requestId: 'failed', role: 'status', text: 'Gateway returned HTTP 504.', failureCategory: 'unavailable', debugHint: 'httpStatus=504', costMicros: 0 });
    const turn = await attemptOrchestratedIdeReply({ projectName: 'Playbound', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'u'.repeat(24), userText: 'plan a blog', priorTurns: [], interactionMode: 'plan' });
    expect(turn.role).toBe('status');
    expect(turn.plan).toBeUndefined();
    expect(turn.text).toContain('Planner draft preserved');
    expect(turn.text).toContain('Blog layout and integration');
    expect(turn.text).toContain('504');
    expect(turn.text).not.toContain('```nucleas-plan');
    expect(turn.debugHint).toBe('httpStatus=504');
    expect(turn.costMicros).toBe(74000);
    expect(mocks.companyChat).toHaveBeenCalledTimes(failedStage === 'worker' ? 2 : 3);
    expect(mocks.companyChat.mock.calls[1][0].userText).toContain('End-of-briefing acceptance checks');
    expect(mocks.companyChat.mock.calls[1][0].stopOnUpstreamFailure).toBe(true);
  });

  it.each([true, false])('only exposes a plan when the reviewer accepts: %s', async accept => {
    mocks.companyChat.mockImplementation(async ({ systemPrompt }: { systemPrompt: string }) => ({
      requestId: 'stage', role: 'assistant', costMicros: 1,
      text: systemPrompt.includes('Pipeline stage: planner')
        ? `Draft blog\n${PLAN_FENCE}`
        : systemPrompt.includes('Pipeline stage: worker') ? 'Read routes.'
          : accept ? 'Verified.\n```nucleas-gate\n{"status":"accept"}\n```'
            : 'Need evidence.\n```nucleas-gate\n{"status":"needs_more","jobs":["Read routes"]}\n```',
    }));
    const turn = await attemptOrchestratedIdeReply({ projectName: 'Playbound', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'a'.repeat(24), userText: 'plan a blog', priorTurns: [], interactionMode: 'plan' });
    if (accept) expect(turn.plan?.status).toBe('ready_for_review');
    else expect(turn.plan).toBeUndefined();
    expect(mocks.companyChat).toHaveBeenCalledTimes(accept ? 3 : 7);
  });

  it('runs planner → worker → reviewer on chat and returns the reviewer reply', async () => {
    const stages: string[] = [];
    mocks.companyChat
      .mockImplementationOnce(async () => {
        stages.push('planner');
        return {
          requestId: '1',
          role: 'assistant',
          text: 'Dig into rules system paths.',
          toolsUsed: ['repo_tree'],
          costMicros: 100,
          reservedMicros: 0,
          noProviderFee: false,
        };
      })
      .mockImplementationOnce(async () => {
        stages.push('worker');
        return {
          requestId: '2',
          role: 'assistant',
          text: 'Found IdeTaskRulesPanel and loadIdeTaskRuleTexts.',
          toolsUsed: ['repo_read'],
          costMicros: 0,
          reservedMicros: 0,
          noProviderFee: true,
        };
      })
      .mockImplementationOnce(async () => {
        stages.push('reviewer');
        return {
          requestId: '3',
          role: 'assistant',
          text: 'Here is how the rules system works…\n```nucleas-gate\n{"status":"accept"}\n```',
          toolsUsed: [],
          costMicros: 80,
          reservedMicros: 0,
          noProviderFee: false,
        };
      });

    const onStage = vi.fn();
    const turn = await attemptOrchestratedIdeReply({
      projectName: 'Nucleas',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'u'.repeat(24),
      userText: 'how does our rules system work?',
      priorTurns: [],
      interactionMode: 'chat',
      onStage,
    });

    expect(stages).toEqual(['planner', 'worker', 'reviewer']);
    expect(mocks.companyChat).toHaveBeenCalledTimes(3);
    expect(turn.role).toBe('assistant');
    expect(turn.text.startsWith('Here is how the rules system works…')).toBe(true);
    expect(turn.text).toContain('**Tools used**');
    expect(turn.toolsUsed).toEqual(['repo_tree', 'repo_read']);
    expect(turn.costMicros).toBe(180);
    expect(onStage.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ['planner', 'start'],
      ['planner', 'end'],
      ['worker', 'start'],
      ['worker', 'end'],
      ['reviewer', 'start'],
      ['reviewer', 'end'],
    ]);
    expect(mocks.repoDig).toHaveBeenCalledTimes(1);
    const [plannerCall, workerCall, reviewerCall] = mocks.companyChat.mock.calls;
    expect(plannerCall[0]).toMatchObject({
      repoContextBlock: expect.stringContaining('loadTaskRules'),
    });
    expect(workerCall[0].repoContextBlock).toContain('loadTaskRules');
    expect(reviewerCall[0].repoContextBlock).toBeUndefined();
  });

  it('preserves accepted repository work when the free planner misses only the plan envelope', async () => {
    mocks.companyChat.mockImplementation(async ({ systemPrompt }: { systemPrompt: string }) => ({
      requestId: 'stage', role: 'assistant', costMicros: 0,
      text: systemPrompt.includes('Pipeline stage: planner')
        ? 'Inspect the game-server recipes and remove the nested OpenHV registration.'
        : systemPrompt.includes('Pipeline stage: worker')
          ? 'Verified platform/src/lib/gameHost/recipes.js registers OpenHV both standalone and beneath OpenRA.'
          : 'The findings support this focused change.\n```nucleas-gate\n{"status":"accept"}\n```',
    }));
    const request = 'On playbound.club/admin/connect/game-servers, remove the OpenHV listing under OpenRA.';
    const turn = await attemptOrchestratedIdeReply({ projectName: 'PlayBound', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'a'.repeat(24), userText: request, priorTurns: [], interactionMode: 'plan' });
    expect(turn.plan).toMatchObject({ status: 'ready_for_review', summary: request });
    expect(turn.plan?.markdown).toContain('platform/src/lib/gameHost/recipes.js');
  });

  it('retries a malformed Reviewer gate without repeating repository work', async () => {
    const stages: string[] = [];
    mocks.companyChat.mockImplementation(async (args: { systemPrompt: string; userText: string }) => {
      if (args.systemPrompt.includes('Pipeline stage: planner')) {
        stages.push('planner');
        return { requestId: 'p', role: 'assistant', text: 'Inspect the duplicate listing.', costMicros: 1 };
      }
      if (args.systemPrompt.includes('Pipeline stage: worker')) {
        stages.push('worker');
        return { requestId: 'w', role: 'assistant', text: 'Read recipes.js and page.tsx; OpenHV is duplicated.', toolsUsed: ['repo_read'], costMicros: 0 };
      }
      stages.push('reviewer');
      if (stages.filter(stage => stage === 'reviewer').length === 1) {
        return { requestId: 'r1', role: 'assistant', text: 'The evidence supports removing only the nested listing.', costMicros: 1 };
      }
      expect(args.userText).toContain('failed the response contract (missing_gate_fence)');
      return { requestId: 'r2', role: 'assistant', text: 'Remove only the nested listing.\n```nucleas-gate\n{"status":"accept"}\n```', costMicros: 1 };
    });

    const turn = await attemptOrchestratedIdeReply({ projectName: 'Playbound', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'u'.repeat(24), userText: 'remove the duplicate OpenHV listing', priorTurns: [], interactionMode: 'chat' });

    expect(stages).toEqual(['planner', 'worker', 'reviewer', 'reviewer']);
    expect(turn.text.startsWith('Remove only the nested listing.')).toBe(true);
    expect(turn.text).toContain('**Tools used**');
  });

  it('on needs_more runs another Worker pass then accepts', async () => {
    const stages: string[] = [];
    mocks.companyChat.mockImplementation(async (args: { systemPrompt: string; userText: string }) => {
      if (args.systemPrompt.includes('Pipeline stage: planner')) {
        stages.push('planner');
        return {
          requestId: 'p',
          role: 'assistant',
          text: 'Dig history and rules.',
          toolsUsed: [],
          costMicros: 10,
          reservedMicros: 0,
          noProviderFee: false,
        };
      }
      if (args.systemPrompt.includes('Pipeline stage: worker')) {
        stages.push('worker');
        const continuePass = /needs_more/i.test(args.userText);
        return {
          requestId: continuePass ? 'w2' : 'w1',
          role: 'assistant',
          text: continuePass
            ? 'Quoted chatHistory appendIdeChatTurns persists user+assistant turns.'
            : 'Only saw rules panel.',
          toolsUsed: ['repo_read'],
          costMicros: 5,
          reservedMicros: 0,
          noProviderFee: true,
        };
      }
      stages.push('reviewer');
      const pass = stages.filter((s) => s === 'reviewer').length;
      if (pass === 1) {
        return {
          requestId: 'r1',
          role: 'assistant',
          text: [
            'Need history persistence evidence.',
            '```nucleas-gate',
            '{"status":"needs_more","jobs":["read src/lib/ide/chatHistory.ts and quote appendIdeChatTurns"],"reason":"no history"}',
            '```',
          ].join('\n'),
          toolsUsed: [],
          costMicros: 8,
          reservedMicros: 0,
          noProviderFee: false,
        };
      }
      return {
        requestId: 'r2',
        role: 'assistant',
        text: [
          'Chat history is stored via appendIdeChatTurns in chatHistory.ts.',
          '```nucleas-gate',
          '{"status":"accept"}',
          '```',
        ].join('\n'),
        toolsUsed: [],
        costMicros: 8,
        reservedMicros: 0,
        noProviderFee: false,
      };
    });

    const turn = await attemptOrchestratedIdeReply({
      projectName: 'Nucleas',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'u'.repeat(24),
      userText: 'how do we store context in our IDE?',
      priorTurns: [],
      interactionMode: 'chat',
    });

    expect(stages).toEqual(['planner', 'worker', 'reviewer', 'worker', 'reviewer']);
    expect(turn.role).toBe('assistant');
    expect(turn.text.startsWith('Chat history is stored via appendIdeChatTurns in chatHistory.ts.')).toBe(true);
    expect(turn.text).toContain('**Tools used**');
    expect(turn.text).not.toMatch(/nucleas-gate/);
    expect(turn.toolsUsed).toEqual(['repo_read']);
    expect(turn.costMicros).toBe(10 + 5 + 8 + 5 + 8);
  });

  it('skips worker and later stages when aborted after planner', async () => {
    const controller = new AbortController();
    mocks.companyChat.mockImplementation(async (args: { systemPrompt: string }) => {
      if (args.systemPrompt.includes('Pipeline stage: planner')) {
        controller.abort();
        return {
          requestId: 'p',
          role: 'assistant',
          text: 'Briefing only',
          toolsUsed: [],
          costMicros: 10,
          reservedMicros: 0,
          noProviderFee: false,
          runId: 'r'.repeat(24),
        };
      }
      throw new Error('should not start later stages');
    });

    const turn = await attemptOrchestratedIdeReply({
      projectName: 'Nucleas',
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'u'.repeat(24),
      userText: 'plan a blog',
      priorTurns: [],
      interactionMode: 'plan',
      signal: controller.signal,
    });

    expect(mocks.companyChat).toHaveBeenCalledTimes(1);
    expect(turn.role).toBe('status');
    expect(turn.failureCategory).toBe('cancelled');
    expect(turn.text).toMatch(/cancelled/i);
  });

  it('will not accept a "nothing found" report while files mentioning the request terms were never examined', async () => {
    mocks.snapshot.mockResolvedValue({ ok: true, snapshot: { files: new Map([
      ['platform/src/lib/data/games.ts', 'export const games = ["OpenRA", "OpenHV"];'],
      ['platform/src/lib/gameHost/mods.ts', "export const openra = { mods: ['ra', 'OpenHV'] };"],
    ]) } });
    const calls: { stage: string; userText: string }[] = [];
    let workerRuns = 0;
    mocks.companyChat.mockImplementation(async (args: { systemPrompt: string; userText: string }) => {
      const stage = args.systemPrompt.match(/Pipeline stage: (planner|worker|reviewer)/)![1];
      calls.push({ stage, userText: args.userText });
      if (stage === 'planner') return { requestId: 'p', role: 'assistant', text: 'Find the nested listing.', toolsUsed: ['repo_search'], costMicros: 0 };
      if (stage === 'worker') {
        workerRuns += 1;
        return { requestId: 'w', role: 'assistant', toolsUsed: ['repo_search', 'repo_read'], costMicros: 0,
          text: workerRuns === 1 ? 'Read platform/src/lib/data/games.ts. No nested OpenHV entry found under OpenRA, so no change is necessary.' : 'platform/src/lib/gameHost/mods.ts lists OpenHV under OpenRA mods; remove it there.' };
      }
      return { requestId: 'r', role: 'assistant', text: 'Looks fine.\n```nucleas-gate\n{"status":"accept"}\n```', costMicros: 0 };
    });

    const turn = await attemptOrchestratedIdeReply({ projectName: 'PlayBound', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'a'.repeat(24), userText: 'OpenHV is listed on its own and also under OpenRA. Remove the listing under OpenRA.', priorTurns: [], interactionMode: 'chat' });

    expect(calls.map((c) => c.stage)).toEqual(['planner', 'worker', 'reviewer', 'worker', 'reviewer']);
    expect(calls[3].userText).toContain('Read platform/src/lib/gameHost/mods.ts');
    expect(turn.text.startsWith('Looks fine.')).toBe(true);
    expect(turn.text).not.toContain('Nucleas check'); // the second pass covered the file, so no warning
  });

  it('shows which tools each stage used and warns about a model that never looked at the repository', async () => {
    mocks.companyChat.mockImplementation(async (args: { systemPrompt: string }) => {
      const stage = args.systemPrompt.match(/Pipeline stage: (planner|worker|reviewer)/)![1];
      return { requestId: stage, role: 'assistant', costMicros: 0, toolsUsed: stage === 'planner' ? ['repo_search', 'repo_read'] : [],
        text: stage === 'reviewer' ? 'Answer.\n```nucleas-gate\n{"status":"accept"}\n```' : 'Some text.' };
    });
    const turn = await attemptOrchestratedIdeReply({ projectName: 'PlayBound', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'a'.repeat(24), userText: 'explain the rules system', priorTurns: [], interactionMode: 'chat' });
    expect(turn.text).toMatch(/- Planner \(.*\): repo_search, repo_read/);
    expect(turn.text).toMatch(/- Worker \(.*\): none ⚠ no repository tools/);
    expect(turn.text).toContain('never called a repository tool');
    expect(turn.stageTools?.map((r) => r.stage)).toEqual(['planner', 'worker', 'reviewer']);
  });

  it('puts a failed definition of done in front of the Reviewer and in the final reply', async () => {
    mocks.execute.mockResolvedValue({
      protocolVersion: 1, requestId: '123e4567-e89b-12d3-a456-426614174000', artifactId: 'd'.repeat(24),
      routing: { requestedModel: 'qwen', providerReportedModels: [] },
      status: 'completed', summary: 'Implemented the feature.', baseCommit: 'a'.repeat(40),
      patch: 'diff --git a/a.ts b/a.ts\n+export const ready: number = "no";', changedFiles: ['a.ts'],
      evidence: [
        { command: ['npm', 'test'], exitCode: 0, timedOut: false, output: 'passed' },
        { command: ['npm', 'run', 'typecheck'], exitCode: 2, timedOut: false, output: "a.ts(1,32): error TS2322: Type 'string' is not assignable to type 'number'.", kind: 'definition_of_done' },
      ], limitations: [],
    });
    mocks.companyChat
      .mockResolvedValueOnce({ requestId: 'p', role: 'assistant', text: 'Implement the feature.', costMicros: 0 })
      .mockResolvedValueOnce({ requestId: 'r', role: 'assistant', text: 'Accepted.\n```nucleas-gate\n{"status":"accept"}\n```', costMicros: 0 });

    const turn = await attemptOrchestratedIdeReply({ projectName: 'Nucleas', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'a'.repeat(24), userText: 'build the feature', priorTurns: [], interactionMode: 'build' });

    expect(mocks.companyChat.mock.calls[1][0].userText).toContain('Definition of done: FAILED');
    expect(mocks.companyChat.mock.calls[1][0].userText).toContain('error TS2322');
    expect(turn.text).toContain('**Nucleas check:** Definition of done: FAILED');
    expect(turn.text).not.toContain('npm run typecheck: exit 2'); // shown once, as the check, not as a model command
  });

  it('uses the isolated executor for Build mode and gives its evidence to the reviewer', async () => {
    mocks.execute.mockResolvedValue({
      protocolVersion: 1, requestId: '123e4567-e89b-12d3-a456-426614174000', artifactId: 'd'.repeat(24),
      routing: { requestedModel: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', providerReportedModels: ['hosted_vllm/Qwen/Qwen2.5-Coder-14B-Instruct-AWQ'] },
      status: 'completed', summary: 'Implemented the feature.', baseCommit: 'a'.repeat(40),
      patch: 'diff --git a/a.ts b/a.ts\n+export const ready = true;', changedFiles: ['a.ts'],
      evidence: [{ command: ['npm', 'test'], exitCode: 0, timedOut: false, output: 'passed' }], limitations: [],
    });
    mocks.companyChat
      .mockResolvedValueOnce({ requestId: 'p', role: 'assistant', text: 'Implement the feature.', costMicros: 10 })
      .mockResolvedValueOnce({ requestId: 'r', role: 'assistant', text: 'Accepted.\n```nucleas-gate\n{"status":"accept"}\n```', costMicros: 5 });

    const turn = await attemptOrchestratedIdeReply({ projectName: 'Nucleas', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'a'.repeat(24), userText: 'build the feature', priorTurns: [], interactionMode: 'build' });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    // The build runs on the engine's code pick (the worker model), not the build service default.
    expect(mocks.execute.mock.calls[0][0].inference).toEqual({ endpoint: `https://${workerId}.test/v1/chat/completions`, bearerToken: 'key', model: 'qwen' });
    expect(mocks.companyChat.mock.calls.map((call) => call[0].systemPrompt.match(/Pipeline stage: (planner|worker|reviewer)/)?.[1] ?? 'unknown')).toEqual(['planner', 'reviewer']);
    expect(mocks.companyChat.mock.calls[1][0].userText).toContain('npm test: exit 0');
    expect(turn.toolsUsed).toContain('sandbox_edit');
    expect(turn.toolsUsed).toContain('command_execute');
    expect(turn.text).toContain('Model requested: Qwen/Qwen2.5-Coder-14B-Instruct-AWQ');
    expect(turn.text).toContain('Model reported by provider: hosted_vllm/Qwen/Qwen2.5-Coder-14B-Instruct-AWQ');
  });
});

describe('plans are checked against the repository', () => {
  const files = new Map<string, string>(Object.entries({
    'package.json': '{"dependencies":{"next":"14"}}',
    'app/admin/catalog/page.tsx': "import Panel from '@/components/Panel';\nexport default function Page() { return <Panel /> }",
    'components/Panel.tsx': "export default function Panel() { fetch('/api/admin/catalog/items'); return null }",
    'app/api/admin/catalog/items/route.ts': "import { seedVariants } from '@/lib/data/variants';\nimport { Variant } from '@/models/Variant';\nexport async function GET() {\n  const rows = [];\n  for (const v of seedVariants) rows.push({ key: `${v.parent}:${v.slug}` });\n  const stored = await Variant.find({});\n  return Response.json(rows.concat(stored));\n}",
    'lib/data/variants.ts': "export const seedVariants = [\n  { parent: 'widget', slug: 'gadgetPro' },\n];",
    'app/shop/[slug]/page.tsx': "import { seedVariants } from '@/lib/data/variants';",
    'models/Variant.ts': 'export const Variant = {};',
    'lib/settings.ts': 'export const OPTIONS = { ...DEFAULTS, slug: "gadgetPro" };',
  }));
  const request = 'On example.com/admin/catalog, gadgetPro is listed on its own and also under widget. Remove the listing under widget.';
  const goodEvidence = [{ file: 'lib/data/variants.ts', line: 2, quote: "{ parent: 'widget', slug: 'gadgetPro' }," }];
  const plan = (o: Record<string, unknown> = {}) => `Plan.\n\`\`\`nucleas-plan\n${structuredPlan({
    title: 'Hide duplicate variant', summary: 'gadgetPro is listed twice', symptom: 'gadgetPro shows on its own and under widget.',
    path: [{ file: 'app/admin/catalog/page.tsx', line: 1 }, { file: 'app/api/admin/catalog/items/route.ts', line: 5, note: 'builds the rows' }],
    rootCause: { explanation: '1. The route lists variants. 2. gadgetPro is a variant of widget. 3. It is also top level.', evidence: goodEvidence },
    filesToChange: ['lib/data/variants.ts'], expectedResult: 'One gadgetPro row remains because lib/data/variants.ts:2 no longer lists it under widget.',
    steps: ['Edit lib/data/variants.ts to remove the gadgetPro entry under widget'], ...o,
  })}\n\`\`\``;
  const run = (over: Partial<Parameters<typeof attemptOrchestratedIdeReply>[0]> = {}) => attemptOrchestratedIdeReply({ projectName: 'X', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'u'.repeat(24), userText: request, priorTurns: [], interactionMode: 'plan', ...over });
  const stageOf = (args: { systemPrompt: string }) => args.systemPrompt.match(/Pipeline stage: (planner|worker|reviewer)/)![1];
  let pack: ReturnType<typeof buildEvidencePack>;

  beforeEach(async () => {
    vi.clearAllMocks();
    pack = buildEvidencePack(files, request);
    mocks.snapshot.mockResolvedValue({ ok: true, snapshot: { owner: 'o', repo: 'r', branch: 'main', commit: 'a'.repeat(40), skipped: [], files } });
    mocks.repoDig.mockResolvedValue({ ok: true, okReads: 2, note: 'Read', toolsUsed: [], contextBlock: pack!.text, evidenceBlock: pack!.text, evidencePack: pack });
    mocks.readSettings.mockResolvedValue({ value: readySettings });
    mocks.execute.mockResolvedValue(null);
    mocks.listModels.mockResolvedValue([]);
    mocks.findObjectives.mockReturnValue(leanChain([]));
    mocks.findRuns.mockReturnValue(leanChain([]));
    mocks.selectModel.mockImplementation(async (_o: string, need: string) => ({
      primary: need === 'plan' ? { profileId: 'a'.repeat(24), model: 'gemma', free: true, label: 'R' } : need === 'review' ? { profileId: 'c'.repeat(24), model: 'critic', free: true, label: 'R' } : { profileId: 'b'.repeat(24), model: 'qwen', free: true, label: 'R' },
      fallback: null,
    }));
  });

  afterEach(() => {
    mocks.snapshot.mockResolvedValue({ ok: false, reason: 'no snapshot' });
    mocks.repoDig.mockResolvedValue({ ok: true, okReads: 2, note: 'Read 2 file(s).', toolsUsed: ['repo_tree', 'repo_read'], contextBlock: 'File loadTaskRules.ts:\nexport async function loadIdeTaskRuleTexts', evidenceBlock: 'File loadTaskRules.ts:\nexport async function loadIdeTaskRuleTexts' });
  });

  const accepting = (calls: { stage: string; userText: string }[], planText: string | (() => string)) => mocks.companyChat.mockImplementation(async (args: { systemPrompt: string; userText: string }) => {
    const stage = stageOf(args);
    calls.push({ stage, userText: args.userText });
    if (stage === 'planner') return { requestId: 'p', role: 'assistant', costMicros: 0, toolsUsed: ['repo_read'], text: typeof planText === 'function' ? planText() : planText };
    if (stage === 'worker') return { requestId: 'w', role: 'assistant', costMicros: 0, toolsUsed: ['repo_read'], text: 'Confirmed app/api/admin/catalog/items/route.ts:5 builds the rows.' };
    return { requestId: 'r', role: 'assistant', costMicros: 0, text: 'I tried to break it and could not.\n```nucleas-gate\n{"status":"accept"}\n```' };
  });

  it('publishes a verified plan with Nucleas\'s own sections: what was found, and who else reads the data', async () => {
    const calls: { stage: string; userText: string }[] = [];
    accepting(calls, plan());
    const turn = await run();
    expect(calls.map((c) => c.stage)).toEqual(['planner', 'worker', 'reviewer']);
    expect(turn.plan?.status).toBe('ready_for_review');
    expect(turn.plan?.markdown).toContain('## Automatic checks (from the repository)');
    expect(turn.plan?.markdown).toContain('1 of 1 quoted lines were found in the repository');
    // A change to the seed data reaches the public shop page too, which the plan did not say.
    expect(turn.plan?.markdown).toContain('lib/data/variants.ts is also used by app/shop/[slug]/page.tsx, route /shop/:slug');
    expect(calls[1].userText).toContain('1 of 1 quoted lines were found in the repository.');
    expect(calls[1].userText).not.toContain('FAILED');
    expect(calls[2].userText).toContain('Automated checks on the plan');
  });

  it('sends an incomplete plan back once, with exactly what is wrong, and uses the corrected one', async () => {
    const calls: { stage: string; userText: string }[] = [];
    let planners = 0;
    accepting(calls, () => (++planners === 1 ? 'Plan.\n```nucleas-plan\n{"title":"Fix","summary":"Fix it","symptom":"gadgetPro is listed twice","steps":["Fix it"]}\n```' : plan()));
    const turn = await run();
    expect(calls.map((c) => c.stage)).toEqual(['planner', 'planner', 'worker', 'reviewer']);
    expect(calls[1].userText).toContain('rejected by automatic checks against the repository');
    expect(calls[1].userText).toContain('rootCause');
    expect(calls[1].userText).toContain('Data path');
    expect(turn.plan?.status).toBe('ready_for_review');
    expect(turn.plan?.title).toBe('Hide duplicate variant');
  });

  it('rejects a plan whose quoted evidence is not in the repository, showing the draft and why', async () => {
    const calls: { stage: string; userText: string }[] = [];
    const invented = plan({ rootCause: { explanation: '1. a 2. b', evidence: [{ file: 'lib/data/variants.ts', line: 2, quote: "export const gadgetPro = { parent: 'top-level' };" }] } });
    accepting(calls, invented);
    const turn = await run();
    // One correction round, then it is not spent on a Worker and Critic.
    expect(calls.map((c) => c.stage)).toEqual(['planner', 'planner']);
    expect(calls[1].userText).toContain('was not found in lib/data/variants.ts');
    expect(turn.plan).toBeUndefined();
    expect(turn.text).toContain('could not verify it, so it is not ready for review');
    expect(turn.text).toContain('None of the code the plan quotes could be found in the repository');
    expect(turn.text).toContain('Planner draft (unverified)');
  });

  it('rejects a plan that edits code the named page does not use, even when its quotes are real', async () => {
    const calls: { stage: string; userText: string }[] = [];
    accepting(calls, plan({
      filesToChange: ['lib/settings.ts'], steps: ['Edit lib/settings.ts to drop the slug'],
      rootCause: { explanation: '1. a 2. b', evidence: [{ file: 'lib/settings.ts', line: 1, quote: 'slug: "gadgetPro"' }] },
      expectedResult: 'gadgetPro disappears because lib/settings.ts:1 no longer sets it.',
    }));
    const turn = await run();
    expect(turn.plan).toBeUndefined();
    expect(turn.text).toContain('are in files the named page does not use');
    expect(turn.text).toContain('lib/settings.ts');
  });

  it('asks the Critic to be a different model from the Planner when the engine picked the same one', async () => {
    mocks.listModels.mockResolvedValue([
      { profileId: 'a'.repeat(24), model: 'gemma', free: true, contextTokens: 16000 },
      { profileId: 'e'.repeat(24), model: 'other-critic', free: true, contextTokens: 16000 },
    ]);
    mocks.selectModel.mockImplementation(async (_o: string, need: string, _l: string, opts?: { models?: { profileId: string; model: string }[] }) => {
      if (need === 'plan' || (need === 'review' && !opts?.models)) return { primary: { profileId: 'a'.repeat(24), model: 'gemma', free: true, label: 'R' }, fallback: null };
      if (need === 'review') return { primary: { ...opts!.models![0], free: true, label: 'R' }, fallback: null };
      return { primary: { profileId: 'b'.repeat(24), model: 'qwen', free: true, label: 'R' }, fallback: null };
    });
    const models: Record<string, string> = {};
    mocks.companyChat.mockImplementation(async (args: { systemPrompt: string; model: string }) => {
      const stage = stageOf(args);
      models[stage] = args.model;
      return { requestId: stage, role: 'assistant', costMicros: 0, text: stage === 'planner' ? plan() : stage === 'reviewer' ? 'Held.\n```nucleas-gate\n{"status":"accept"}\n```' : 'Confirmed.' };
    });
    await run();
    expect(models.planner).toBe('gemma');
    expect(models.reviewer).toBe('other-critic');
  });
});

describe('distillPlannerBriefing', () => {
  it('distills structured nucleas-plan output for the worker', () => {
    const raw = [
      'Here is the architectural overview of the blog feature.',
      'We will use MDX and dynamic routing.',
      '```nucleas-plan',
      JSON.stringify({
        title: 'Add Blog System',
        summary: 'Build MDX blog with SEO support.',
        steps: ['Create /blog routes', 'Add markdown renderer', 'Write tests'],
      }),
      '```',
    ].join('\n');

    const distilled = distillPlannerBriefing(raw, 'plan');
    expect(distilled).toContain('Plan Goal: Add Blog System');
    expect(distilled).toContain('Summary: Build MDX blog with SEO support.');
    expect(distilled).toContain('1. Create /blog routes');
    expect(distilled).toContain('2. Add markdown renderer');
    expect(distilled).toContain('3. Write tests');
    expect(distilled).toContain('Here is the architectural overview');
    expect(distilled).not.toContain('```nucleas-plan');
  });

  it('falls back cleanly when nucleas-plan is not present', () => {
    const raw = 'Investigate Playbound database schema and report findings.';
    const distilled = distillPlannerBriefing(raw, 'chat');
    expect(distilled).toBe('Investigate Playbound database schema and report findings.');
  });
});

describe('isTrivialTeamChatRequest', () => {
  it('routes only unmistakably simple chat turns directly', () => {
    expect(isTrivialTeamChatRequest('Thanks!', 'chat')).toBe(true);
    expect(isTrivialTeamChatRequest('Plan a new blog', 'plan')).toBe(false);
    expect(isTrivialTeamChatRequest('How does authentication work?', 'chat')).toBe(false);
  });

});


describe('provider refusals during code planning', () => {
  it('re-picks the stage model when a provider refuses the account, and says so', async () => {
    let planPicks = 0;
    mocks.selectModel.mockImplementation(async (_org: string, need: string) => {
      if (need === 'plan') {
        planPicks += 1;
        return { primary: planPicks === 1 ? { profileId: 'a'.repeat(24), model: 'meta/muse-spark-1.3', free: false, label: 'OpenRouter' } : { profileId: 'd'.repeat(24), model: 'gpt-6-sol', free: false, label: 'OpenAI' }, fallback: null };
      }
      return { primary: { profileId: 'b'.repeat(24), model: need === 'review' ? 'sol-review' : 'qwen', free: need !== 'review', label: 'x' }, fallback: null };
    });
    const planners: string[] = [];
    mocks.companyChat.mockImplementation(async (input: { model: string; systemPrompt: string }) => {
      if (/Pipeline stage: planner/.test(input.systemPrompt)) {
        planners.push(input.model);
        if (input.model === 'meta/muse-spark-1.3') {
          return { requestId: 'r', role: 'status', text: 'The remote model endpoint was unreachable or returned an error. OpenRouter returned HTTP 402: requires more credits.', failureCategory: 'unavailable', debugHint: 'code=unavailable kind=http httpStatus=402' };
        }
        return { requestId: 'p', role: 'assistant', text: `Investigation done.\n${PLAN_FENCE}`, costMicros: 10 };
      }
      return { requestId: 'w', role: 'assistant', text: 'ok', costMicros: 0 };
    });
    const progress: string[] = [];
    await attemptOrchestratedIdeReply({ projectName: 'PlayBound', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'a'.repeat(24), userText: 'hello there, what does the build do?', priorTurns: [], interactionMode: 'chat', onProgress: (t) => progress.push(t) });
    expect(planners).toEqual(['meta/muse-spark-1.3', 'gpt-6-sol']);
    expect(progress).toContain('muse-spark-1.3 did not complete; switching to gpt-6-sol');
  });

  it('re-picks a free planner immediately when the selected deployment returns 504', async () => {
    let planPicks = 0;
    mocks.selectModel.mockImplementation(async (_org: string, need: string) => {
      if (need === 'plan') {
        planPicks += 1;
        return {
          primary: planPicks === 1
            ? { profileId: 'a'.repeat(24), model: 'Qwen/Qwen3-VL-8B-Thinking-FP8', free: true, label: 'Rogly' }
            : { profileId: 'a'.repeat(24), model: 'google/gemma-4-12B-it-qat-w4a16-ct', free: true, label: 'Rogly' },
          fallback: null,
        };
      }
      return { primary: { profileId: 'b'.repeat(24), model: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', free: true, label: 'Rogly' }, fallback: null };
    });
    const planners: string[] = [];
    mocks.companyChat.mockImplementation(async (input: { model: string; systemPrompt: string }) => {
      if (/Pipeline stage: planner/.test(input.systemPrompt)) {
        planners.push(input.model);
        if (input.model.includes('Qwen3-VL')) {
          return { requestId: 'timeout', role: 'status', text: 'HTTP 504 (upstream timeout).', failureCategory: 'unavailable', debugHint: 'code=unavailable kind=http httpStatus=504' };
        }
        return { requestId: 'plan', role: 'assistant', text: `Investigation done.\n${PLAN_FENCE}`, costMicros: 0, noProviderFee: true };
      }
      return { requestId: 'worker', role: 'assistant', text: 'ok', costMicros: 0, noProviderFee: true };
    });
    const progress: string[] = [];
    await attemptOrchestratedIdeReply({ projectName: 'PlayBound', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'a'.repeat(24), userText: 'Remove OpenHV from the OpenRA listing.', priorTurns: [], interactionMode: 'plan', level: 'free', onProgress: (text) => progress.push(text) });
    expect(planners).toEqual(['Qwen/Qwen3-VL-8B-Thinking-FP8', 'google/gemma-4-12B-it-qat-w4a16-ct']);
    expect(progress).toContain('Qwen3-VL-8B-Thinking-FP8 did not complete; switching to gemma-4-12B-it-qat-w4a16-ct');
    expect(mocks.listModels).toHaveBeenCalledWith({ force: true });
  });

  it('refreshes the live catalog and replaces a stale model id after a gateway 500', async () => {
    const stale = { profileId: 'a'.repeat(24), model: 'Rogly/retired-model', free: true, label: 'Rogly' };
    const current = { profileId: 'a'.repeat(24), model: 'Rogly/current-model', free: true, label: 'Rogly' };
    mocks.listModels
      .mockResolvedValueOnce([stale])
      .mockResolvedValueOnce([current]);
    mocks.selectModel.mockImplementation(async (_org: string, need: string, _level: string, options?: { models?: { model: string }[] }) => ({
      primary:
        need === 'plan'
          ? options?.models?.some((model) => model.model === current.model) ? current : stale
          : { profileId: 'b'.repeat(24), model: 'worker', free: true, label: 'Rogly' },
      fallback: null,
    }));
    const planners: string[] = [];
    mocks.companyChat.mockImplementation(async (input: { model: string; systemPrompt: string }) => {
      if (/Pipeline stage: planner/.test(input.systemPrompt)) {
        planners.push(input.model);
        if (input.model === stale.model) {
          return { requestId: 'failed', role: 'status', text: 'Local model gateway returned HTTP 500.', failureCategory: 'unavailable', debugHint: 'code=unavailable kind=http httpStatus=500 providerMessage=model not found' };
        }
      }
      return { requestId: 'ok', role: 'assistant', text: `Grounded plan.\n${PLAN_FENCE}`, costMicros: 0, noProviderFee: true };
    });

    await attemptOrchestratedIdeReply({ projectName: 'PlayBound', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'a'.repeat(24), userText: 'Remove OpenHV from OpenRA.', priorTurns: [], interactionMode: 'plan', level: 'free' });

    // Explicit model-not-found errors skip the same-model compact retry and refresh immediately.
    expect(planners).toEqual([stale.model, current.model]);
    expect(mocks.listModels).toHaveBeenCalledWith({ force: true });
  });

  it('distinguishes a payload-sensitive 500 by retrying the same model with compact context and no tools', async () => {
    mocks.listModels.mockResolvedValue([{ profileId: 'a'.repeat(24), model: 'Rogly/qwen', free: true, label: 'Rogly' }]);
    mocks.selectModel.mockResolvedValue({ primary: { profileId: 'a'.repeat(24), model: 'Rogly/qwen', free: true, label: 'Rogly' }, fallback: null });
    let plannerCalls = 0;
    mocks.companyChat.mockImplementation(async (input: { systemPrompt: string; toolProfile: string; forcePlain: boolean; repoContextBlock?: string }) => {
      if (/Pipeline stage: planner/.test(input.systemPrompt)) {
        plannerCalls += 1;
        if (plannerCalls === 1) return { requestId: 'failed', role: 'status', text: 'Rogly returned HTTP 500: Internal Server Error.', failureCategory: 'unavailable', debugHint: 'code=unavailable kind=http httpStatus=500' };
        expect(input.toolProfile).toBe('none');
        expect(input.forcePlain).toBe(true);
        expect(input.repoContextBlock?.length).toBeLessThanOrEqual(3_500);
        return { requestId: 'plan', role: 'assistant', text: `Recovered plan.\n${PLAN_FENCE}`, costMicros: 0 };
      }
      return { requestId: 'ok', role: 'assistant', text: 'Verified.', costMicros: 0 };
    });
    const progress: string[] = [];

    await attemptOrchestratedIdeReply({ projectName: 'PlayBound', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'a'.repeat(24), userText: 'Remove OpenHV from OpenRA.', priorTurns: [], interactionMode: 'plan', level: 'free', onProgress: (text) => progress.push(text) });

    expect(plannerCalls).toBe(2);
    expect(progress.some((line) => line.includes('compact context and no tools'))).toBe(true);
  });
});
