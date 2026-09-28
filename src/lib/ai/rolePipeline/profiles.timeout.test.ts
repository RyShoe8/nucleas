import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/models/AiModelProfile', () => ({
  AiModelProfile: {
    findById: (...args: unknown[]) => mocks.findById(...args),
  },
}));
vi.mock('@/lib/ai/modelSecrets', () => ({ decryptModelSecret: (...args: unknown[]) => mocks.decrypt(...args) }));
vi.mock('@/lib/ai/rolePipeline/providerCatalog', () => ({
  cleanedCompanyLabel: (label: string) => label,
  companyDisplayName: ({ label }: { label: string }) => label,
  isModelAllowedForProvider: () => true,
}));

import { gatewayFromModelProfile } from '@/lib/ai/rolePipeline/profiles';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decrypt.mockReturnValue('secret-token');
});

describe('gatewayFromModelProfile timeouts', () => {
  it('uses 120s for free/local credentials', async () => {
    const id = new Types.ObjectId();
    mocks.findById.mockReturnValue({
      select: () => ({
        maxTimeMS: () => ({
          lean: async () => ({
            _id: id,
            label: 'Rog ly',
            provider: 'custom',
            tier: 'local_remote',
            protocol: 'openai-chat',
            endpoint: 'https://rogly.example/v1/chat/completions',
            model: 'local',
            secretCiphertext: 'cipher',
            enabled: true,
          }),
        }),
      }),
    });

    const { gateway } = await gatewayFromModelProfile(String(id), 'local');
    expect(gateway.timeoutMs).toBe(120000);
  });

  it('uses 120s for commercial credentials too (long plan drafts exceed 60s)', async () => {
    const id = new Types.ObjectId();
    mocks.findById.mockReturnValue({
      select: () => ({
        maxTimeMS: () => ({
          lean: async () => ({
            _id: id,
            label: 'OpenAI',
            provider: 'openai',
            tier: 'commercial',
            protocol: 'openai-chat',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            model: 'gpt-4o-mini',
            secretCiphertext: 'cipher',
            enabled: true,
          }),
        }),
      }),
    });

    const { gateway } = await gatewayFromModelProfile(String(id), 'gpt-4o-mini');
    expect(gateway.timeoutMs).toBe(120000);
  });
});
