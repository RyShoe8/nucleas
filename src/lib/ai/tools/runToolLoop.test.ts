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

describe('runIdeToolLoop message compaction', () => {
  it('compacts messages when count > 24 while maintaining assistant-tool pairing without orphan tool messages', async () => {
    let round = 0;
    mockInvokeModelWithTools.mockImplementation(async (_gateway, req) => {
      // Validate that in every outbound request, no tool message appears without a preceding assistant with tool_calls
      const msgs = req.messages;
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].role === 'tool') {
          // Look backwards for the parent assistant message
          let foundParent = false;
          for (let j = i - 1; j >= 0; j--) {
            if (msgs[j].role === 'assistant') {
              if (msgs[j].tool_calls?.some((tc: { id: string }) => tc.id === msgs[i].tool_call_id)) {
                foundParent = true;
              }
              break;
            }
          }
          expect(foundParent).toBe(true);
        }
      }

      round++;
      if (round <= 6) {
        // Return 4 parallel tool calls per round to quickly grow message count past 24
        return {
          content: `Round ${round}`,
          toolCalls: [
            { id: `c_${round}_1`, type: 'function', function: { name: 'repo_read', arguments: '{}' } },
            { id: `c_${round}_2`, type: 'function', function: { name: 'repo_read', arguments: '{}' } },
            { id: `c_${round}_3`, type: 'function', function: { name: 'repo_read', arguments: '{}' } },
            { id: `c_${round}_4`, type: 'function', function: { name: 'repo_read', arguments: '{}' } },
          ],
          latencyMs: 10,
        };
      }

      return {
        content: 'Final answer after compaction',
        toolCalls: [],
        latencyMs: 10,
      };
    });

    const result = await runIdeToolLoop({
      gateway: {
        endpoint: 'https://llm.example.com/v1/chat/completions',
        bearerToken: 'secret',
        model: 'gpt-5.6-sol',
        protocol: 'openai-chat',
      },
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User prompt' },
      ],
      maxOutputTokens: 1000,
      includeImageTool: false,
      includeRepoTools: true,
      maxRounds: 10,
      organizationId: 'test-org',
      projectId: new Types.ObjectId(),
      userId: 'test-user',
      runId: new Types.ObjectId(),
    });

    expect(result.content).toBe('Final answer after compaction');
    expect(round).toBe(7);
  });

  it('preserves the active user prompt and system prompt when compacting messages with prior history', async () => {
    let round = 0;
    mockInvokeModelWithTools.mockImplementation(async (_gateway, req) => {
      round++;
      if (round > 5) {
        // After compaction, messages[0] must be the system prompt, and messages[1] must be the active user task
        expect(req.messages[0]).toMatchObject({ role: 'system', content: expect.stringMatching(/^System prompt\n\nYou can use tools for at most \d+ rounds/) });
        expect(req.messages[1]).toMatchObject({ role: 'user', content: 'Active user blog request' });
        // The old history request must NOT be at index 1
        expect(req.messages[1].content).not.toBe('Old history request about notifications');
      }

      if (round <= 6) {
        return {
          content: `Round ${round}`,
          toolCalls: [
            { id: `c_${round}_1`, type: 'function', function: { name: 'repo_read', arguments: '{}' } },
            { id: `c_${round}_2`, type: 'function', function: { name: 'repo_read', arguments: '{}' } },
            { id: `c_${round}_3`, type: 'function', function: { name: 'repo_read', arguments: '{}' } },
            { id: `c_${round}_4`, type: 'function', function: { name: 'repo_read', arguments: '{}' } },
          ],
          latencyMs: 10,
        };
      }

      return {
        content: 'Finished plan for blog',
        toolCalls: [],
        latencyMs: 10,
      };
    });

    const result = await runIdeToolLoop({
      gateway: {
        endpoint: 'https://llm.example.com/v1/chat/completions',
        bearerToken: 'secret',
        model: 'gpt-5.6-sol',
        protocol: 'openai-chat',
      },
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Old history request about notifications' },
        { role: 'assistant', content: 'Old notification answer' },
        { role: 'user', content: 'Active user blog request' },
      ],
      maxOutputTokens: 1000,
      includeImageTool: false,
      includeRepoTools: true,
      maxRounds: 10,
      organizationId: 'test-org',
      projectId: new Types.ObjectId(),
      userId: 'test-user',
      runId: new Types.ObjectId(),
    });

    expect(result.content).toBe('Finished plan for blog');
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
