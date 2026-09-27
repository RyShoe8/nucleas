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

  it('paid picks by power rank for the task: high #1, medium #2, low #3', () => {
    expect(pick('plan', 'high').primary).toBe('gpt-6-astra');
    expect(pick('plan', 'medium').primary).toBe('gpt-5.6-sol');
    expect(pick('plan', 'low').primary).toBe('anthropic/claude-sonnet-5');
    expect(pick('review', 'low').primary).toBe('anthropic/claude-sonnet-5');
  });

  it('low and medium keep the work on Rogly; medium retries on its #2 paid model, low never pays to retry', () => {
    expect(pick('write', 'low')).toEqual({ primary: 'google/gemma-4-12B-it-qat-w4a16-ct', fallback: null });
    expect(pick('code', 'low').fallback).toBeNull();
    expect(pick('write', 'medium')).toEqual({ primary: 'google/gemma-4-12B-it-qat-w4a16-ct', fallback: 'gpt-4o' });
    expect(pick('code', 'medium')).toEqual({ primary: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', fallback: 'gpt-5.6-sol' });
  });

  it('high: the #1 paid model for the task does the work; utilities stay on Rogly', () => {
    expect(pick('write', 'high').primary).toBe('gpt-5.6-sol');
    expect(pick('code', 'high').primary).toBe('gpt-6-astra');
    expect(pick('vision', 'high').primary).toBe('gpt-4o');
    expect(pick('utility', 'high').primary).toBe('google/gemma-4-12B-it-qat-w4a16-ct');
  });

  it('uses the nearest available rank when a task has fewer than three capable models', () => {
    const two = [...ROGLY, model('o4-mini', false, 1.9), model('gpt-5.6-sol', false, 8)];
    expect(pick('plan', 'low', two).primary).toBe('o4-mini');
    expect(pick('plan', 'medium', two).primary).toBe('o4-mini');
    expect(pick('plan', 'high', two).primary).toBe('gpt-5.6-sol');
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
    expect(pick('write', 'low', PAID).primary).toBe('anthropic/claude-sonnet-5');
    expect(pick('vision', 'low', PAID).primary).toBe('gpt-4o');
  });
});
