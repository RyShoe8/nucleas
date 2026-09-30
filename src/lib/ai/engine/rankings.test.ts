import { describe, expect, it } from 'vitest';
import { buildRanking } from './rankings';
import type { AvailableModel } from './catalog';
import type { BenchmarkRow } from './benchmarks';

const model = (over: Partial<AvailableModel>): AvailableModel => ({
  profileId: 'p', profileLabel: 'Prov', provider: 'custom', model: 'm', label: 'm', free: false, strengths: [], flagship: false,
  contextTokens: null, blendedPricePer1M: 1, autoEligible: true, benchmark: null, ...over,
});
const bench = (intelligence: number, coding: number | null = null) => ({ intelligence, coding, math: null, source: 'slug' });
const checks = (o: number) => ({ status: 'done' as const, checkedAt: null, supports: { jsonSchema: true, jsonObject: true, tools: true }, scores: { json: o, routing: o, tools: o, grounded: o, code: o }, overall: o, avgLatencyMs: 1000, notes: [], toolMode: 'native' as const, error: null });

describe('buildRanking', () => {
  const paid = [model({ model: 'big-paid', benchmark: bench(60, 55) }), model({ model: 'mid-paid', benchmark: bench(40, 45), blendedPricePer1M: 0.5 })];

  it('puts a local model that is on the leaderboard among the scored models, labelled free, with its check score', () => {
    const local = [model({ model: 'Qwen/Qwen3-8B', free: true, blendedPricePer1M: null, checks: checks(0.9) })];
    const scores: BenchmarkRow[] = [{ slug: 'qwen3-8b', name: 'Qwen3 8B', creator: 'Alibaba', intelligence: 50, coding: 30, math: null }];
    const plan = buildRanking({ paid, local, scores, need: 'plan' });
    expect(plan.map((r) => [r.model, r.free])).toEqual([['big-paid', false], ['Qwen/Qwen3-8B', true], ['mid-paid', false]]);
    expect(plan[1]).toMatchObject({ price: null, check: expect.any(Number) });
    // The coding table orders by the coding index instead.
    expect(buildRanking({ paid, local, scores, need: 'code' }).map((r) => r.model)).toEqual(['big-paid', 'mid-paid', 'Qwen/Qwen3-8B']);
  });

  it('lists local models with no leaderboard entry after the scored ones, best check score first, without inventing a score', () => {
    const local = [
      model({ model: 'local-weak', free: true, blendedPricePer1M: null, checks: checks(0.4) }),
      model({ model: 'local-strong', free: true, blendedPricePer1M: null, checks: checks(0.95) }),
      model({ model: 'local-unmeasured', free: true, blendedPricePer1M: null }),
    ];
    const rows = buildRanking({ paid, local, scores: [], need: 'plan' });
    expect(rows.map((r) => r.model)).toEqual(['big-paid', 'mid-paid', 'local-strong', 'local-weak', 'local-unmeasured']);
    expect(rows.slice(2).every((r) => r.benchmark === null)).toBe(true);
    expect(rows[4].check).toBeNull();
  });
});
