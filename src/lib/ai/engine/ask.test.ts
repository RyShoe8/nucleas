import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const chat = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/companyChat', () => ({ attemptCompanyCredentialChat: chat }));
vi.mock('@/lib/ai/company/assistantLedger', () => ({ assistantLedgerProjectId: () => 'ledger' }));
const engine = vi.hoisted(() => ({ settings: { defaultCostLevel: 'medium', overrides: {}, priceCeilings: {} }, selection: {} as unknown }));
vi.mock('./select', () => ({ readEngineSettings: async () => engine.settings, selectModel: async () => engine.selection }));

import { askEngine } from './ask';

const input = { organizationId: 'o', userId: 'u', need: 'write' as const, system: 's', user: 'u', maxTokens: 100 };
const free = { profileId: 'p1', model: 'free-model', free: true, label: 'Rogly' };
const paid = { profileId: 'p2', model: 'paid-model', free: false, label: 'OpenAI' };
const ok = (text: string) => ({ role: 'assistant', text });

beforeEach(() => chat.mockReset());

describe('askEngine', () => {
  it('uses the engine pick for the need and reports the model', async () => {
    engine.selection = { primary: free, fallback: null };
    chat.mockResolvedValueOnce(ok('hello'));
    expect(await askEngine(input)).toEqual({ text: 'hello', model: 'free-model', usedFallback: false });
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ model: 'free-model', modelProfileId: 'p1', maxOutputTokensOverride: 100 }));
  });

  it('retries once on the level’s paid fallback when the free model fails (medium)', async () => {
    engine.selection = { primary: free, fallback: paid };
    chat.mockResolvedValueOnce({ role: 'error', text: '' }).mockResolvedValueOnce(ok('rescued'));
    expect(await askEngine(input)).toEqual({ text: 'rescued', model: 'paid-model', usedFallback: true });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('never pays to retry when the level has no fallback, and returns null when nothing answers', async () => {
    engine.selection = { primary: free, fallback: null };
    chat.mockRejectedValueOnce(new Error('upstream down'));
    expect(await askEngine(input)).toBeNull();
    expect(chat).toHaveBeenCalledTimes(1);
    engine.selection = { primary: null, fallback: null };
    expect(await askEngine(input)).toBeNull();
  });
});
