import { afterEach, describe, expect, it, vi } from 'vitest';
import { executionWorkerRequestSchema } from '../../packages/ai-contracts/src/execution';
import { modelReply, type Quirks, type Usage } from './server';

const inference = { endpoint: 'https://models.test/v1/chat/completions', bearerToken: 'engine-key', model: 'gpt-6-sol' };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('build model calls', () => {
  it('calls the engine-chosen endpoint with its key, and adds up token usage', async () => {
    const fetchMock = vi.fn(async () => ok({ model: 'gpt-6-sol', usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [{ message: { content: 'hi', tool_calls: [] } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const usage: Usage = { inputTokens: 0, outputTokens: 0, reported: false };
    const quirks: Quirks = { noTemperature: false, completionTokens: false };
    await modelReply([{ role: 'user', content: 'x' }], inference, usage, quirks);
    await modelReply([{ role: 'user', content: 'y' }], inference, usage, quirks);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(inference.endpoint);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer engine-key');
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'gpt-6-sol', temperature: 0.1, max_tokens: 4096 });
    expect(usage).toEqual({ inputTokens: 200, outputTokens: 40, reported: true });
  });

  it('adapts once when a provider rejects max_tokens or temperature, and remembers it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const replies = [
      new Response('{"error":{"message":"Unsupported parameter: max_tokens. Use max_completion_tokens instead."}}', { status: 400 }),
      new Response('{"error":{"message":"Unsupported value: temperature does not support 0.1"}}', { status: 400 }),
      ok({ choices: [{ message: { content: 'done' } }] }),
      ok({ choices: [{ message: { content: 'again' } }] }),
    ];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => (bodies.push(JSON.parse(String(init.body))), replies.shift()!)));
    const quirks: Quirks = { noTemperature: false, completionTokens: false };
    const usage: Usage = { inputTokens: 0, outputTokens: 0, reported: false };
    expect((await modelReply([], inference, usage, quirks)).content).toBe('done');
    expect(bodies[2]).toMatchObject({ max_completion_tokens: 8192 });
    expect(bodies[2]).not.toHaveProperty('temperature');
    expect(bodies[2]).not.toHaveProperty('max_tokens');
    await modelReply([], inference, usage, quirks);
    expect(bodies).toHaveLength(4);
    expect(usage.reported).toBe(false);
  });

  it('gives up on other errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"bad request"}', { status: 400 })));
    await expect(modelReply([], inference, { inputTokens: 0, outputTokens: 0, reported: false }, { noTemperature: false, completionTokens: false })).rejects.toThrow('HTTP 400');
  });

  it('only accepts HTTPS inference endpoints in requests', () => {
    const base = { protocolVersion: 1, requestId: '123e4567-e89b-12d3-a456-426614174000', repository: { owner: 'o', repo: 'r', ref: 'main', accessToken: 't' }, task: 'Build it.' };
    expect(executionWorkerRequestSchema.safeParse({ ...base, inference }).success).toBe(true);
    expect(executionWorkerRequestSchema.safeParse({ ...base, inference: { ...inference, endpoint: 'http://169.254.169.254/latest' } }).success).toBe(false);
  });
});
