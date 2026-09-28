import { describe, expect, it } from 'vitest';
import {
  getModelPricingDisplay,
  localModelMetaOverlay,
  isFreeCredential,
} from '@/lib/ai/rolePipeline/modelMeta';
import { MODEL_PROVIDERS } from '@/lib/ai/rolePipeline/providerCatalog';
import { mapOpenAiModelsResponse } from '@/lib/ai/rolePipeline/discoverModels';
import { isIdeChatMode, isIdeDirectMode, isIdeOrchestratedMode, normalizeIdeChatMode } from '@/lib/ide/modes';

describe('catalog model metadata', () => {
  it('gives every catalog model bestAt and strengths', () => {
    for (const provider of MODEL_PROVIDERS) {
      for (const model of provider.models) {
        expect(model.bestAt.trim().length).toBeGreaterThan(0);
        expect(model.strengths.length).toBeGreaterThan(0);
      }
    }
  });

  it('marks exactly one flagship model per non-custom provider', () => {
    for (const provider of MODEL_PROVIDERS) {
      if (provider.id === 'custom') continue;
      expect(provider.models.filter((model) => model.flagship).map((model) => model.id)).toHaveLength(1);
    }
  });
});

describe('getModelPricingDisplay', () => {
  it('marks local/custom as free', () => {
    expect(isFreeCredential({ provider: 'custom', tier: 'local_remote' })).toBe(true);
    expect(isFreeCredential({ provider: 'openai', tier: 'local_remote' })).toBe(true);
    expect(getModelPricingDisplay('gpt-4o-mini', { free: true }).label).toBe('Free');
  });

  it('formats known paid rates', () => {
    const display = getModelPricingDisplay('gpt-4o-mini', { free: false });
    expect(display.free).toBe(false);
    expect(display.label).toContain('per 1M');
    expect(display.inputPer1M).toBeTruthy();
  });

  it('returns pricing unknown when unpaid and unlisted', () => {
    expect(getModelPricingDisplay('totally-unknown-model-xyz', { free: false }).label).toBe(
      'Pricing unknown'
    );
  });
});

describe('local overlays and discovery mapping', () => {
  it('tags coder and vision local ids', () => {
    expect(localModelMetaOverlay('Qwen/Qwen2.5-Coder-14B').strengths).toContain('coding');
    expect(localModelMetaOverlay('Qwen/Qwen3-VL-8B').strengths).toContain('vision');
    expect(localModelMetaOverlay('BAAI/bge-m3').strengths).toContain('embeddings');
  });

  it('maps max_model_len from OpenAI-style responses', () => {
    const models = mapOpenAiModelsResponse({
      data: [{ id: 'Qwen/local-coder', max_model_len: 8192 }],
    });
    expect(models[0]).toMatchObject({
      id: 'Qwen/local-coder',
      contextTokens: 8192,
    });
    expect(models[0]?.strengths).toContain('coding');
  });

  it('flags the strongest discovered local model', () => {
    const models = mapOpenAiModelsResponse({
      data: [{ id: 'Qwen/Qwen2.5-7B' }, { id: 'Qwen/Qwen2.5-72B' }, { id: 'BAAI/bge-m3' }],
    });
    const flagships = models.filter((model) => model.flagship);
    expect(flagships).toHaveLength(1);
    expect(flagships[0]?.id).toBe('Qwen/Qwen2.5-72B');
  });
});

describe('ide modes include Direct', () => {
  it('has exactly two modes, Orchestrated and Direct, and maps legacy tabs to Orchestrated', () => {
    expect(isIdeChatMode('direct')).toBe(true);
    expect(isIdeDirectMode('direct')).toBe(true);
    expect(isIdeOrchestratedMode('direct')).toBe(false);
    expect(isIdeOrchestratedMode('orchestrated')).toBe(true);
    expect(isIdeChatMode('engineering')).toBe(false);
    expect(normalizeIdeChatMode('engineering')).toBe('orchestrated');
  });
});
