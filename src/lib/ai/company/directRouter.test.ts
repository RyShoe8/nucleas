import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const profile = vi.hoisted(() => ({ tier: 'local_remote', provider: 'custom' }));
vi.mock('@/lib/ai/rolePipeline/profiles', () => ({
  gatewayFromModelProfile: async () => ({ gateway: { endpoint: 'https://llm.rogly.net/v1/chat/completions', bearerToken: 't', model: 'gemma', protocol: 'openai-chat' }, profile: { ...profile } }),
}));
const lock = vi.hoisted(() => ({ wait: vi.fn(async () => undefined), hold: vi.fn(async () => undefined), release: vi.fn(async () => undefined) }));
vi.mock('@/lib/ai/control/dispatchLock', () => ({ waitForDispatchLock: lock.wait, holdDispatchLock: lock.hold, releaseDispatchLock: lock.release }));

import { parseDecision, routeDirectRequest, routerPrompt, routeSchema } from './directRouter';

const COMPANIES = ['Playbound.club', 'Frugal Gambler'];
const base = { modelProfileId: 'p'.repeat(24), model: 'gemma', companies: COMPANIES, codeCompanies: ['Playbound.club'] };

beforeEach(() => {
  profile.tier = 'local_remote';
  profile.provider = 'custom';
  vi.clearAllMocks();
});

describe('Direct-mode router', () => {
  it('tells the model which companies have code and asks for a standalone request', () => {
    const prompt = routerPrompt(COMPANIES, ['Playbound.club']);
    expect(prompt).toContain('Only these companies have code connected: Playbound.club.');
    expect(prompt).toContain('exactly as written in this list, or "none": Playbound.club, Frugal Gambler');
    expect(prompt).toContain('"yes, do that"');
    expect(routeSchema(COMPANIES)).toMatchObject({ properties: { company: { enum: ['Playbound.club', 'Frugal Gambler', 'none'] } } });
  });

  it('reads decisions, matching company names loosely and keeping the original text when the restatement is empty', () => {
    expect(parseDecision('{"route":"code_change","company":"playbound.club ","request":"Remove the OpenHV listing under OpenRA"}', COMPANIES, 'orig')).toEqual({
      route: 'code_change',
      company: 'Playbound.club',
      request: 'Remove the OpenHV listing under OpenRA',
    });
    expect(parseDecision('{"route":"job","company":"none","request":""}', COMPANIES, 'Every day earn a backlink')).toEqual({ route: 'job', company: null, request: 'Every day earn a backlink' });
    expect(parseDecision('{"route":"delete"}', COMPANIES, 'x')).toBeNull();
    expect(parseDecision('I think this is a code change.', COMPANIES, 'x')).toBeNull();
  });

  it('sorts with the free model under the shared lock, with the conversation for follow-ups', async () => {
    const invoke = vi.fn(async () => ({ content: '{"route":"code_change","company":"Playbound.club","request":"On the game servers page remove the OpenHV listing under OpenRA"}' }));
    const decision = await routeDirectRequest({
      ...base,
      text: 'yes, do that',
      prior: [
        { role: 'user', text: 'The OpenHV listing shows under OpenRA on the game servers page' },
        { role: 'assistant', text: 'Want me to plan removing it?' },
      ],
      invoke,
    });
    expect(decision).toMatchObject({ route: 'code_change', company: 'Playbound.club' });
    const [, request] = invoke.mock.calls[0] as unknown as [unknown, { messages: { content: string }[]; responseFormat: { type: string } }];
    expect(request.messages[1].content).toContain('User: The OpenHV listing shows under OpenRA');
    expect(request.messages[1].content).toContain('Latest message:\nyes, do that');
    expect(request.responseFormat.type).toBe('json_object');
    expect(lock.wait).toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalled();
  });

  it('leaves paid models alone and falls back when sorting fails', async () => {
    profile.provider = 'openai';
    profile.tier = 'standard';
    const invoke = vi.fn(async () => ({ content: '{}' }));
    expect(await routeDirectRequest({ ...base, text: 'hello there', prior: [], invoke })).toBeNull();
    expect(invoke).not.toHaveBeenCalled();

    profile.provider = 'custom';
    const failing = vi.fn(async () => {
      throw new Error('down');
    });
    expect(await routeDirectRequest({ ...base, text: 'hello there', prior: [], invoke: failing })).toBeNull();
    expect(lock.release).toHaveBeenCalled();
  });
});
