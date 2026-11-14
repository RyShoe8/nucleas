import { describe, expect, it, vi } from 'vitest';
import { invokeModel, invokeModelWithTools, withCacheTally, type GatewayConfiguration } from './gateway';

const config: GatewayConfiguration = { endpoint: 'https://openrouter.ai/api/v1/chat/completions', bearerToken: 'k', model: 'anthropic/claude-sonnet-5.5', protocol: 'openai-chat' };
const tools = [{ type: 'function' as const, function: { name: 'web_search', description: 'Search', parameters: { type: 'object', properties: {} } } }];
const reply = (usage: unknown) => Response.json({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }], usage });
const body = (fetcher: ReturnType<typeof vi.fn>) => JSON.parse(String(fetcher.mock.calls[0][1].body));

describe('prompt caching', () => {
  it('asks the host to cache a tool loop only when the model is set up for it', async () => {
    const cached = vi.fn<typeof fetch>().mockResolvedValue(reply({ prompt_tokens: 10, completion_tokens: 1 }));
    await invokeModelWithTools({ ...config, promptCache: true }, { role: 'worker', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 100, tools }, { fetcher: cached });
    expect(body(cached).cache_control).toEqual({ type: 'ephemeral' });

    const plain = vi.fn<typeof fetch>().mockResolvedValue(reply({ prompt_tokens: 10, completion_tokens: 1 }));
    await invokeModelWithTools(config, { role: 'worker', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 100, tools }, { fetcher: plain });
    expect(body(plain)).not.toHaveProperty('cache_control');
  });

  it('never asks a single plain call to cache, which would cost more with nothing to reuse', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ prompt_tokens: 10, completion_tokens: 1 }));
    await invokeModel({ ...config, promptCache: true }, { role: 'architect', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 100 }, { fetcher });
    expect(body(fetcher)).not.toHaveProperty('cache_control');
  });

  it('tallies the cache tokens each call reports, inside its own scope only', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ prompt_tokens: 5000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 4800 } }))
      .mockResolvedValueOnce(reply({ prompt_tokens: 5200, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 4800, cache_write_tokens: 0 } }));
    const request = { role: 'worker' as const, messages: [{ role: 'user' as const, content: 'hi' }], maxOutputTokens: 100, tools };
    const tally = await withCacheTally(async (inside) => {
      await invokeModelWithTools(config, request, { fetcher });
      await invokeModelWithTools(config, request, { fetcher });
      return inside;
    });
    expect(tally).toEqual({ readTokens: 4800, writeTokens: 4800 });
  });
});
