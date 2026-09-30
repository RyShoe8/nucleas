import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { matchBenchmark, modelKey, parseQuantization, type BenchmarkRow } from './benchmarks';

const row = (slug: string, intelligence: number, coding: number | null = null): BenchmarkRow => ({ slug, name: slug, creator: 'x', intelligence, coding, math: null });

describe('parseQuantization', () => {
  it('reads compression tags and picks a conservative factor', () => {
    expect(parseQuantization('Qwen/Qwen3-VL-8B-Thinking-FP8')).toMatchObject({ label: 'FP8', factor: 0.995 });
    expect(parseQuantization('Qwen/Qwen2.5-Coder-14B-Instruct-AWQ')).toMatchObject({ label: 'AWQ 4-bit', factor: 0.97 });
    expect(parseQuantization('llama-3.1-8b-instruct-Q4_K_M.gguf')).toMatchObject({ factor: 0.97 });
    expect(parseQuantization('llama-3.1-8b-instruct-q2_k-gguf').factor).toBe(0.85);
  });

  it('does not stack QAT with the 4-bit tag describing the same weights, in either order', () => {
    expect(parseQuantization('google/gemma-4-12B-it-qat-w4a16-ct').factor).toBe(0.985);
    expect(parseQuantization('gemma-4-12b-w4a16-qat').factor).toBe(0.985);
  });

  it('leaves uncompressed and hosted models alone', () => {
    expect(parseQuantization('gpt-5-mini')).toMatchObject({ tokens: [], label: null, factor: 1 });
    expect(parseQuantization('anthropic/claude-sonnet-4.5')).toMatchObject({ factor: 1, label: null });
  });
});

describe('matching compressed local models to the leaderboard', () => {
  it('ignores compression tags when identifying the model', () => {
    expect(modelKey('Qwen/Qwen3-VL-8B-Thinking-FP8')).toBe(modelKey('qwen3-vl-8b-reasoning'));
    expect(modelKey('google/gemma-4-12B-it-qat-w4a16-ct')).toBe(modelKey('gemma-4-12b'));
  });

  it('scores an FP8 copy at the listed model, discounted, and marks it as an estimate', () => {
    const b = matchBenchmark('Qwen/Qwen3-VL-8B-Thinking-FP8', [row('qwen3-vl-8b-reasoning', 40, 30)]);
    expect(b).toMatchObject({ intelligence: 39.8, coding: 29.9, source: 'qwen3-vl-8b-reasoning', estimated: { quantization: 'FP8', factor: 0.995 } });
  });

  it('discounts 4-bit more, and does not invent a score for a model that is not listed', () => {
    expect(matchBenchmark('Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', [row('qwen2-5-coder-14b-instruct', 20, 25)])).toMatchObject({ intelligence: 19.4, coding: 24.3, estimated: { factor: 0.97 } });
    expect(matchBenchmark('Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', [row('qwen2-5-coder-32b-instruct', 30)])).toBeNull();
  });

  it('gives paid, uncompressed models their listed score untouched and unflagged', () => {
    const b = matchBenchmark('gpt-5-mini', [row('gpt-5-mini', 64.2, 55)]);
    expect(b).toEqual({ intelligence: 64.2, coding: 55, math: null, source: 'gpt-5-mini' });
    expect(b).not.toHaveProperty('estimated');
  });
});
