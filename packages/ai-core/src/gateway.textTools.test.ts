import { describe, expect, it, vi } from 'vitest';
import { invokeModelWithTools, responseFormatBody, toolCallsFromText, type GatewayConfiguration } from './gateway';

const TOOLS = ['company_metrics', 'repo_search'];
const args = (calls: { function: { arguments: string } }[], i = 0) => JSON.parse(calls[i].function.arguments);

describe('tool calls written as text', () => {
  it('reads Qwen/Hermes <tool_call> blocks and keeps the surrounding text', () => {
    const { calls, rest } = toolCallsFromText('Let me check.\n<tool_call>\n{"name": "company_metrics", "arguments": {"company": "Playbound.club", "metric": "visitors", "days": 7}}\n</tool_call>', TOOLS);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('company_metrics');
    expect(args(calls)).toEqual({ company: 'Playbound.club', metric: 'visitors', days: 7 });
    expect(rest).toBe('Let me check.');
  });

  it('reads fenced and bare JSON calls, including "parameters" and nested "function"', () => {
    expect(args(toolCallsFromText('```json\n{"name":"repo_search","parameters":{"company":"PlayBound","query":"OpenHV"}}\n```', TOOLS).calls)).toEqual({ company: 'PlayBound', query: 'OpenHV' });
    expect(toolCallsFromText('{"function": {"name": "repo_search", "arguments": "{\\"query\\":\\"OpenHV\\"}"}}', TOOLS).calls[0].function.arguments).toBe('{"query":"OpenHV"}');
    expect(toolCallsFromText('[{"name":"repo_search","arguments":{"query":"a"}},{"name":"company_metrics","arguments":{}}]', TOOLS).calls).toHaveLength(2);
  });

  it('reads Gemma-style name(key=value) calls', () => {
    const { calls, rest } = toolCallsFromText('```tool_code\nprint(company_metrics(company="Playbound.club", metric=\'visitors\', days=7))\n```', TOOLS);
    expect(args(calls)).toEqual({ company: 'Playbound.club', metric: 'visitors', days: 7 });
    expect(rest).toBe('');
    expect(args(toolCallsFromText('repo_search(company="PlayBound", query="OpenHV")', TOOLS).calls)).toEqual({ company: 'PlayBound', query: 'OpenHV' });
  });

  it('ignores tools that were not offered and ordinary prose or JSON answers', () => {
    expect(toolCallsFromText('<tool_call>{"name":"delete_everything","arguments":{}}</tool_call>', TOOLS).calls).toEqual([]);
    expect(toolCallsFromText('PlayBound had 1,204 visitors. You could use company_metrics(company) next time.', TOOLS).calls).toEqual([]);
    expect(toolCallsFromText('{"route":"answer"}', TOOLS).calls).toEqual([]);
    expect(toolCallsFromText('repo_search(query=os.system("rm -rf /"))', TOOLS).calls).toEqual([]);
  });

  it('turns a text call from a host without a parser into a real tool call, and tolerates extra fields', async () => {
    const config: GatewayConfiguration = { endpoint: 'https://llm.rogly.net/v1/chat/completions', bearerToken: 't', model: 'gemma', protocol: 'openai-chat' };
    const tools = TOOLS.map((name) => ({ type: 'function' as const, function: { name, description: name, parameters: { type: 'object' } } }));
    const request = { role: 'worker' as const, messages: [{ role: 'user' as const, content: 'visitors?' }], maxOutputTokens: 100, tools };
    const text = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: '<tool_call>{"name":"company_metrics","arguments":{"company":"PB"}}</tool_call>' }, finish_reason: 'stop' }] }));
    const fromText = await invokeModelWithTools(config, request, { fetcher: text });
    expect(fromText.toolCalls.map((c) => c.function.name)).toEqual(['company_metrics']);
    expect(fromText.content).toBe('');

    const extra = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ choices: [{ message: { content: null, tool_calls: [{ index: 0, id: 'x', type: 'function', function: { name: 'repo_search', arguments: { query: 'OpenHV' } } }] }, finish_reason: 'tool_calls' }] })
    );
    const withIndex = await invokeModelWithTools(config, request, { fetcher: extra });
    expect(withIndex.toolCalls).toEqual([{ id: 'x', type: 'function', function: { name: 'repo_search', arguments: '{"query":"OpenHV"}' } }]);
  });

  it('builds response_format bodies', () => {
    expect(responseFormatBody(undefined)).toEqual({});
    expect(responseFormatBody({ type: 'json_object' })).toEqual({ response_format: { type: 'json_object' } });
    expect(responseFormatBody({ type: 'json_schema', name: 'route', schema: { type: 'object' } })).toEqual({
      response_format: { type: 'json_schema', json_schema: { name: 'route', schema: { type: 'object' }, strict: true } },
    });
  });
});

describe('prompted tool mode', () => {
  it('describes the tools in the system prompt, turns tool history into text, and keeps turns alternating', async () => {
    const { promptedToolMessages } = await import('./gateway');
    const tools = [{ type: 'function' as const, function: { name: 'repo_search', description: 'Search code', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }];
    const out = promptedToolMessages(
      [
        { role: 'system', content: 'Be exact.' },
        { role: 'user', content: 'Find OpenHV' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'repo_search', arguments: '{"query":"OpenHV"}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: 'games.ts:12' },
        { role: 'user', content: 'Now remove it' },
      ],
      tools
    );
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(out[0].content).toContain('Be exact.');
    expect(out[0].content).toContain('- repo_search: Search code');
    expect(out[2].content).toBe('<tool_call>\n{"name":"repo_search","arguments":{"query":"OpenHV"}}\n</tool_call>');
    expect(out[3].content).toBe('<tool_response name="repo_search">\ngames.ts:12\n</tool_response>\n\nNow remove it');
  });

  it('sends no tools parameter in prompted mode and reads the call back', async () => {
    const config: GatewayConfiguration = { endpoint: 'https://llm.rogly.net/v1/chat/completions', bearerToken: 't', model: 'gemma', protocol: 'openai-chat', toolMode: 'prompted' };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: '<tool_call>{"name":"repo_search","arguments":{"query":"x"}}</tool_call>' }, finish_reason: 'stop' }] }));
    const tools = [{ type: 'function' as const, function: { name: 'repo_search', description: 'Search', parameters: { type: 'object' } } }];
    const result = await invokeModelWithTools(config, { role: 'worker', messages: [{ role: 'user', content: 'find x' }], maxOutputTokens: 50, tools }, { fetcher });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]!.body));
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].role).toBe('system');
    expect(result.toolCalls[0].function.name).toBe('repo_search');
  });
});

describe('Gemma 4 tool calls', () => {
  it('reads the native <|tool_call>call:name{…}<tool_call|> form with <|"|> strings', () => {
    const { calls, rest } = toolCallsFromText('<|tool_call>call:company_metrics{company:<|"|>Playbound.club<|"|>,days:7,metric:<|"|>visitors<|"|>}<tool_call|>', TOOLS);
    expect(calls.map((c) => c.function.name)).toEqual(['company_metrics']);
    expect(args(calls)).toEqual({ company: 'Playbound.club', days: 7, metric: 'visitors' });
    expect(rest).toBe('');
    expect(args(toolCallsFromText('<|tool_call>call:repo_search{company:<|"|>PlayBound<|"|>,query:<|"|>OpenHV game server listing<|"|>}<tool_call|>', TOOLS).calls)).toEqual({
      company: 'PlayBound',
      query: 'OpenHV game server listing',
    });
  });

  it('reads call:name{JSON} and keeps braces and commas inside strings', () => {
    expect(args(toolCallsFromText('call:company_metrics{"company":"Playbound.club","metric":"visitors","days":7}', TOOLS).calls)).toEqual({ company: 'Playbound.club', metric: 'visitors', days: 7 });
    expect(args(toolCallsFromText('call:repo_search{query:<|"|>a {b}, c: d<|"|>}', TOOLS).calls)).toEqual({ query: 'a {b}, c: d' });
    expect(toolCallsFromText('call:drop_tables{}', TOOLS).calls).toEqual([]);
  });
});
