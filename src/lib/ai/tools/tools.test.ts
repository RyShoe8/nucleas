import { describe, expect, it } from 'vitest';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { chooseBrowseTool } from '@/lib/ai/tools/browseRouter';
import { imagesUrlFromChatEndpoint, invokeModel, invokeModelWithTools } from '@nucleas/ai-core/gateway';
import { vi } from 'vitest';

describe('assertSafePublicHttpsUrl', () => {
  it('allows public https', () => {
    expect(assertSafePublicHttpsUrl('https://example.com/path').hostname).toBe('example.com');
  });

  it.each([
    'http://example.com',
    'https://127.0.0.1/',
    'https://10.0.0.1/',
    'https://192.168.1.1/',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/',
    'https://user:pass@example.com/',
  ])('blocks %s', (url) => {
    expect(() => assertSafePublicHttpsUrl(url)).toThrow();
  });
});

describe('chooseBrowseTool', () => {
  it('prefers search for open-ended discovery', () => {
    expect(
      chooseBrowseTool({ intent: 'auto', browserWorkerAvailable: true }).tool
    ).toBe('web_search');
  });

  it('prefers fetch for concrete URLs', () => {
    expect(
      chooseBrowseTool({
        intent: 'auto',
        url: 'https://example.com',
        browserWorkerAvailable: true,
      }).tool
    ).toBe('web_fetch');
  });

  it('escalates to browser when fetch was thin and worker available', () => {
    expect(
      chooseBrowseTool({
        intent: 'browse',
        url: 'https://example.com',
        priorFetchThin: true,
        priorEscalateHint: true,
        browserWorkerAvailable: true,
      }).tool
    ).toBe('browser_navigate');
  });

  it('stays on fetch when browser worker unavailable', () => {
    expect(
      chooseBrowseTool({
        intent: 'browse',
        url: 'https://example.com',
        priorFetchThin: true,
        browserWorkerAvailable: false,
      }).tool
    ).toBe('web_fetch');
  });
});

describe('imagesUrlFromChatEndpoint', () => {
  it('derives images generations from chat completions', () => {
    expect(imagesUrlFromChatEndpoint('https://api.openai.com/v1/chat/completions').pathname).toBe(
      '/v1/images/generations'
    );
  });

  it('derives images from custom v1 root', () => {
    expect(imagesUrlFromChatEndpoint('https://llm.example.com/v1/chat/completions').pathname).toBe(
      '/v1/images/generations'
    );
  });
});

describe('invokeModelWithTools', () => {
  const config = {
    endpoint: 'https://llm.example.com/v1/chat/completions',
    bearerToken: 'test-secret',
    model: 'test-model',
    protocol: 'openai-chat' as const,
  };

  it('accepts tool_calls when tools are enabled', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query":"nucleas"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      })
    );
    const result = await invokeModelWithTools(
      config,
      {
        role: 'architect',
        messages: [{ role: 'user', content: 'search' }],
        maxOutputTokens: 100,
        tools: [
          {
            type: 'function',
            function: {
              name: 'web_search',
              description: 'search',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      },
      { fetcher }
    );
    expect(result.toolCalls[0]?.function.name).toBe('web_search');
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toHaveProperty('tools');
  });

  it('text-only invokeModel accepts unexpected tool_calls when content exists', async () => {
    const result = await invokeModel(
      config,
      { role: 'architect', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 50 },
      {
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            choices: [{ message: { content: 'x', tool_calls: [{}] }, finish_reason: 'tool_calls' }],
          })
        ),
      }
    );
    expect(result.content).toBe('x');
  });

  it('rejects tools not in allowedTools set without dispatching', async () => {
    const { executeIdeTool } = await import('@/lib/ai/tools/executeTool');
    const res = await executeIdeTool({
      name: 'image_generate',
      argumentsJson: JSON.stringify({ prompt: 'test' }),
      gateway: config,
      organizationId: 'org',
      projectId: new (await import('mongoose')).Types.ObjectId(),
      userId: 'user',
      allowedTools: new Set(['repo_read', 'repo_tree']),
    });
    expect(JSON.parse(res.content)).toMatchObject({
      ok: false,
      error: expect.stringContaining('not permitted'),
    });
    expect(res.artifacts).toEqual([]);
  });

  it('pages repo_read and returns valid JSON with metadata', async () => {
    const { executeIdeTool } = await import('@/lib/ai/tools/executeTool');
    const ideCommitPush = await import('@/lib/ai/ideCommitPush');
    vi.spyOn(ideCommitPush, 'readIdeFile').mockResolvedValue({
      ok: true,
      path: 'src/index.ts',
      branch: 'main',
      sha: 'sha123',
      content: Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n'),
    });

    const res = await executeIdeTool({
      name: 'repo_read',
      argumentsJson: JSON.stringify({ path: 'src/index.ts', startLine: 10, lineCount: 5 }),
      gateway: config,
      organizationId: 'org',
      projectId: new (await import('mongoose')).Types.ObjectId(),
      userId: 'user',
    });

    const parsed = JSON.parse(res.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toContain('line 10');
    expect(parsed.content).toContain('line 14');
    expect(parsed.content).not.toContain('line 15');
    expect(parsed.startLine).toBe(10);
    expect(parsed.endLine).toBe(14);
    expect(parsed.totalLines).toBe(50);
  });
});

describe('repository search evidence', () => {
  it('attaches bounded, line-numbered source around high-confidence matches', async () => {
    const { buildRepoSearchEvidence } = await import('@/lib/ai/tools/executeTool');
    const content = Array.from({ length: 140 }, (_, index) => index === 79
      ? "  { id: 'openhv', parent: 'openra' },"
      : `line ${index + 1}`).join('\n');
    const evidence = buildRepoSearchEvidence({
      owner: 'owner', repo: 'repo', commit: 'a'.repeat(40), branch: 'main',
      files: new Map([['platform/src/lib/gameHost/recipes.js', content]]), skipped: [],
    }, {
      matches: [{ path: 'platform/src/lib/gameHost/recipes.js', line: 80, text: "{ id: 'openhv' }", before: [], after: [] }],
      totalMatches: 1, filesMatched: ['platform/src/lib/gameHost/recipes.js'], truncated: false,
    });

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ path: 'platform/src/lib/gameHost/recipes.js', startLine: 45, endLine: 135 });
    expect(evidence[0].excerpt).toContain("80:   { id: 'openhv', parent: 'openra' },");
  });
});

