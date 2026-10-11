import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { AiModelProfile } from '@/lib/models/AiModelProfile';
import type { ProviderModelInfo } from '@/lib/ai/rolePipeline/discoverModels';
import { decryptModelSecret } from '@/lib/ai/modelSecrets';
import { discoverOpenAiCompatibleModels } from '@/lib/ai/rolePipeline/discoverModels';
import { buildModelMetaView, isFreeCredential } from '@/lib/ai/rolePipeline/modelMeta';
import { findCatalogModel, type ModelStrength } from '@/lib/ai/rolePipeline/providerCatalog';
import { lookupModelTokenRate } from '@/lib/ai/pricing/modelRates';
import { fetchPricingCatalog, type PricingRow } from '@/lib/ai/pricing/liveCatalog';
import { benchmarkRows, matchBenchmark, type ModelBenchmark } from './benchmarks';
import { activeHealthIssues, isBenched, type HealthIssue } from './health';
import { checksFor, modelCheckRows, type ModelCheckSummary } from './checkResults';

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
    /** Context window per model as the provider reports it (e.g. vLLM max_model_len). */
    contextWindows: { type: [{ model: String, tokens: Number, _id: false }], default: [] },
    /** Price and features per model as the provider's own list reports them (refreshed with the list). */
    providerInfo: { type: [{ model: String, inputPer1M: Number, outputPer1M: Number, tools: Boolean, reasoning: Boolean, vision: Boolean, _id: false }], default: [] },
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
  /** Credential provider (openai, openrouter, custom…). */
  provider: string;
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
  /** Artificial Analysis scores when the model is on their leaderboard. */
  benchmark: ModelBenchmark | null;
  /** Why automatic selection skips this model; absent when it is eligible (or free). */
  excludedReason?: string;
  /** Set while the provider is rejecting this credential or model; not auto-selected meanwhile. */
  benched?: HealthIssue | null;
  /** What Nucleas measured by running the model (free models; see modelChecks.ts). */
  checks?: ModelCheckSummary | null;
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

/** Provider routing variants (OpenRouter's ":batch", ":free", ":online"…) behave differently from the base model; never auto-selected. */
function isRoutingVariant(id: string): boolean {
  return id.includes(':') || /^openrouter\//i.test(id);
}

/** Moving aliases ("chat-latest", "gemini-pro-latest") change underneath us; never auto-selected. */
function isMovingAlias(id: string): boolean {
  return /(^|-)latest$/i.test(id);
}

// ---------- Pricing registry ----------

let registryMemo: { rows: PricingRow[]; at: number } | null = null;

/** `force` (the window's Refresh) skips the 24-hour cache and re-reads the published price list. */
async function registryRows(force = false): Promise<PricingRow[]> {
  if (!force && registryMemo && Date.now() - registryMemo.at < REGISTRY_TTL_MS) return registryMemo.rows;
  // No database connection (e.g. isolated tests): nothing cached to read and nowhere to cache.
  if (mongoose.connection.readyState !== 1) return [];
  const cached = await AiPricingRegistryCache.findOne({ key: 'litellm' }).lean<{ rows: PricingRow[]; fetchedAt: Date }>();
  if (!force && cached && Date.now() - cached.fetchedAt.getTime() < REGISTRY_TTL_MS) {
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

type SnapshotInfo = ProviderModelInfo & { model: string };

async function modelIdsFor(profile: ProfileRow, force: boolean): Promise<{ ids: string[]; contexts: Record<string, number>; infos: Record<string, ProviderModelInfo> }> {
  const cached = await AiModelCatalogSnapshot.findOne({ profileId: profile._id }).lean<{ modelIds: string[]; contextWindows?: { model: string; tokens: number }[]; providerInfo?: SnapshotInfo[]; fetchedAt: Date }>();
  const cachedInfos: Record<string, ProviderModelInfo> = Object.fromEntries((cached?.providerInfo ?? []).map(({ model, ...info }) => [model, info]));
  const cachedContexts: Record<string, number> = Object.fromEntries((cached?.contextWindows ?? []).map((c) => [c.model, c.tokens]));
  if (!force && cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) return { ids: cached.modelIds, contexts: cachedContexts, infos: cachedInfos };
  let ids: string[] = [];
  let contexts: Record<string, number> = {};
  let infos: Record<string, ProviderModelInfo> = {};
  let error: string | undefined;
  try {
    const discovered = await discoverOpenAiCompatibleModels({ endpoint: profile.endpoint, bearerToken: decryptModelSecret(profile.secretCiphertext) });
    ids = discovered.models.map((m) => m.id);
    contexts = Object.fromEntries(discovered.models.filter((m) => m.contextTokens).map((m) => [m.id, m.contextTokens as number]));
    infos = Object.fromEntries(discovered.models.flatMap((m) => (m.info ? [[m.id, m.info] as const] : [])));
    error = discovered.error ?? undefined;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 200) : 'discovery failed';
  }
  // Keep the last good list if discovery fails; fall back to the credential's default model.
  if (ids.length === 0) {
    ids = cached?.modelIds?.length ? cached.modelIds : profile.model ? [profile.model] : [];
    contexts = cachedContexts;
    infos = cachedInfos;
  }
  // A deployment rejection is stronger evidence than a model's advertised maximum.
  // Keep a learned smaller window when discovery omits it or advertises a larger one.
  for (const id of ids) {
    if (cachedContexts[id]) contexts[id] = Math.min(contexts[id] ?? cachedContexts[id], cachedContexts[id]);
  }
  // Model ids contain dots, so windows are stored as a list rather than a map keyed by id.
  const contextWindows = Object.entries(contexts).map(([model, tokens]) => ({ model, tokens }));
  const providerInfo = Object.entries(infos).map(([model, info]) => ({ model, ...info }));
  await AiModelCatalogSnapshot.updateOne(
    { profileId: profile._id },
    error ? { $set: { modelIds: ids, contextWindows, providerInfo, error, fetchedAt: new Date() } } : { $set: { modelIds: ids, contextWindows, providerInfo, fetchedAt: new Date() }, $unset: { error: '' } },
    { upsert: true }
  );
  return { ids, contexts, infos };
}

export function describeModel(id: string, provider: string | undefined, free: boolean, rows: PricingRow[], info?: ProviderModelInfo | null): Omit<AvailableModel, 'profileId' | 'profileLabel' | 'provider' | 'model' | 'benchmark'> {
  const normalized = normalizeModelId(id);
  const curated = findCatalogModel(normalized) ?? findCatalogModel(id);
  const meta = buildModelMetaView({ id: normalized, free });
  const ref = free ? null : findRegistryRow(id, provider, rows);

  let strengths: ModelStrength[] = curated?.strengths ?? meta.strengths;
  if (!curated && (ref || info)) {
    const derived = new Set<ModelStrength>(['chat']);
    if (ref?.supportsReasoning || info?.reasoning) derived.add('reasoning');
    if (ref?.supportsVision || info?.vision) derived.add('vision');
    if (/codex|coder/i.test(normalized)) derived.add('coding');
    strengths = [...derived];
  }

  let price: number | null = free ? 0 : null;
  // What this credential's own list says it charges wins: it is what the account is billed, and it covers new models first.
  if (!free && info && info.inputPer1M !== null && info.outputPer1M !== null) price = Math.round(((info.inputPer1M * 3 + info.outputPer1M) / 4) * 1000) / 1000;
  if (!free && price === null && ref && ref.input !== null && ref.output !== null) price = Math.round(((ref.input * 3 + ref.output) / 4) * 1000) / 1000;
  if (!free && price === null) {
    const rate = lookupModelTokenRate(normalized) ?? lookupModelTokenRate(id);
    if (rate) price = Math.round(((rate.inputMicrosPer1M * 3 + rate.outputMicrosPer1M) / 4 / 1_000_000) * 1000) / 1000;
  }

  const textCapable = isTextChatModel(normalized) && !strengths.includes('image_gen') && !strengths.includes('embeddings');
  const currentCapable = Boolean(curated) || Boolean(ref && (ref.supportsReasoning || ref.supportsVision || ref.supportsTools)) || Boolean(info && (info.tools || info.reasoning || info.vision));
  const autoEligible = textCapable && (free || (price !== null && price <= AUTO_PRICE_CAP && !isLegacy(normalized) && !isMovingAlias(normalized) && !isRoutingVariant(normalized) && currentCapable));
  const excludedReason = autoEligible
    ? undefined
    : !textCapable
      ? 'Not a text chat model'
      : isLegacy(normalized)
        ? 'Older model family'
        : isMovingAlias(normalized)
          ? 'Moving alias (-latest), not a fixed version'
          : isRoutingVariant(normalized)
            ? 'Provider routing variant (batch, free and similar)'
            : price === null
              ? 'No price on file for it (neither the provider list nor the price registry has one)'
              : price > AUTO_PRICE_CAP
                ? `Priced above $${AUTO_PRICE_CAP} per 1M tokens`
                : 'No capability data (not in the curated list, and neither the provider nor the price registry shows reasoning, vision or tool support)';

  return {
    label: curated?.label ?? meta.label,
    free,
    strengths,
    flagship: Boolean(curated?.flagship),
    contextTokens: curated?.contextTokens ?? ref?.maxInputTokens ?? meta.contextTokens,
    blendedPricePer1M: price,
    autoEligible,
    ...(excludedReason ? { excludedReason } : {}),
  };
}

/**
 * Cost in micro-USD of a call's tokens, priced from the same registry the engine ranks with (falling
 * back to the local rate table). Null when the price is unknown. Free credentials cost nothing.
 */
export async function priceTokens(input: { model: string; provider?: string; profileId?: string; free: boolean; inputTokens: number; outputTokens: number }): Promise<number | null> {
  if (input.free) return 0;
  if (input.profileId && Types.ObjectId.isValid(input.profileId) && mongoose.connection.readyState === 1) {
    const snapshot = await AiModelCatalogSnapshot.findOne({ profileId: new Types.ObjectId(input.profileId), 'providerInfo.model': input.model }, { 'providerInfo.$': 1 }).lean<{ providerInfo?: SnapshotInfo[] }>().catch(() => null);
    const info = snapshot?.providerInfo?.[0];
    if (info && info.inputPer1M != null && info.outputPer1M != null && !(info.inputPer1M === 0 && info.outputPer1M === 0)) {
      return Math.round(input.inputTokens * info.inputPer1M + input.outputTokens * info.outputPer1M);
    }
  }
  const row = findRegistryRow(input.model, input.provider, await registryRows());
  if (row && row.input !== null && row.output !== null) return Math.round(input.inputTokens * row.input + input.outputTokens * row.output);
  const rate = lookupModelTokenRate(normalizeModelId(input.model)) ?? lookupModelTokenRate(input.model);
  if (!rate) return null;
  return Math.round((input.inputTokens * rate.inputMicrosPer1M + input.outputTokens * rate.outputMicrosPer1M) / 1_000_000);
}

/** True when the provider's latest model list for this credential includes the model. */
export async function isModelListedForProfile(profileId: string, model: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(profileId)) return false;
  const hit = await AiModelCatalogSnapshot.exists({ profileId: new Types.ObjectId(profileId), modelIds: model });
  return Boolean(hit);
}

export async function listAvailableModels(options: { force?: boolean } = {}): Promise<AvailableModel[]> {
  const profiles = await AiModelProfile.find({ enabled: true })
    .select('label provider tier endpoint secretCiphertext model')
    .lean<ProfileRow[]>();
  const anyPaid = profiles.some((p) => !isFreeCredential({ provider: p.provider, tier: p.tier }));
  const rows = anyPaid ? await registryRows(Boolean(options.force)) : [];
  const scores = anyPaid ? await benchmarkRows(Boolean(options.force)) : [];
  const checkRows = await modelCheckRows().catch(() => []);
  const out: AvailableModel[] = [];
  for (const profile of profiles) {
    const free = isFreeCredential({ provider: profile.provider, tier: profile.tier });
    const { ids, contexts, infos } = await modelIdsFor(profile, Boolean(options.force));
    for (const id of ids) {
      const described = describeModel(id, profile.provider, free, rows, infos[id]);
      if (!isTextChatModel(normalizeModelId(id))) continue;
      // What the provider says it serves beats any listed or guessed window.
      const contextTokens = contexts[id] ?? described.contextTokens;
      out.push({ profileId: String(profile._id), profileLabel: profile.label, provider: profile.provider ?? 'custom', model: id, ...described, contextTokens, benchmark: free ? null : matchBenchmark(id, scores), checks: free ? checksFor(checkRows, String(profile._id), id) : null });
    }
  }
  // Benched credentials and models sit out automatic selection until they recover.
  const issues = await activeHealthIssues().catch(() => [] as HealthIssue[]);
  const withHealth = issues.length
    ? out.map((m) => {
        const benched = isBenched(issues, m.profileId, m.model);
        return benched ? { ...m, benched, autoEligible: false, excludedReason: 'Skipped for now after recent failures from the provider' } : m;
      })
    : out;
  return dedupeAcrossCredentials(dedupeDatedVariants(withHealth));
}

/** Aggregators resell other providers' models; a direct credential for the same model wins. */
const AGGREGATORS = new Set(['openrouter']);

/**
 * The same model reachable through two credentials (gpt-6-astra direct and openai/gpt-6-astra via
 * OpenRouter) takes one rank: the direct credential when there is one, otherwise the cheapest.
 */
export function dedupeAcrossCredentials(models: AvailableModel[]): AvailableModel[] {
  const identity = (m: AvailableModel) => normalizeModelId(m.model).replace(/^.*\//, '').toLowerCase();
  const best = new Map<string, AvailableModel>();
  for (const m of models) {
    if (!m.autoEligible || m.free) continue;
    const current = best.get(identity(m));
    const better =
      !current ||
      (AGGREGATORS.has(current.provider) && !AGGREGATORS.has(m.provider)) ||
      (AGGREGATORS.has(current.provider) === AGGREGATORS.has(m.provider) && (m.blendedPricePer1M ?? Infinity) < (current.blendedPricePer1M ?? Infinity));
    if (better) best.set(identity(m), m);
  }
  return models.map((m) =>
    m.autoEligible && !m.free && best.get(identity(m)) !== m
      ? { ...m, autoEligible: false, excludedReason: 'The same model is also listed by a preferred credential (a direct one beats an aggregator)' }
      : m
  );
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
  return models.map((m) => (keep.has(m) ? m : { ...m, autoEligible: false, excludedReason: 'A dated copy of a model already listed without the date' }));
}

/**
 * The short list people choose from (Direct mode, pins): every free model, plus each paid
 * credential's strongest current models — its top 6 by the intelligence score and top 3 by the
 * coding score. Credentials with no scored models show their 6 priciest current models instead.
 */
export function shortlistModels(models: AvailableModel[]): AvailableModel[] {
  const picked = new Set<AvailableModel>(models.filter((m) => m.free && m.autoEligible));
  const byCredential = new Map<string, AvailableModel[]>();
  for (const m of models) {
    if (m.free || !m.autoEligible) continue;
    byCredential.set(m.profileId, [...(byCredential.get(m.profileId) ?? []), m]);
  }
  const top = (pool: AvailableModel[], score: (m: AvailableModel) => number | null, n: number) =>
    pool
      .filter((m) => score(m) !== null)
      .sort((a, b) => score(b)! - score(a)!)
      .slice(0, n);
  for (const pool of byCredential.values()) {
    const scored = pool.filter((m) => m.benchmark);
    if (scored.length === 0) {
      top(pool, (m) => m.blendedPricePer1M, 6).forEach((m) => picked.add(m));
      continue;
    }
    top(scored, (m) => m.benchmark!.intelligence, 6).forEach((m) => picked.add(m));
    top(scored, (m) => m.benchmark!.coding, 3).forEach((m) => picked.add(m));
  }
  return models.filter((m) => picked.has(m));
}

/** Unknown windows: paid models are nearly all 128k+ now, so 64k is safe; free local servers are often configured smaller. */
const DEFAULT_CONTEXT_TOKENS = { paid: 64_000, free: 16_000 };

/** A model's context window in tokens: curated list, then the price registry, then a safe default. */
export async function contextWindowFor(model: string, provider: string | undefined, free: boolean, profileId?: string): Promise<number> {
  if (profileId && Types.ObjectId.isValid(profileId) && mongoose.connection.readyState === 1) {
    const snap = await AiModelCatalogSnapshot.findOne({ profileId: new Types.ObjectId(profileId) }).select('contextWindows').lean<{ contextWindows?: { model: string; tokens: number }[] }>();
    const served = snap?.contextWindows?.find((c) => c.model === model)?.tokens;
    if (typeof served === 'number' && served > 0) return served;
  }
  const normalized = normalizeModelId(model);
  const curated = findCatalogModel(normalized) ?? findCatalogModel(model);
  if (curated?.contextTokens) return curated.contextTokens;
  if (!free) {
    const row = findRegistryRow(model, provider, await registryRows().catch(() => []));
    if (row?.maxInputTokens) return row.maxInputTokens;
  }
  const meta = buildModelMetaView({ id: normalized, free });
  return meta.contextTokens ?? (free ? DEFAULT_CONTEXT_TOKENS.free : DEFAULT_CONTEXT_TOKENS.paid);
}

/**
 * Cap a requested answer relative to the model's configured window. Reasoning, tool calls and the
 * prompt must share this same window; a nominal 8k answer is unsafe on a 16k local deployment.
 */
export function outputBudgetTokens(contextTokens: number, requestedTokens: number): number {
  return Math.max(256, Math.min(requestedTokens, Math.floor(contextTokens * 0.25)));
}

/** Extracts the authoritative deployment limit LiteLLM/vLLM includes in context errors. */
export function contextWindowFromProviderMessage(message: string | undefined): number | null {
  if (!message) return null;
  const match = message.match(/(?:maximum|max(?:imum)?)[ _-]?context(?: (?:length|window))?\s*(?:is|[:=])\s*([\d,]+)\s*tokens?/i)
    ?? message.match(/context(?: (?:length|window))?[^\d]{0,40}([\d,]+)\s*tokens?/i);
  if (!match) return null;
  const tokens = Number(match[1].replace(/,/g, ''));
  return Number.isInteger(tokens) && tokens >= 1_024 && tokens <= 4_000_000 ? tokens : null;
}

/** Learns a provider-reported limit so later requests are correctly budgeted without manual setup. */
export async function recordObservedContextWindow(profileId: string, model: string, tokens: number): Promise<void> {
  if (!Types.ObjectId.isValid(profileId) || mongoose.connection.readyState !== 1 || tokens < 1_024) return;
  const id = new Types.ObjectId(profileId);
  const current = await AiModelCatalogSnapshot.findOne({ profileId: id }).lean<{ modelIds?: string[]; contextWindows?: { model: string; tokens: number }[] }>();
  const contextWindows = [...(current?.contextWindows ?? []).filter((entry) => entry.model !== model), { model, tokens }];
  await AiModelCatalogSnapshot.updateOne(
    { profileId: id },
    { $set: { modelIds: current?.modelIds?.length ? current.modelIds : [model], contextWindows, fetchedAt: new Date() }, $unset: { error: '' } },
    { upsert: true }
  );
}

/**
 * Characters of message content a model can take, leaving room for its answer plus tool schemas,
 * chat framing and tokenizer variance. 2.5 characters/token is deliberately conservative for code.
 */
export function contextBudgetChars(contextTokens: number, maxOutputTokens: number): number {
  const overheadTokens = Math.max(1_024, Math.ceil(contextTokens * 0.1));
  const inputTokens = Math.max(512, contextTokens - maxOutputTokens - overheadTokens);
  return Math.max(1_280, Math.min(Math.floor(inputTokens * 2.5), 1_200_000));
}
