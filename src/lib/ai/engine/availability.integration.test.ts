import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));

import { AiModelProfile } from '@/lib/models/AiRolePipeline';
import { encryptModelSecret } from '@/lib/ai/modelSecrets';
import { gatewayFromModelProfile } from '@/lib/ai/rolePipeline/profiles';
import { AiModelCatalogSnapshot, describeModel, isModelListedForProfile } from './catalog';

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
