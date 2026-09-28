import 'server-only';
import connectDB from '@/lib/db/mongodb';
import { decryptModelSecret } from '@/lib/ai/modelSecrets';
import { fetchPricingCatalog } from '@/lib/ai/pricing/liveCatalog';
import {
  priceAvailableModel,
  type AvailablePricingProvider,
  type AvailablePricingSnapshot,
} from '@/lib/ai/pricing/availablePricing';
import { discoverOpenAiCompatibleModels } from '@/lib/ai/rolePipeline/discoverModels';
import { isFreeCredential } from '@/lib/ai/rolePipeline/modelMeta';
import { companyDisplayName } from '@/lib/ai/rolePipeline/providerCatalog';
import { AiModelProfile } from '@/lib/models/AiModelProfile';

export async function loadAvailableModelPricing(): Promise<AvailablePricingSnapshot> {
  await connectDB();
  const [rows, reference] = await Promise.all([
    AiModelProfile.find({ enabled: true })
      .select('label provider tier endpoint secretCiphertext')
      .sort({ label: 1 })
      .limit(25)
      .maxTimeMS(3000)
      .lean(),
    fetchPricingCatalog().catch(() => null),
  ]);
  const referenceRows = reference?.rows ?? [];
  const providers = await Promise.all(rows.map(async (row): Promise<AvailablePricingProvider> => {
    const provider = row.provider ?? 'custom';
    const label = companyDisplayName({ label: row.label, provider });
    const free = isFreeCredential({ provider, tier: row.tier });
    let bearerToken: string;
    try {
      bearerToken = decryptModelSecret(row.secretCiphertext);
    } catch {
      return {
        id: String(row._id), label, provider, free, models: [],
        error: 'The stored credential could not be decrypted.',
      };
    }
    const discovered = await discoverOpenAiCompatibleModels({
      endpoint: row.endpoint,
      bearerToken,
    });
    return {
      id: String(row._id),
      label,
      provider,
      free,
      models: discovered.models.map((model) =>
        priceAvailableModel(model.id, { free, referenceRows })
      ),
      error: discovered.error,
    };
  }));
  return {
    fetchedAt: new Date().toISOString(),
    referencePricingAvailable: Boolean(reference),
    providers,
  };
}
