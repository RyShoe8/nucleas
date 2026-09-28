import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const mocks = vi.hoisted(() => ({
  companyChat: vi.fn(),
  repoDig: vi.fn(),
  selectModel: vi.fn(),
  findObjectives: vi.fn(),
  findRuns: vi.fn(),
  readSettings: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/companyChat', () => ({
  attemptCompanyCredentialChat: (...args: unknown[]) => mocks.companyChat(...args),
}));
vi.mock('@/lib/ai/engine/catalog', () => ({ listAvailableModels: async () => [] }));
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
    const draft = `Blog layout and integration. ${'detail '.repeat(1000)}End-of-briefing acceptance checks.\n\`\`\`nucleas-plan\n{"title":"Blog","summary":"Add blog","steps":["Add routes"]}\n\`\`\``;
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
        ? 'Draft blog\n```nucleas-plan\n{"title":"Blog","summary":"Add blog","steps":["Add routes"]}\n```'
        : systemPrompt.includes('Pipeline stage: worker') ? 'Read routes.'
          : accept ? 'Verified.\n```nucleas-gate\n{"status":"accept"}\n```'
            : 'Need evidence.\n```nucleas-gate\n{"status":"needs_more","jobs":["Read routes"]}\n```',
    }));
    const turn = await attemptOrchestratedIdeReply({ projectName: 'Playbound', organizationId: 'org', projectId: new Types.ObjectId(), userId: 'a'.repeat(24), userText: 'plan a blog', priorTurns: [], interactionMode: 'plan' });
    if (accept) expect(turn.plan?.status).toBe('ready_for_review');
    else expect(turn.plan).toBeUndefined();
    expect(mocks.companyChat).toHaveBeenCalledTimes(accept ? 3 : 5);
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
    expect(turn.text).toBe('Here is how the rules system works…');
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
    expect(workerCall[0].repoContextBlock).toBeUndefined();
    expect(reviewerCall[0].repoContextBlock).toBeUndefined();
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
    expect(turn.text).toBe('Chat history is stored via appendIdeChatTurns in chatHistory.ts.');
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

