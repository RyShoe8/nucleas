import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/models/AiControl', () => ({
  AiRunEvent: {
    create: vi.fn().mockResolvedValue({}),
  },
}));

const mockInvokeModelWithTools = vi.fn();
const mockInvokeModel = vi.fn();
vi.mock('@nucleas/ai-core/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nucleas/ai-core/gateway')>();
  return {
    ...actual,
    invokeModelWithTools: (...args: unknown[]) => mockInvokeModelWithTools(...args),
    invokeModel: (...args: unknown[]) => mockInvokeModel(...args),
  };
});

vi.mock('@/lib/ai/tools/executeTool', () => ({
  executeIdeTool: vi.fn().mockResolvedValue({
    content: JSON.stringify({ ok: true, path: 'src/file.ts' }),
    artifacts: [],
  }),
}));

import { runIdeToolLoop } from '@/lib/ai/tools/runToolLoop';

describe('runIdeToolLoop keeps full context', () => {
  function reading(file: (n: number) => string, rounds: number) {
    let round = 0;
    const seen: { role: string; content: string | null; tool_call_id?: string }[][] = [];
    mockInvokeModelWithTools.mockImplementation(async (_gateway, req) => {
      seen.push(req.messages);
      round += 1;
      if (round > rounds) return { content: 'Done.', toolCalls: [], inputTokens: 1, outputTokens: 1, latencyMs: 1 };
      return { content: '', toolCalls: [{ id: `c${round}`, type: 'function', function: { name: 'repo_read', arguments: JSON.stringify({ path: file(round) }) } }], inputTokens: 1, outputTokens: 1, latencyMs: 1 };
    });
    return seen;
  }

  const base = {
    gateway: { endpoint: 'https://x.test', model: 'm' } as never,
    messages: [{ role: 'system' as const, content: 'System prompt' }, { role: 'user' as const, content: 'Active user request' }],
    maxOutputTokens: 100,
    includeImageTool: false,
    maxRounds: 32,
    organizationId: 'org',
    projectId: new Types.ObjectId(),
    userId: 'u',
    runId: new Types.ObjectId(),
  };

  it('with room in the context window, nothing the model read is ever dropped', async () => {
    mockInvokeModelWithTools.mockReset();
    const seen = reading((n) => `src/file${n}.ts`, 30);
    const result = await runIdeToolLoop({ ...base, contextChars: 1_000_000 });
    expect(result.content).toBe('Done.');
    const last = seen[seen.length - 1];
    // Task + system + 30 × (assistant call + tool result), all intact.
    expect(last).toHaveLength(2 + 30 * 2 + 1);
    expect(last.filter((m) => m.role === 'tool').every((m) => !String(m.content).includes('cleared'))).toBe(true);
  });

  it('when the window fills, clears only the oldest results (naming the call) and keeps the task and newest results', async () => {
    const { fitToContext } = await import('@/lib/ai/tools/runToolLoop');
    const big = 'x'.repeat(5000);
    const messages: Parameters<typeof fitToContext>[0] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Active user request' },
    ];
    for (let i = 1; i <= 10; i += 1) {
      messages.push({ role: 'assistant', content: null, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'repo_read', arguments: `{"path":"f${i}.ts"}` } }] });
      messages.push({ role: 'tool', tool_call_id: `c${i}`, content: big });
    }
    fitToContext(messages, 30_000);
    const total = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(30_000 * 0.85 + 2000);
    expect(messages[1]).toMatchObject({ role: 'user', content: 'Active user request' });
    expect(messages[3].content).toContain('Result of repo_read({"path":"f1.ts"}) cleared');
    expect(messages[messages.length - 1].content).toBe(big);
    // Structure is untouched: every tool result still follows its call.
    expect(messages).toHaveLength(22);
  });
});

describe('runIdeToolLoop extra tools', () => {
  it('offers caller tools, routes their calls to the caller with the run id, and keeps IDE tools separate', async () => {
    const runId = new Types.ObjectId();
    const execute = vi.fn().mockResolvedValue(JSON.stringify({ ok: true, sessions: 42 }));
    let offered: string[] = [];
    let round = 0;
    mockInvokeModelWithTools.mockImplementation(async (_gateway, req) => {
      offered = req.tools.map((t: { function: { name: string } }) => t.function.name);
      round += 1;
      if (round === 1) {
        return {
          content: '',
          toolCalls: [{ id: 'c1', type: 'function', function: { name: 'company_metrics', arguments: '{"days":28}' } }],
          inputTokens: 1, outputTokens: 1, latencyMs: 1,
        };
      }
      return { content: 'Sessions were 42.', toolCalls: [], inputTokens: 1, outputTokens: 1, latencyMs: 1 };
    });

    const result = await runIdeToolLoop({
      gateway: { endpoint: 'https://x.test', model: 'm' } as never,
      messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'how are we doing?' }],
      maxOutputTokens: 100,
      includeImageTool: false,
      includeRepoTools: false,
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'u',
      runId,
      extraTools: {
        definitions: [{ type: 'function', function: { name: 'company_metrics', description: 'm', parameters: { type: 'object', properties: {}, required: [] } } }],
        execute,
      },
    });

    expect(offered).toContain('company_metrics');
    expect(offered).not.toContain('repo_read');
    expect(execute).toHaveBeenCalledWith('company_metrics', '{"days":28}', { runId });
    expect(result.content).toBe('Sessions were 42.');
  });
});

describe('runIdeToolLoop tool budget', () => {
  it('warns before the budget runs out and, when it does, writes the answer without tools from the evidence', async () => {
    mockInvokeModelWithTools.mockReset();
    mockInvokeModel.mockReset();
    const seen: string[][] = [];
    mockInvokeModelWithTools.mockImplementation(async (_gateway, req) => {
      seen.push(req.messages.map((m: { role: string; content: string | null }) => `${m.role}:${m.content ?? ''}`));
      // A model that never stops reading files.
      return { content: '', toolCalls: [{ id: `c${seen.length}`, type: 'function', function: { name: 'repo_read', arguments: '{"path":"src/file.ts"}' } }], inputTokens: 10, outputTokens: 2, latencyMs: 1 };
    });
    mockInvokeModel.mockResolvedValue({ content: 'Plan: remove OpenHV from the OpenRA editions list.', model: 'm', inputTokens: 50, outputTokens: 20, latencyMs: 1, finishReason: 'stop' });

    const result = await runIdeToolLoop({
      gateway: { endpoint: 'https://x.test', model: 'm' } as never,
      messages: [{ role: 'system', content: 'You plan.' }, { role: 'user', content: 'Fix OpenHV listing' }],
      maxOutputTokens: 100,
      includeImageTool: false,
      maxRounds: 8,
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userId: 'u',
      runId: new Types.ObjectId(),
    });

    expect(seen).toHaveLength(8);
    expect(seen[0][0]).toContain('at most 8 rounds');
    expect(seen[5].some((m) => m.includes('Only 3 tool rounds remain'))).toBe(true);
    const final = mockInvokeModel.mock.calls[0][1];
    expect(final.messages[1].content).toContain('Evidence you gathered with tools');
    expect(final.messages[1].content).toContain('src/file.ts');
    expect(result.content).toBe('Plan: remove OpenHV from the OpenRA editions list.');
    expect(result.inputTokens).toBe(8 * 10 + 50);
  });
});
