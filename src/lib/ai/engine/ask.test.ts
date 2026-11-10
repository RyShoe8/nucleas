import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const chat = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/companyChat', () => ({ attemptCompanyCredentialChat: chat }));
vi.mock('@/lib/ai/company/assistantLedger', () => ({ assistantLedgerProjectId: () => 'ledger' }));
const engine = vi.hoisted(() => ({ settings: { defaultCostLevel: 'medium', overrides: {}, priceCeilings: {} }, selection: {} as unknown }));
vi.mock('./select', () => ({ readEngineSettings: async () => engine.settings, selectModel: async () => engine.selection }));
const queue = vi.hoisted(() => ({ busy: false }));
vi.mock('@/lib/ai/control/dispatchLock', () => ({ freeModelBusy: async () => queue.busy }));

import { askEngine } from './ask';

const input = { organizationId: 'o', userId: 'u', need: 'write' as const, system: 's', user: 'u', maxTokens: 100 };
const free = { profileId: 'p1', model: 'free-model', free: true, label: 'Rogly' };
const paid = { profileId: 'p2', model: 'paid-model', free: false, label: 'OpenAI' };
const ok = (text: string) => ({ role: 'assistant', text });

beforeEach(() => {
  chat.mockReset();
  queue.busy = false;
});

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

describe('askEngine time limits and waiting people', () => {
  it('gives the fallback its own time when the free model times out', async () => {
    engine.selection = { primary: free, fallback: paid };
    const signals: AbortSignal[] = [];
    chat.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
      throw new Error('aborted');
    }).mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return ok('paid answer');
    });
    const failures: string[] = [];
    expect(await askEngine({ ...input, attemptTimeoutMs: 30, onFailure: (f) => failures.push(`${f.model}: ${f.reason}`) })).toEqual({ text: 'paid answer', model: 'paid-model', usedFallback: true });
    expect(signals[1]?.aborted).toBe(false);
    expect(failures).toEqual([expect.stringMatching(/^free-model: Timed out waiting for the model after \d+s \(its own time limit/)]);
  });

  it('answers a waiting person on the paid fallback when the free model is busy with background work', async () => {
    engine.selection = { primary: free, fallback: paid };
    queue.busy = true;
    chat.mockResolvedValueOnce(ok('right away'));
    expect(await askEngine({ ...input, interactive: true })).toEqual({ text: 'right away', model: 'paid-model', usedFallback: true });
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ model: 'paid-model' }));
  });

  it('keeps background work and free-only levels on the free model', async () => {
    queue.busy = true;
    engine.selection = { primary: free, fallback: paid };
    chat.mockResolvedValueOnce(ok('queued'));
    expect(await askEngine(input)).toMatchObject({ model: 'free-model' });
    engine.selection = { primary: free, fallback: null };
    chat.mockResolvedValueOnce(ok('free only'));
    expect(await askEngine({ ...input, interactive: true })).toMatchObject({ model: 'free-model' });
  });

  describe('when a paid model fails', () => {
    const second = { profileId: 'p3', model: 'second-best', free: false, label: 'Anthropic' };
    const sameKey = { profileId: 'p2', model: 'same-key-model', free: false, label: 'OpenAI' };
    const third = { profileId: 'p4', model: 'third-best', free: false, label: 'Google' };

    it('tries the next best paid models in order until one answers', async () => {
      engine.selection = { primary: paid, fallback: null, backups: [second, third] };
      chat.mockResolvedValueOnce({ role: 'status', text: 'The model did not respond.' }).mockResolvedValueOnce({ role: 'status', text: 'Timed out.' }).mockResolvedValueOnce(ok('third answered'));
      expect(await askEngine({ ...input, need: 'plan' })).toEqual({ text: 'third answered', model: 'third-best', usedFallback: true });
      expect(chat.mock.calls.map((c) => c[0].model)).toEqual(['paid-model', 'second-best', 'third-best']);
    });

    it('skips other models on a credential that is out of credits', async () => {
      engine.selection = { primary: paid, fallback: null, backups: [sameKey, second] };
      chat.mockResolvedValueOnce({ role: 'status', text: 'Insufficient credits on this account.' }).mockResolvedValueOnce(ok('other provider answered'));
      expect(await askEngine({ ...input, need: 'plan' })).toEqual({ text: 'other provider answered', model: 'second-best', usedFallback: true });
      expect(chat.mock.calls.map((c) => c[0].model)).toEqual(['paid-model', 'second-best']);
    });

    it('covers the paid retry of a free model too', async () => {
      engine.selection = { primary: free, fallback: paid, backups: [second] };
      chat.mockResolvedValueOnce({ role: 'error', text: '' }).mockResolvedValueOnce({ role: 'status', text: 'No response.' }).mockResolvedValueOnce(ok('stand-in'));
      expect(await askEngine(input)).toMatchObject({ model: 'second-best' });
    });

    it('never starts paying when only a free model failed', async () => {
      engine.selection = { primary: free, fallback: null, backups: [second] };
      chat.mockResolvedValueOnce({ role: 'error', text: '' });
      expect(await askEngine(input)).toBeNull();
      expect(chat).toHaveBeenCalledTimes(1);
    });
  });
});
