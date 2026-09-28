import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));

import { AiModelProfile } from '@/lib/models/AiModelProfile';
import { encryptModelSecret } from '@/lib/ai/modelSecrets';
import { gatewayFromModelProfile } from '@/lib/ai/rolePipeline/profiles';
import { AiModelCatalogSnapshot, describeModel, isModelListedForProfile, listAvailableModels } from './catalog';
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

describe('benched credentials', () => {
  it('401 benches the credential, 403 only the model, 429 nothing; a success clears it', async () => {
    const profile = await AiModelProfile.create({ key: 'bench', label: 'Bench', provider: 'custom', tier: 'local_remote', protocol: 'openai-chat', endpoint: 'https://bench.test/v1/chat/completions', secretCiphertext: encryptModelSecret('k'), secretLast4: 'kkkk', enabled: true });
    await AiModelCatalogSnapshot.create({ profileId: profile._id, modelIds: ['google/gemma-4-12B-it-qat-w4a16-ct', 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ'], fetchedAt: new Date() });
    const id = String(profile._id);
    const eligible = async () => (await listAvailableModels()).filter((m) => m.profileId === id && m.autoEligible).map((m) => m.model).sort();

    expect(await eligible()).toHaveLength(2);
    await recordModelFailure({ profileId: id, model: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', httpStatus: 429 });
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
});
