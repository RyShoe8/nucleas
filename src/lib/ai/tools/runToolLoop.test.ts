import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/models/AiControl', () => ({
  AiRunEvent: {
    create: vi.fn().mockResolvedValue({}),
  },
}));

const mockInvokeModelWithTools = vi.fn();
vi.mock('@nucleas/ai-core/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nucleas/ai-core/gateway')>();
  return {
    ...actual,
    invokeModelWithTools: (...args: unknown[]) => mockInvokeModelWithTools(...args),
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
        expect(req.messages[0]).toMatchObject({ role: 'system', content: 'System prompt' });
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
