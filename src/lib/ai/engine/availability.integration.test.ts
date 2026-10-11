import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));

import { AiModelProfile } from '@/lib/models/AiModelProfile';
import { encryptModelSecret } from '@/lib/ai/modelSecrets';
import { gatewayFromModelProfile } from '@/lib/ai/rolePipeline/profiles';
import { AiModelCatalogSnapshot, describeModel, isModelListedForProfile, listAvailableModels, priceTokens } from './catalog';
import { recordModelFailure, recordModelSuccess } from './health';

let replica: MongoMemoryReplSet;

beforeAll(async () => {
  process.env.AI_MODEL_SECRETS_KEY ??= 'test-secret';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_engine_availability_test'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await replica.stop();
});

describe('only models a provider lists right now are callable', () => {
  it('accepts a discovered model outside the curated catalog and rejects one the provider does not list', async () => {
    const profile = await AiModelProfile.create({
      key: 'openrouter',
      label: 'OpenRouter',
      provider: 'openrouter',
      tier: 'commercial',
      protocol: 'openai-chat',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      secretCiphertext: encryptModelSecret('sk-test'),
      secretLast4: 'test',
      enabled: true,
    });
    await AiModelCatalogSnapshot.create({ profileId: profile._id, modelIds: ['anthropic/claude-fable-5.1'], fetchedAt: new Date() });

    expect(await isModelListedForProfile(String(profile._id), 'anthropic/claude-fable-5.1')).toBe(true);
    const { gateway } = await gatewayFromModelProfile(String(profile._id), 'anthropic/claude-fable-5.1');
    expect(gateway.model).toBe('anthropic/claude-fable-5.1');
    await expect(gatewayFromModelProfile(String(profile._id), 'anthropic/claude-not-listed-9')).rejects.toThrow();
  });

  it('never auto-selects provider routing variants such as :batch', () => {
    const rows = [{ id: 'anthropic/claude-opus-5.5', provider: 'openrouter', mode: 'chat', input: 5, output: 25, cacheRead: null, variable: false, supportsReasoning: true }];
    expect(describeModel('anthropic/claude-opus-5.5', 'openrouter', false, rows).autoEligible).toBe(true);
    expect(describeModel('anthropic/claude-opus-5.5:batch', 'openrouter', false, rows).autoEligible).toBe(false);
  });
});

describe('prices and features from the provider list', () => {
  const info = { inputPer1M: 3, outputPer1M: 15, tools: true, reasoning: true, vision: true };

  it('prices and enables a brand-new model the registries have never heard of', () => {
    const without = describeModel('anthropic/claude-sonnet-5.5', 'openrouter', false, []);
    expect(without).toMatchObject({ autoEligible: false, blendedPricePer1M: null });
    const withInfo = describeModel('anthropic/claude-sonnet-5.5', 'openrouter', false, [], info);
    expect(withInfo).toMatchObject({ autoEligible: true, blendedPricePer1M: 6 });
  });

  it('prefers the credential’s own price over a registry row', () => {
    const rows = [{ id: 'anthropic/claude-sonnet-4.6', provider: 'openrouter', mode: 'chat', input: 9, output: 9, cacheRead: null, variable: false }];
    expect(describeModel('anthropic/claude-sonnet-4.6', 'openrouter', false, rows, info).blendedPricePer1M).toBe(6);
  });

  it('says what a routing variant is before saying it has no price', () => {
    expect(describeModel('anthropic/claude-sonnet-5.5:batch', 'openrouter', false, []).excludedReason).toMatch(/routing variant/i);
  });

  it('costs a call from the stored provider price', async () => {
    const profile = await AiModelProfile.create({ key: 'or-price', label: 'OpenRouter prices', provider: 'openrouter', tier: 'commercial', protocol: 'openai-chat', endpoint: 'https://openrouter.ai/api/v1/chat/completions', secretCiphertext: encryptModelSecret('sk-test'), secretLast4: 'test', enabled: true });
    await AiModelCatalogSnapshot.create({ profileId: profile._id, modelIds: ['anthropic/claude-sonnet-5.5'], providerInfo: [{ model: 'anthropic/claude-sonnet-5.5', ...info }], fetchedAt: new Date() });
    // $3 per 1M input and $15 per 1M output: 1,000 in + 200 out = 3,000 + 3,000 micro-dollars.
    expect(await priceTokens({ model: 'anthropic/claude-sonnet-5.5', provider: 'openrouter', profileId: String(profile._id), free: false, inputTokens: 1000, outputTokens: 200 })).toBe(6000);
    expect(await priceTokens({ model: 'anthropic/claude-sonnet-5.5', provider: 'openrouter', free: true, inputTokens: 1000, outputTokens: 200 })).toBe(0);
  });
});

describe('benched credentials', () => {
  it('opens credential/model circuits for permanent refusals and rate limits; a success clears them', async () => {
    const profile = await AiModelProfile.create({ key: 'bench', label: 'Bench', provider: 'custom', tier: 'local_remote', protocol: 'openai-chat', endpoint: 'https://bench.test/v1/chat/completions', secretCiphertext: encryptModelSecret('k'), secretLast4: 'kkkk', enabled: true });
    await AiModelCatalogSnapshot.create({ profileId: profile._id, modelIds: ['google/gemma-4-12B-it-qat-w4a16-ct', 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ'], fetchedAt: new Date() });
    const id = String(profile._id);
    const eligible = async () => (await listAvailableModels()).filter((m) => m.profileId === id && m.autoEligible).map((m) => m.model).sort();

    expect(await eligible()).toHaveLength(2);
    await recordModelFailure({ profileId: id, model: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', httpStatus: 429 });
    expect(await eligible()).toHaveLength(0);
    await recordModelSuccess(id, 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ');
    expect(await eligible()).toHaveLength(2);
    await recordModelFailure({ profileId: id, model: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', httpStatus: 403, message: 'Model not allowed' });
    expect(await eligible()).toEqual(['google/gemma-4-12B-it-qat-w4a16-ct']);
    await recordModelFailure({ profileId: id, model: 'google/gemma-4-12B-it-qat-w4a16-ct', httpStatus: 401 });
    expect(await eligible()).toEqual([]);
    const benched = (await listAvailableModels()).find((m) => m.profileId === id);
    expect(benched?.benched).toMatchObject({ httpStatus: 401, model: null });

    await recordModelSuccess(id, 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ');
    expect(await eligible()).toHaveLength(2);
  });

  it('opens an endpoint circuit only after repeated transient failures', async () => {
    const profile = await AiModelProfile.create({ key: 'transient', label: 'Transient', provider: 'custom', tier: 'local_remote', protocol: 'openai-chat', endpoint: 'https://transient.test/v1/chat/completions', secretCiphertext: encryptModelSecret('k'), secretLast4: 'kkkk', enabled: true });
    await AiModelCatalogSnapshot.create({ profileId: profile._id, modelIds: ['coder'], fetchedAt: new Date() });
    const id = String(profile._id);
    const eligible = async () => (await listAvailableModels()).filter((m) => m.profileId === id && m.autoEligible);
    await recordModelFailure({ profileId: id, model: 'coder', code: 'unavailable', kind: 'transport' });
    await recordModelFailure({ profileId: id, model: 'coder', code: 'unavailable', kind: 'transport' });
    expect(await eligible()).toHaveLength(1);
    await recordModelFailure({ profileId: id, model: 'coder', code: 'unavailable', kind: 'transport' });
    expect(await eligible()).toHaveLength(0);
    await recordModelSuccess(id, 'coder');
    expect(await eligible()).toHaveLength(1);
  });

  it('isolates repeated 5xx failures to one LiteLLM model instead of benching its credential', async () => {
    const profile = await AiModelProfile.create({ key: 'model-5xx', label: 'Model 5xx', provider: 'custom', tier: 'local_remote', protocol: 'openai-chat', endpoint: 'https://model-5xx.test/v1/chat/completions', secretCiphertext: encryptModelSecret('k'), secretLast4: 'kkkk', enabled: true });
    const models = ['vision', 'coder'];
    await AiModelCatalogSnapshot.create({ profileId: profile._id, modelIds: models, fetchedAt: new Date() });
    const id = String(profile._id);
    await recordModelFailure({ profileId: id, model: 'vision', httpStatus: 504, message: 'context exceeded' });
    await recordModelFailure({ profileId: id, model: 'vision', httpStatus: 504, message: 'context exceeded' });
    const eligible = (await listAvailableModels()).filter((m) => m.profileId === id && m.autoEligible).map((m) => m.model);
    expect(eligible).toEqual(['coder']);
  });
});
