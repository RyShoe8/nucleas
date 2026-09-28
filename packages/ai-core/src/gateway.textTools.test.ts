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
