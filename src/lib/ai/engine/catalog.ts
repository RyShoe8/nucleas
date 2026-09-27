import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { AiModelProfile } from '@/lib/models/AiRolePipeline';
import { decryptModelSecret } from '@/lib/ai/modelSecrets';
import { discoverOpenAiCompatibleModels } from '@/lib/ai/rolePipeline/discoverModels';
import { buildModelMetaView, isFreeCredential } from '@/lib/ai/rolePipeline/modelMeta';
import { lookupModelTokenRate } from '@/lib/ai/pricing/modelRates';
import type { ModelStrength } from '@/lib/ai/rolePipeline/providerCatalog';

/**
 * Every model the organization can actually call: each enabled credential's live model list,
 * enriched with curated strengths/flagship flags and token prices. Discovery results are cached
 * so selecting a model never waits on provider catalogs.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const snapshotSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, required: true, unique: true },
    modelIds: { type: [String], default: [] },
    error: { type: String },
    fetchedAt: { type: Date, required: true },
  },
  { timestamps: false }
);
type SnapshotDoc = InferSchemaType<typeof snapshotSchema>;
export const AiModelCatalogSnapshot: Model<SnapshotDoc> =
  (mongoose.models.AiModelCatalogSnapshot as Model<SnapshotDoc> | undefined) ?? mongoose.model<SnapshotDoc>('AiModelCatalogSnapshot', snapshotSchema);

export interface AvailableModel {
  profileId: string;
  profileLabel: string;
  model: string;
  label: string;
  free: boolean;
  strengths: ModelStrength[];
  flagship: boolean;
  contextTokens: number | null;
  /** Blended $ per 1M tokens (3 parts input : 1 part output). Null when unknown. Free models are 0. */
  blendedPricePer1M: number | null;
}

type ProfileRow = { _id: Types.ObjectId; label: string; provider?: string; tier: string; endpoint: string; secretCiphertext: string; model?: string };

async function modelIdsFor(profile: ProfileRow, force: boolean): Promise<string[]> {
  const cached = await AiModelCatalogSnapshot.findOne({ profileId: profile._id }).lean<{ modelIds: string[]; fetchedAt: Date }>();
  if (!force && cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) return cached.modelIds;
  let ids: string[] = [];
  let error: string | undefined;
  try {
    const discovered = await discoverOpenAiCompatibleModels({ endpoint: profile.endpoint, bearerToken: decryptModelSecret(profile.secretCiphertext) });
    ids = discovered.models.map((m) => m.id);
    error = discovered.error ?? undefined;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 200) : 'discovery failed';
  }
  // Keep the last good list if discovery fails; fall back to the credential's default model.
  if (ids.length === 0) ids = cached?.modelIds?.length ? cached.modelIds : profile.model ? [profile.model] : [];
  await AiModelCatalogSnapshot.updateOne({ profileId: profile._id }, { $set: { modelIds: ids, error, fetchedAt: new Date() } }, { upsert: true });
  return ids;
}

function blendedPrice(model: string, free: boolean): number | null {
  if (free) return 0;
  const rate = lookupModelTokenRate(model);
  if (!rate) return null;
  // Rates are micro-USD per 1M tokens; convert to dollars.
  return Math.round(((rate.inputMicrosPer1M * 3 + rate.outputMicrosPer1M) / 4 / 1_000_000) * 1000) / 1000;
}

export async function listAvailableModels(options: { force?: boolean } = {}): Promise<AvailableModel[]> {
  const profiles = await AiModelProfile.find({ enabled: true })
    .select('label provider tier endpoint secretCiphertext model')
    .lean<ProfileRow[]>();
  const out: AvailableModel[] = [];
  for (const profile of profiles) {
    const free = isFreeCredential({ provider: profile.provider, tier: profile.tier });
    for (const id of await modelIdsFor(profile, Boolean(options.force))) {
      const meta = buildModelMetaView({ id, free });
      // Image and embedding models never serve text jobs.
      if (meta.strengths.includes('image_gen') || meta.strengths.includes('embeddings')) continue;
      out.push({
        profileId: String(profile._id),
        profileLabel: profile.label,
        model: id,
        label: meta.label,
        free,
        strengths: meta.strengths,
        flagship: Boolean(meta.flagship),
        contextTokens: meta.contextTokens,
        blendedPricePer1M: blendedPrice(id, free),
      });
    }
  }
  return out;
}
