import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./checkResults', () => ({ AiModelCheck: {}, toCheckRow: () => ({}) }));
vi.mock('./catalog', () => ({ listAvailableModels: async () => [] }));
vi.mock('@/lib/ai/rolePipeline/profiles', () => ({ gatewayFromModelProfile: async () => ({}) }));
vi.mock('@/lib/ai/control/dispatchLock', () => ({ holdDispatchLock: async () => {}, releaseDispatchLock: async () => {}, waitForDispatchLock: async () => {} }));

import { CHECK_STAGES, finishCheck, newProgress, runCheckStage, type CheckCaller, type CheckProgress } from './modelChecks';

/** A deterministic stand-in model that counts its calls, so runs can be compared. */
function fakeCaller(): CheckCaller & { calls: number } {
  const caller = {
    calls: 0,
    async plain() {
      caller.calls += 1;
      return { text: '{"route":"question","company":null}', latencyMs: 10 };
    },
    async tools() {
      caller.calls += 1;
      return { text: '', toolCalls: [], latencyMs: 10 };
    },
  };
  return caller;
}

async function runAll(caller: CheckCaller, p: CheckProgress, hooks: Parameters<typeof runCheckStage>[4] = {}) {
  for (const stage of CHECK_STAGES.filter((s) => !p.done.includes(s))) {
    if ((await runCheckStage(caller, stage, p, undefined, hooks)) === 'paused') return 'paused';
  }
  return 'done';
}

describe('resumable model checks', () => {
  it('a check paused after every few calls and resumed from saved progress matches an uninterrupted one', async () => {
    const whole = fakeCaller();
    const wholeProgress = newProgress();
    expect(await runAll(whole, wholeProgress)).toBe('done');
    const expected = finishCheck(wholeProgress);

    const resumed = fakeCaller();
    let saved = newProgress();
    let runs = 0;
    while (runs < 200) {
      runs += 1;
      // Each "run" is a fresh process: restore only what was persisted, allow 4 calls, then pause.
      const progress: CheckProgress = structuredClone(saved);
      let allowed = 4;
      const outcome = await runAll(resumed, progress, {
        canCall: () => allowed-- > 0,
        onStep: async () => { saved = structuredClone(progress); },
      });
      saved = structuredClone(progress);
      if (outcome === 'done') break;
    }

    expect(runs).toBeGreaterThan(3);
    expect(resumed.calls).toBe(whole.calls); // nothing was repeated and nothing skipped
    expect(finishCheck(saved)).toEqual(expected);
    expect(saved.cursor).toBeUndefined();
    expect(saved.toolRun).toBeUndefined();
  });

  it('records finished cases in the cursor when it pauses mid-stage', async () => {
    const p = newProgress();
    p.done.push('json');
    let allowed = 3;
    const outcome = await runCheckStage(fakeCaller(), 'routing', p, undefined, { canCall: () => allowed-- > 0 });
    expect(outcome).toBe('paused');
    expect(p.cursor).toEqual({ stage: 'routing', index: 3 });
    expect(p.routed).toHaveLength(3);
    expect(p.done).toEqual(['json']);
  });
});
