import { describe, expect, it, vi } from 'vitest';
import {
  completionLimitBody,
  invokeModel,
  invokeModelWithTools,
  sanitizeProviderMessage,
  toolCallReasoningBody,
  usesMaxCompletionTokens,
  validateGatewayConfiguration,
  type GatewayConfiguration,
} from './gateway';

const config: GatewayConfiguration = { endpoint: 'https://llm.rogly.net/v1/chat/completions', bearerToken: 'test-secret', model: 'test-model', protocol: 'openai-chat' };
const request = { role: 'architect' as const, messages: [{ role: 'user' as const, content: 'Plan a synthetic task.' }], maxOutputTokens: 100 };
const output = { choices: [{ message: { content: 'A plan' }, finish_reason: 'stop' }] };
describe('remote inference gateway', () => {
  it('sends a server-side bearer token without redirects, cache, or tools', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(output));
    const result = await invokeModel(config, request, { fetcher });
    const options = fetcher.mock.calls[0][1]!;
    expect(options.redirect).toBe('error'); expect(options.cache).toBe('no-store');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' });
    const body = JSON.parse(String(options.body));
    expect(body).not.toHaveProperty('tools');
    expect(body).toMatchObject({ max_tokens: 100 });
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(result).toMatchObject({ content: 'A plan', inputTokens: null, outputTokens: null });
    expect(JSON.stringify(result)).not.toContain('test-secret');
  });

  it('sends max_completion_tokens for o4-mini and omits max_tokens', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(output));
    await invokeModel({ ...config, model: 'o4-mini' }, request, { fetcher });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]!.body));
    expect(body).toMatchObject({ model: 'o4-mini', max_completion_tokens: 100 });
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('keeps max_tokens for gpt-4o-mini', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(output));
    await invokeModel({ ...config, model: 'gpt-4o-mini' }, request, { fetcher });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]!.body));
    expect(body).toMatchObject({ model: 'gpt-4o-mini', max_tokens: 100 });
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('detects reasoning token-limit models including provider prefixes', () => {
    expect(usesMaxCompletionTokens('o4-mini')).toBe(true);
    expect(usesMaxCompletionTokens('openai/gpt-5.6-sol')).toBe(true);
    expect(usesMaxCompletionTokens('gpt-4o-mini')).toBe(false);
    expect(completionLimitBody('o3', 256)).toEqual({ max_completion_tokens: 256 });
    expect(completionLimitBody('gpt-4.1', 256)).toEqual({ max_tokens: 256 });
    expect(toolCallReasoningBody('gpt-5.6-sol')).toEqual({ reasoning_effort: 'none' });
    expect(toolCallReasoningBody('openai/gpt-5.4')).toEqual({ reasoning_effort: 'none' });
    expect(toolCallReasoningBody('gpt-4o-mini')).toEqual({});
    expect(toolCallReasoningBody('o3-mini')).toEqual({});
  });
  it.each(['http://llm.rogly.net/v1', 'https://user:secret@llm.rogly.net/v1', 'https://llm.rogly.net/v1?token=secret'])('rejects unsafe endpoint configuration', endpoint => {
    expect(() => validateGatewayConfiguration({ ...config, endpoint })).toThrow();
  });
  it('fails closed without a token or explicit protocol', () => {
    expect(() => validateGatewayConfiguration({ ...config, bearerToken: '' })).toThrow();
  });
  it.each([[401, 'credentials'], [403, 'credentials'], [429, 'rate_limit'], [500, 'unavailable']])('normalizes HTTP %s without leaking response details', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('test-secret', { status: Number(status) }));
    await expect(invokeModel(config, request, { fetcher })).rejects.toMatchObject({ code, message: `Model gateway: ${code}` });
    expect(fetcher).toHaveBeenCalledTimes(1);
    // The body echoed the key; the kept provider message must not contain it.
    const error = await invokeModel(config, request, { fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('bad key test-secret', { status: Number(status) })) }).catch((e) => e);
    expect(JSON.stringify(error.details)).not.toContain('test-secret');
  });
  it("keeps the provider's own reason so failures are actionable", async () => {
    const body = JSON.stringify({ error: { message: 'Insufficient credits. Add more using https://openrouter.ai/credits', code: 402 } });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 402 }));
    await expect(invokeModel(config, request, { fetcher })).rejects.toMatchObject({
      code: 'unavailable',
      details: { httpStatus: 402, providerMessage: 'Insufficient credits. Add more using https://openrouter.ai/credits' },
    });
    expect(sanitizeProviderMessage('Invalid key sk-or-v1-abcdef0123456789abcdef')).toBe('Invalid key [redacted]');
    expect(sanitizeProviderMessage('<html><body>Bad Gateway</body></html>')).toBe('Bad Gateway');
  });
  it('rejects oversized responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(512001)));
    await expect(invokeModel(config, request, { fetcher })).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('accepts truncated or unexpected tool_calls when content is present', async () => {
    for (const choice of [
      { message: { content: 'run shell', tool_calls: [{}] }, finish_reason: 'tool_calls' },
      { message: { content: 'partial' }, finish_reason: 'length' },
    ]) {
      const result = await invokeModel(config, request, {
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [choice] })),
      });
      expect(result.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('rejects empty plain content even with tool_calls', async () => {
    await expect(
      invokeModel(config, request, {
        fetcher: vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            Response.json({ choices: [{ message: { content: '', tool_calls: [{}] }, finish_reason: 'tool_calls' }] })
          ),
      })
    ).rejects.toMatchObject({ code: 'invalid_response', details: { kind: 'empty_content' } });
  });

  it('accepts reasoning_content when plain content is empty', async () => {
    const result = await invokeModel(config, request, {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          choices: [
            {
              message: { content: '', reasoning_content: 'Hello from reasoning.' },
              finish_reason: 'stop',
            },
          ],
        })
      ),
    });
    expect(result.content).toBe('Hello from reasoning.');
  });

  it('strips think tags from plain content', async () => {
    const result = await invokeModel(config, request, {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          choices: [
            {
              message: { content: '<think>secret</think>\nVisible answer' },
              finish_reason: 'stop',
            },
          ],
        })
      ),
    });
    expect(result.content).toBe('Visible answer');
  });
  it('does not dispatch an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort(); const fetcher = vi.fn<typeof fetch>();
    await expect(invokeModel(config, request, { fetcher, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves reported zero usage, separately from unknown', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...output, usage: { prompt_tokens: 0, completion_tokens: 3 } }));
    expect(await invokeModel(config, request, { fetcher })).toMatchObject({ inputTokens: 0, outputTokens: 3 });
  });

  it('accepts truncated tool replies when content is present', async () => {
    const result = await invokeModelWithTools(
      config,
      {
        role: 'architect',
        messages: [{ role: 'user', content: 'hi' }],
        maxOutputTokens: 100,
        tools: [
          {
            type: 'function',
            function: { name: 'web_search', description: 'Search', parameters: { type: 'object', properties: {} } },
          },
        ],
      },
      {
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            choices: [{ message: { content: 'partial answer' }, finish_reason: 'length' }],
          })
        ),
      }
    );
    expect(result.content).toBe('partial answer');
    expect(result.toolCalls).toEqual([]);
  });
});

function sse(events: unknown[], chunkSize = 1000): Response {
  const text = `: keep-alive\n\n${events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')}`;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

describe('streamed responses', () => {
  const streamConfig = { ...config, stream: true };

  it('asks for a stream and assembles content, reasoning and usage, even when events split across chunks', async () => {
    const events = [
      { model: 'test-model', choices: [{ delta: { reasoning_content: 'Let me think. ' } }] },
      { choices: [{ delta: { content: 'A ' } }] },
      { choices: [{ delta: { content: 'plan' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 34 } },
      '[DONE]',
    ];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => sse(events, 7));
    const result = await invokeModel(streamConfig, request, { fetcher });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]!.body));
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(result).toMatchObject({ content: 'A plan', inputTokens: 12, outputTokens: 34, finishReason: 'stop' });
  });

  it('stays non-streaming unless asked', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(output));
    await invokeModel(config, request, { fetcher });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]!.body)).stream).toBe(false);
  });

  it('reassembles tool calls whose name and arguments arrive in pieces', async () => {
    const events = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'repo_', arguments: '{"que' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'search', arguments: 'ry":"OpenHV"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      '[DONE]',
    ];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => sse(events, 11));
    const result = await invokeModelWithTools(streamConfig, { role: 'worker', messages: [{ role: 'user', content: 'find it' }], maxOutputTokens: 100, tools: [{ type: 'function', function: { name: 'repo_search', description: 'search', parameters: { type: 'object', properties: {} } } }] }, { fetcher });
    expect(result.toolCalls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'repo_search', arguments: '{"query":"OpenHV"}' } }]);
  });

  it('bounds the assembled text, not the event framing: a long thinking stream is fine', async () => {
    // ~8000 events of framing (about 1 MB) carrying only ~24 KB of text.
    const events = Array.from({ length: 8000 }, () => ({ id: 'chatcmpl-'.padEnd(120, 'x'), object: 'chat.completion.chunk', model: 'test-model', choices: [{ index: 0, delta: { reasoning_content: 'abc' } }] }));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => sse([...events, { choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }, '[DONE]'], 65536));
    const result = await invokeModel(streamConfig, request, { fetcher });
    expect(result.content).toBe('done');
  });

  it('rejects a stream whose assembled text is over the limit, and says why', async () => {
    const big = 'x'.repeat(300_000);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => sse([{ choices: [{ delta: { content: big } }] }, { choices: [{ delta: { content: big } }] }]));
    await expect(invokeModel(streamConfig, request, { fetcher })).rejects.toMatchObject({ code: 'invalid_response', details: { kind: 'too_large' } });
  });

  it('turns an error event mid-stream into an unavailable error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => sse([{ choices: [{ delta: { content: 'x' } }] }, { error: { message: 'boom' } }]));
    await expect(invokeModel(streamConfig, request, { fetcher })).rejects.toMatchObject({ code: 'unavailable', details: { kind: 'stream_error' } });
  });

  it('gives up when a stream goes quiet for longer than the idle timeout', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const signal = init!.signal!;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'));
          signal.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      }));
    });
    await expect(invokeModel({ ...streamConfig, timeoutMs: 50 }, request, { fetcher })).rejects.toMatchObject({ code: 'unavailable', details: { kind: 'timeout' } });
  });
});
