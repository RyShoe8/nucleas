import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { AiModelProfile } from '@/lib/models/AiRolePipeline';
import { decryptModelSecret } from '@/lib/ai/modelSecrets';
import { discoverOpenAiCompatibleModels } from '@/lib/ai/rolePipeline/discoverModels';
import { buildModelMetaView, isFreeCredential } from '@/lib/ai/rolePipeline/modelMeta';
import { findCatalogModel, type ModelStrength } from '@/lib/ai/rolePipeline/providerCatalog';
import { lookupModelTokenRate } from '@/lib/ai/pricing/modelRates';
import { fetchPricingCatalog, type PricingRow } from '@/lib/ai/pricing/liveCatalog';

/**
 * Every model the organization can actually call: each enabled credential's live model list,
 * with prices and capabilities from the LiteLLM pricing registry (falling back to the local rate
 * table) and curated strengths. Provider model lists and the registry are cached.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REGISTRY_TTL_MS = 24 * 60 * 60 * 1000;
/** Blended $/1M above which a paid model is never auto-selected (ultra-premium "pro" tiers, legacy GPT-4). */
const AUTO_PRICE_CAP = 30;

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

const registrySchema = new Schema({ key: { type: String, required: true, unique: true }, rows: { type: Schema.Types.Mixed, default: [] }, fetchedAt: { type: Date, required: true } });
type RegistryDoc = InferSchemaType<typeof registrySchema>;
export const AiPricingRegistryCache: Model<RegistryDoc> =
  (mongoose.models.AiPricingRegistryCache as Model<RegistryDoc> | undefined) ?? mongoose.model<RegistryDoc>('AiPricingRegistryCache', registrySchema);

export interface AvailableModel {
  profileId: string;
  profileLabel: string;
  /** Exact id to send to the provider. */
  model: string;
  label: string;
  free: boolean;
  strengths: ModelStrength[];
  flagship: boolean;
  contextTokens: number | null;
  /** Blended $ per 1M tokens (3 parts input : 1 part output). Null when unknown. Free models are 0. */
  blendedPricePer1M: number | null;
  /** Considered by automatic selection (current, text-capable, priced, within the price cap). */
  autoEligible: boolean;
}

type ProfileRow = { _id: Types.ObjectId; label: string; provider?: string; tier: string; endpoint: string; secretCiphertext: string; model?: string };

// ---------- Normalisation and filters ----------

/** Strips provider quirks: Google's "models/" prefix and trailing date stamps like -2025-08-07. */
export function normalizeModelId(id: string): string {
  return id.replace(/^models\//i, '').replace(/-(20\d{2})-?(\d{2})-?(\d{2})$/, '').trim();
}

/** Models that cannot hold a text conversation (speech, images, video, embeddings, realtime, etc.). */
export function isTextChatModel(id: string): boolean {
  return !/(tts|transcribe|whisper|audio|image|imagen|dall-e|veo|lyria|embed|search-api|search-preview|realtime|[-_]live|robotics|computer-use|moderation|babbage|davinci|aqa|nano-banana|omni|translate|deep-research)/i.test(id);
}

/** Older families that are priced high but outclassed; never auto-selected. */
function isLegacy(id: string): boolean {
  return /^(gpt-3\.5|gpt-4(-|$)|gpt-4-turbo|o1(-|$)|chatgpt-4o|text-)/i.test(id);
}

/** Moving aliases ("chat-latest", "gemini-pro-latest") change underneath us; never auto-selected. */
function isMovingAlias(id: string): boolean {
  return /(^|-)latest$/i.test(id);
}

// ---------- Pricing registry ----------

let registryMemo: { rows: PricingRow[]; at: number } | null = null;

async function registryRows(): Promise<PricingRow[]> {
  if (registryMemo && Date.now() - registryMemo.at < REGISTRY_TTL_MS) return registryMemo.rows;
  const cached = await AiPricingRegistryCache.findOne({ key: 'litellm' }).lean<{ rows: PricingRow[]; fetchedAt: Date }>();
  if (cached && Date.now() - cached.fetchedAt.getTime() < REGISTRY_TTL_MS) {
    registryMemo = { rows: cached.rows, at: cached.fetchedAt.getTime() };
    return cached.rows;
  }
  try {
    const snapshot = await fetchPricingCatalog();
    const rows = snapshot.rows.filter((r) => r.mode === 'chat');
    await AiPricingRegistryCache.updateOne({ key: 'litellm' }, { $set: { rows, fetchedAt: new Date() } }, { upsert: true });
    registryMemo = { rows, at: Date.now() };
    return rows;
  } catch {
    return cached?.rows ?? [];
  }
}

/** LiteLLM provider names per credential provider, used to disambiguate registry rows. */
const REGISTRY_PROVIDER: Record<string, string[]> = {
  openai: ['openai'],
  anthropic: ['anthropic'],
  google: ['gemini', 'vertex_ai-language-models'],
  groq: ['groq'],
  deepseek: ['deepseek'],
  openrouter: ['openrouter'],
  together: ['together_ai'],
  fireworks: ['fireworks_ai'],
};

export function findRegistryRow(id: string, provider: string | undefined, rows: PricingRow[]): PricingRow | null {
  const key = normalizeModelId(id).toLowerCase();
  const matches = rows.filter((r) => {
    const rid = r.id.toLowerCase();
    return rid === key || rid.endsWith(`/${key}`) || key.endsWith(`/${rid}`);
  });
  if (matches.length === 0) return null;
  const preferred = REGISTRY_PROVIDER[provider ?? ''] ?? [];
  return matches.find((m) => preferred.includes(m.provider)) ?? matches.find((m) => m.input !== null && m.output !== null) ?? matches[0];
}

// ---------- Catalog ----------

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

export function describeModel(id: string, provider: string | undefined, free: boolean, rows: PricingRow[]): Omit<AvailableModel, 'profileId' | 'profileLabel' | 'model'> {
  const normalized = normalizeModelId(id);
  const curated = findCatalogModel(normalized) ?? findCatalogModel(id);
  const meta = buildModelMetaView({ id: normalized, free });
  const ref = free ? null : findRegistryRow(id, provider, rows);

  let strengths: ModelStrength[] = curated?.strengths ?? meta.strengths;
  if (!curated && ref) {
    const derived = new Set<ModelStrength>(['chat']);
    if (ref.supportsReasoning) derived.add('reasoning');
    if (ref.supportsVision) derived.add('vision');
    if (/codex|coder/i.test(normalized)) derived.add('coding');
    strengths = [...derived];
  }

  let price: number | null = free ? 0 : null;
  if (!free && ref && ref.input !== null && ref.output !== null) price = Math.round(((ref.input * 3 + ref.output) / 4) * 1000) / 1000;
  if (!free && price === null) {
    const rate = lookupModelTokenRate(normalized) ?? lookupModelTokenRate(id);
    if (rate) price = Math.round(((rate.inputMicrosPer1M * 3 + rate.outputMicrosPer1M) / 4 / 1_000_000) * 1000) / 1000;
  }

  const textCapable = isTextChatModel(normalized) && !strengths.includes('image_gen') && !strengths.includes('embeddings');
  const currentCapable = Boolean(curated) || Boolean(ref && (ref.supportsReasoning || ref.supportsVision || ref.supportsTools));
  const autoEligible = textCapable && (free || (price !== null && price <= AUTO_PRICE_CAP && !isLegacy(normalized) && !isMovingAlias(normalized) && currentCapable));

  return {
    label: curated?.label ?? meta.label,
    free,
    strengths,
    flagship: Boolean(curated?.flagship),
    contextTokens: curated?.contextTokens ?? meta.contextTokens,
    blendedPricePer1M: price,
    autoEligible,
  };
}

export async function listAvailableModels(options: { force?: boolean } = {}): Promise<AvailableModel[]> {
  const profiles = await AiModelProfile.find({ enabled: true })
    .select('label provider tier endpoint secretCiphertext model')
    .lean<ProfileRow[]>();
  const rows = profiles.some((p) => !isFreeCredential({ provider: p.provider, tier: p.tier })) ? await registryRows() : [];
  const out: AvailableModel[] = [];
  for (const profile of profiles) {
    const free = isFreeCredential({ provider: profile.provider, tier: profile.tier });
    for (const id of await modelIdsFor(profile, Boolean(options.force))) {
      const described = describeModel(id, profile.provider, free, rows);
      if (!isTextChatModel(normalizeModelId(id))) continue;
      out.push({ profileId: String(profile._id), profileLabel: profile.label, model: id, ...described });
    }
  }
  return dedupeDatedVariants(out);
}

/**
 * Providers list one model under an alias and dated snapshots (gpt-5.5 and gpt-5.5-2026-04-23).
 * Only one counts for automatic selection so it can't take several ranks: the undated alias when
 * listed, otherwise the newest snapshot. The rest stay available for Direct mode and pins.
 */
export function dedupeDatedVariants(models: AvailableModel[]): AvailableModel[] {
  const groups = new Map<string, AvailableModel[]>();
  for (const m of models) {
    const key = `${m.profileId}|${normalizeModelId(m.model).toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const keep = new Set<AvailableModel>();
  for (const group of groups.values()) {
    const undated = group.find((m) => normalizeModelId(m.model) === m.model.replace(/^models\//i, ''));
    keep.add(undated ?? [...group].sort((a, b) => b.model.localeCompare(a.model))[0]);
  }
  return models.map((m) => (keep.has(m) ? m : { ...m, autoEligible: false }));
}
