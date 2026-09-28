import { describe, expect, it } from 'vitest';
import type { AvailableModel } from './catalog';
import { checkScore, selectFrom, type CostLevel, type Need } from './select';
import { buildModelMetaView } from '@/lib/ai/rolePipeline/modelMeta';

function model(id: string, free: boolean, price: number | null, profile = free ? 'rogly' : 'paid'): AvailableModel {
  const meta = buildModelMetaView({ id, free });
  return { profileId: profile, profileLabel: profile, provider: free ? 'custom' : 'openai', model: id, label: meta.label, free, strengths: meta.strengths, flagship: Boolean(meta.flagship), contextTokens: meta.contextTokens, blendedPricePer1M: free ? 0 : price, autoEligible: true, benchmark: null };
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

const scored = (id: string, price: number, intelligence: number, coding: number) => ({ ...model(id, false, price), benchmark: { intelligence, coding, math: null, source: id } });
const SCORED = [
  scored('anthropic/claude-opus-5.5', 8, 58, 80),
  scored('anthropic/claude-fable-5.1', 20, 53, 82),
  scored('gpt-6-astra', 20, 52.7, 77),
  scored('gpt-6-sol', 4, 47.5, 60),
  scored('meta/muse-spark-1.3', 2, 48.1, 76),
  scored('xiaomi/mimo-v2.6-pro', 0.54, 46.3, 70),
  scored('gemini-3.8-flash', 1.5, 40.9, 75),
  scored('gpt-4o', 4.4, 30, 40),
  model('some-unpriced-model', false, null),
  model('unscored-model', false, 3),
];
const WITH_SCORES = [...ROGLY, ...SCORED];

describe('automatic model selection', () => {
  it('Rogly: always the strongest free model that fits the job', () => {
    expect(pick('write', 'low').primary).toBe('google/gemma-4-12B-it-qat-w4a16-ct');
    expect(pick('utility', 'high').primary).toBe('google/gemma-4-12B-it-qat-w4a16-ct');
    expect(pick('code', 'low').primary).toBe('Qwen/Qwen2.5-Coder-14B-Instruct-AWQ');
    expect(pick('research', 'medium').primary).toBe('Qwen/Qwen2.5-Coder-14B-Instruct-AWQ');
    expect(pick('vision', 'low').primary).toBe('Qwen/Qwen3-VL-8B-Thinking-FP8');
  });

  it('each level plans with the best-scoring model under its price ceiling, from every provider', () => {
    expect(pick('plan', 'high', WITH_SCORES).primary).toBe('anthropic/claude-opus-5.5');
    expect(pick('plan', 'medium', WITH_SCORES).primary).toBe('meta/muse-spark-1.3');
    expect(pick('plan', 'low', WITH_SCORES).primary).toBe('xiaomi/mimo-v2.6-pro');
    expect(pick('review', 'low', WITH_SCORES).primary).toBe('xiaomi/mimo-v2.6-pro');
  });

  it('only benchmarked models take part once scores exist; unpriced models never do', () => {
    for (const need of ['plan', 'review', 'write', 'research', 'code'] as Need[]) {
      for (const level of ['low', 'medium', 'high'] as CostLevel[]) {
        const s = selectFrom(WITH_SCORES, need, level);
        for (const m of [s.primary?.model, s.fallback?.model]) {
          expect(m).not.toBe('some-unpriced-model');
          expect(m).not.toBe('unscored-model');
        }
      }
    }
  });

  it('low and medium keep the work on Rogly; medium retries on its paid pick, low never pays to retry', () => {
    expect(pick('write', 'low', WITH_SCORES)).toEqual({ primary: 'google/gemma-4-12B-it-qat-w4a16-ct', fallback: null });
    expect(pick('code', 'low', WITH_SCORES).fallback).toBeNull();
    expect(pick('write', 'medium', WITH_SCORES)).toEqual({ primary: 'google/gemma-4-12B-it-qat-w4a16-ct', fallback: 'meta/muse-spark-1.3' });
    expect(pick('code', 'medium', WITH_SCORES)).toEqual({ primary: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', fallback: 'meta/muse-spark-1.3' });
  });

  it('high: the best model under the medium ceiling does the work, by the task’s score; utilities stay on Rogly', () => {
    expect(pick('write', 'high', WITH_SCORES).primary).toBe('meta/muse-spark-1.3');
    expect(pick('research', 'high', WITH_SCORES).primary).toBe('meta/muse-spark-1.3');
    // Code ranks on the coding score: muse 76 beats gemini flash 75, mimo 70 and gpt-6-sol 60.
    expect(pick('code', 'high', WITH_SCORES).primary).toBe('meta/muse-spark-1.3');
    expect(pick('utility', 'high', WITH_SCORES).primary).toBe('google/gemma-4-12B-it-qat-w4a16-ct');
  });

  it('uses edited ceilings, and the cheapest model when nothing fits under one', () => {
    const ceilings = { low: 0.1, medium: 25, high: null };
    expect(selectFrom(WITH_SCORES, 'plan', 'low', ceilings).primary?.model).toBe('xiaomi/mimo-v2.6-pro');
    expect(selectFrom(WITH_SCORES, 'plan', 'medium', ceilings).primary?.model).toBe('anthropic/claude-opus-5.5');
  });

  it('without benchmark scores, falls back to price as the power signal', () => {
    expect(pick('plan', 'high').primary).toBe('gpt-6-astra');
    expect(pick('plan', 'medium').primary).toBe('anthropic/claude-sonnet-5');
  });

  it('falls back to Rogly when no paid credential exists, and to paid when Rogly is missing', () => {
    expect(pick('plan', 'high', ROGLY).primary).not.toBeNull();
    expect(pick('write', 'low', PAID).primary).not.toBeNull();
    expect(pick('vision', 'low', PAID).primary).toBe('gpt-4o');
  });
});

describe('catalog normalisation', () => {
  it('normalises provider quirks and filters non-chat and legacy models from automatic selection', async () => {
    const { normalizeModelId, isTextChatModel, describeModel } = await import('./catalog');
    expect(normalizeModelId('models/gemini-3.1-pro-preview')).toBe('gemini-3.1-pro-preview');
    expect(normalizeModelId('gpt-5-2025-08-07')).toBe('gpt-5');
    expect(isTextChatModel('models/gemini-2.5-flash-preview-tts')).toBe(false);
    expect(isTextChatModel('gpt-4o-mini-transcribe')).toBe(false);
    expect(isTextChatModel('models/veo-3.1-generate-preview')).toBe(false);
    expect(isTextChatModel('gpt-5.2')).toBe(true);

    const rows = [
      { id: 'gemini/gemini-3.1-pro-preview', provider: 'gemini', mode: 'chat', input: 2, output: 12, cacheRead: null, variable: false, supportsReasoning: true },
      { id: 'gpt-4', provider: 'openai', mode: 'chat', input: 30, output: 60, cacheRead: null, variable: false, supportsTools: true },
      { id: 'gpt-5.2', provider: 'openai', mode: 'chat', input: 1.25, output: 10, cacheRead: null, variable: false, supportsReasoning: true, supportsTools: true },
      { id: 'gpt-5-pro', provider: 'openai', mode: 'chat', input: 15, output: 120, cacheRead: null, variable: false, supportsReasoning: true },
    ];
    const gemini = describeModel('models/gemini-3.1-pro-preview', 'google', false, rows);
    expect(gemini).toMatchObject({ blendedPricePer1M: 4.5, autoEligible: true });
    expect(gemini.strengths).toContain('reasoning');
    expect(describeModel('gpt-5.2', 'openai', false, rows)).toMatchObject({ autoEligible: true, strengths: expect.arrayContaining(['reasoning']) });
    expect(describeModel('gpt-4', 'openai', false, rows).autoEligible).toBe(false);
    expect(describeModel('gpt-5-pro', 'openai', false, rows).autoEligible).toBe(false);
    expect(describeModel('mystery-model', 'openai', false, rows).autoEligible).toBe(false);
    const latestRows = [{ id: 'chat-latest', provider: 'openai', mode: 'chat', input: 5, output: 15, cacheRead: null, variable: false, supportsTools: true }];
    expect(describeModel('chat-latest', 'openai', false, latestRows).autoEligible).toBe(false);
  });

  it('dated snapshots of one model take a single rank', async () => {
    const { dedupeDatedVariants } = await import('./catalog');
    const out = dedupeDatedVariants([model('gpt-5.5', false, 11), model('gpt-5.5-2026-04-23', false, 11), model('gpt-5-2025-08-07', false, 3), model('gpt-5-2025-10-01', false, 3)]);
    expect(out.filter((m) => m.autoEligible).map((m) => m.model)).toEqual(['gpt-5.5', 'gpt-5-2025-10-01']);
  });
});

describe('one rank per model across credentials', () => {
  it('prefers the direct credential over an aggregator for the same model, and drops router pseudo-models', async () => {
    const { dedupeAcrossCredentials, describeModel } = await import('./catalog');
    const direct = model('gpt-6-astra', false, 20, 'openai-key');
    const viaRouter = { ...model('openai/gpt-6-astra', false, 18, 'openrouter-key'), provider: 'openrouter' };
    const claude = { ...model('anthropic/claude-opus-5.5', false, 8, 'openrouter-key'), provider: 'openrouter' };
    const out = dedupeAcrossCredentials([viaRouter, direct, claude]);
    expect(out.filter((m) => m.autoEligible).map((m) => m.model)).toEqual(['gpt-6-astra', 'anthropic/claude-opus-5.5']);
    const rows = [{ id: 'openrouter/auto', provider: 'openrouter', mode: 'chat', input: 1, output: 1, cacheRead: null, variable: false, supportsTools: true }];
    expect(describeModel('openrouter/auto', 'openrouter', false, rows).autoEligible).toBe(false);
  });
});

describe('benchmark ranking', () => {
  it('matches provider ids to leaderboard entries regardless of word order, prefixes, dates and run settings', async () => {
    const { modelKey, matchBenchmark, parseBenchmarkResponse } = await import('./benchmarks');
    expect(modelKey('anthropic/claude-sonnet-4.5')).toBe(modelKey('claude-4-5-sonnet-thinking'));
    expect(modelKey('models/gemini-3.1-pro-preview')).toBe(modelKey('gemini-3-1-pro'));
    expect(modelKey('gpt-5-2025-08-07')).toBe(modelKey('gpt-5-high'));
    expect(modelKey('gpt-5-mini')).not.toBe(modelKey('gpt-5'));

    const rows = parseBenchmarkResponse({
      data: [
        { slug: 'gpt-5', name: 'GPT-5 (high)', model_creator: { name: 'OpenAI' }, evaluations: { artificial_analysis_intelligence_index: 68, artificial_analysis_coding_index: 55 } },
        { slug: 'gpt-5-minimal', name: 'GPT-5 (minimal)', model_creator: { name: 'OpenAI' }, evaluations: { artificial_analysis_intelligence_index: 44 } },
        { slug: 'claude-4-5-sonnet-thinking', name: 'Claude 4.5 Sonnet', model_creator: { name: 'Anthropic' }, evaluations: { artificial_analysis_intelligence_index: 63, artificial_analysis_coding_index: 60 } },
        { name: 'no slug' },
      ],
    });
    expect(rows).toHaveLength(3);
    expect(matchBenchmark('gpt-5-2025-08-07', rows)).toMatchObject({ intelligence: 68, coding: 55, source: 'gpt-5' });
    expect(matchBenchmark('anthropic/claude-sonnet-4.5', rows)).toMatchObject({ intelligence: 63, coding: 60 });
    expect(matchBenchmark('gpt-5-mini', rows)).toBeNull();
  });
});

describe('short list', () => {
  it('keeps free models and each credential’s strongest scored models, dropping the long tail', async () => {
    const { shortlistModels } = await import('./catalog');
    const scored = (id: string, intelligence: number, coding: number) => ({ ...model(id, false, 1, 'router'), benchmark: { intelligence, coding, math: null, source: id } });
    const many = Array.from({ length: 12 }, (_, i) => scored(`m-${i}`, 50 - i, i === 11 ? 99 : 40 - i));
    const out = shortlistModels([...ROGLY, ...many, model('unscored-x', false, 1, 'router')]).map((m) => m.model);
    expect(out).toEqual(expect.arrayContaining(ROGLY.map((m) => m.model)));
    expect(out).toEqual(expect.arrayContaining(['m-0', 'm-5', 'm-11']));
    expect(out).not.toContain('m-8');
    expect(out).not.toContain('unscored-x');
    expect(out).toHaveLength(3 + 6 + 1);
  });
});

const measured = (m: AvailableModel, scores: { json: number; routing: number; tools: number; grounded: number }, tools = true): AvailableModel => ({
  ...m,
  checks: { status: 'done', checkedAt: '2026-09-28T00:00:00.000Z', supports: { jsonSchema: true, jsonObject: true, tools }, scores, overall: (scores.json + scores.routing + scores.tools + scores.grounded) / 4, avgLatencyMs: 900, notes: [], error: null, toolMode: 'native' },
});

describe('free models ranked by Nucleas checks', () => {
  const [gemma, coder, vl] = ROGLY;
  it('weights the checks by the kind of work', () => {
    const m = measured(gemma, { json: 1, routing: 0.5, tools: 0, grounded: 1 });
    expect(checkScore(m, 'code')).toBeCloseTo(0.5);
    expect(checkScore(m, 'utility')).toBeCloseTo(0.8);
    expect(checkScore(m, 'write')).toBeCloseTo(1);
    expect(checkScore(gemma, 'write')).toBeNull();
  });

  it('prefers a measured model that passed over the name-based favourite, and drops ones that failed', () => {
    const models = [measured(gemma, { json: 0.2, routing: 0.2, tools: 0, grounded: 0.3 }), coder, measured(vl, { json: 1, routing: 1, tools: 1, grounded: 1 })];
    expect(pick('utility', 'low', models).primary).toBe(vl.model);
    // Unmeasured beats measured-and-failed.
    const twoLeft = [measured(gemma, { json: 0.2, routing: 0.2, tools: 0, grounded: 0.3 }), coder];
    expect(pick('write', 'low', twoLeft).primary).toBe(coder.model);
  });

  it('skips models whose host refused tool calls for tool-driven work', () => {
    const models = [gemma, measured(coder, { json: 1, routing: 1, tools: 0, grounded: 1 }, false), vl];
    expect([gemma.model, vl.model]).toContain(pick('code', 'low', models).primary);
  });
});
