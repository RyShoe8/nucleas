import { describe, expect, it } from 'vitest';
import type { AvailableModel } from './catalog';
import { selectFrom, type CostLevel, type Need } from './select';
import { buildModelMetaView } from '@/lib/ai/rolePipeline/modelMeta';

function model(id: string, free: boolean, price: number | null, profile = free ? 'rogly' : 'paid'): AvailableModel {
  const meta = buildModelMetaView({ id, free });
  return { profileId: profile, profileLabel: profile, model: id, label: meta.label, free, strengths: meta.strengths, flagship: Boolean(meta.flagship), contextTokens: meta.contextTokens, blendedPricePer1M: free ? 0 : price };
}

const ROGLY = [
  model('google/gemma-4-12B-it-qat-w4a16-ct', true, 0),
  model('Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', true, 0),
  model('Qwen/Qwen3-VL-8B-Thinking-FP8', true, 0),
];
const PAID = [
  model('o4-mini', false, 1.9),
  model('gpt-5.6-sol', false, 8),
  model('gpt-6-astra', false, 20),
  model('anthropic/claude-haiku-4.5', false, 2),
  model('anthropic/claude-sonnet-5', false, 4),
  model('gpt-4o', false, 4.4),
  model('some-unpriced-model', false, null),
];
const ALL = [...ROGLY, ...PAID];

const pick = (need: Need, level: CostLevel, models = ALL) => {
  const s = selectFrom(models, need, level);
  return { primary: s.primary?.model ?? null, fallback: s.fallback?.model ?? null };
};

describe('automatic model selection', () => {
  it('Rogly: always the strongest free model that fits the job', () => {
    expect(pick('write', 'low').primary).toBe('google/gemma-4-12B-it-qat-w4a16-ct');
    expect(pick('utility', 'high').primary).toBe('google/gemma-4-12B-it-qat-w4a16-ct');
    expect(pick('code', 'low').primary).toBe('Qwen/Qwen2.5-Coder-14B-Instruct-AWQ');
    expect(pick('research', 'medium').primary).toBe('Qwen/Qwen2.5-Coder-14B-Instruct-AWQ');
    expect(pick('vision', 'low').primary).toBe('Qwen/Qwen3-VL-8B-Thinking-FP8');
  });

  it('low: cheapest paid reasoning for plan/review, Rogly for the work, never a paid retry', () => {
    expect(pick('plan', 'low')).toEqual({ primary: 'o4-mini', fallback: null });
    expect(pick('review', 'low')).toEqual({ primary: 'o4-mini', fallback: null });
    expect(pick('write', 'low').fallback).toBeNull();
    expect(pick('code', 'low').fallback).toBeNull();
  });

  it('medium: mid-priced planning, Rogly work with a paid retry', () => {
    expect(pick('plan', 'medium').primary).toBe('anthropic/claude-sonnet-5');
    expect(pick('write', 'medium')).toEqual({ primary: 'google/gemma-4-12B-it-qat-w4a16-ct', fallback: 'anthropic/claude-sonnet-5' });
    expect(pick('code', 'medium').fallback).not.toBeNull();
  });

  it('high: flagship planning/review, paid work, Rogly only for utilities', () => {
    expect(pick('plan', 'high').primary).toBe('gpt-6-astra');
    expect(pick('review', 'high').primary).toBe('gpt-6-astra');
    expect(pick('write', 'high').primary).not.toMatch(/gemma|Qwen/);
    expect(pick('code', 'high').primary).toBe('gpt-6-astra');
    expect(pick('vision', 'high').primary).toBe('gpt-4o');
    expect(pick('utility', 'high').primary).toBe('google/gemma-4-12B-it-qat-w4a16-ct');
  });

  it('never auto-selects paid models with unknown prices', () => {
    for (const need of ['plan', 'review', 'write', 'code'] as Need[]) {
      for (const level of ['low', 'medium', 'high'] as CostLevel[]) {
        expect(pick(need, level).primary).not.toBe('some-unpriced-model');
      }
    }
  });

  it('falls back to Rogly when no paid credential exists, and to paid when Rogly is missing', () => {
    expect(pick('plan', 'high', ROGLY).primary).not.toBeNull();
    expect(pick('write', 'low', PAID).primary).toBe('anthropic/claude-haiku-4.5');
    expect(pick('vision', 'low', PAID).primary).toBe('gpt-4o');
  });
});
