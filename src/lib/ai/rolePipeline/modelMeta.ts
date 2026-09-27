import { microsToDollars } from '@/lib/ai/settingsSchema';
import { lookupModelTokenRate } from '@/lib/ai/pricing/modelRates';
import {
  findCatalogModel,
  shortModelDisplayName,
  type CatalogModel,
  type ModelStrength,
} from '@/lib/ai/rolePipeline/providerCatalog';

export type ModelPricingDisplay = {
  free: boolean;
  label: string;
  inputPer1M: string | null;
  outputPer1M: string | null;
};

export type ModelMetaView = {
  id: string;
  label: string;
  bestAt: string;
  strengths: ModelStrength[];
  contextTokens: number | null;
  flagship?: boolean;
  pricing: ModelPricingDisplay;
};

/** Whether this credential should show Free token pricing. */
export function isFreeCredential(input: { provider?: string | null; tier?: string | null }): boolean {
  const provider = input.provider ?? 'custom';
  if (provider === 'custom') return true;
  return input.tier === 'local_remote';
}

export function getModelPricingDisplay(
  modelId: string,
  opts: { free: boolean }
): ModelPricingDisplay {
  if (opts.free) {
    return { free: true, label: 'Free', inputPer1M: null, outputPer1M: null };
  }
  const rate = lookupModelTokenRate(modelId);
  if (!rate) {
    return { free: false, label: 'Pricing unknown', inputPer1M: null, outputPer1M: null };
  }
  const inputPer1M = microsToDollars(rate.inputMicrosPer1M);
  const outputPer1M = microsToDollars(rate.outputMicrosPer1M);
  return {
    free: false,
    label: `$${inputPer1M} / $${outputPer1M} per 1M`,
    inputPer1M,
    outputPer1M,
  };
}

/** Heuristic meta for self-hosted / discovered model ids. */
export function localModelMetaOverlay(modelId: string): Pick<CatalogModel, 'bestAt' | 'strengths'> {
  const id = modelId.toLowerCase();
  if (id.includes('bge') || id.includes('embed')) {
    return { bestAt: 'Embeddings and retrieval', strengths: ['embeddings'] };
  }
  if (id.includes('flux') || id.includes('sdxl') || id.includes('stable-diffusion') || id.includes('dall-e') || id.includes('image')) {
    return { bestAt: 'Local image generation', strengths: ['image_gen'] };
  }
  if (id.includes('coder') || id.includes('code')) {
    return { bestAt: 'Local coding and code edits', strengths: ['coding', 'chat'] };
  }
  if (id.includes('-vl') || id.includes('vision') || id.includes('llava')) {
    return { bestAt: 'Vision and multimodal understanding', strengths: ['vision', 'chat'] };
  }
  if (id.includes('reason') || id.includes('thinking') || id.includes('r1')) {
    return { bestAt: 'Local reasoning', strengths: ['reasoning', 'chat'] };
  }
  if (id.includes('gemma') || id.includes('llama') || id.includes('qwen') || id.includes('mistral')) {
    return { bestAt: 'General local chat', strengths: ['chat'] };
  }
  return { bestAt: 'General local model', strengths: ['chat'] };
}

export function buildModelMetaView(input: {
  id: string;
  label?: string;
  contextTokens?: number | null;
  bestAt?: string;
  strengths?: ModelStrength[];
  flagship?: boolean;
  free: boolean;
}): ModelMetaView {
  const catalog = findCatalogModel(input.id);
  const local = !catalog ? localModelMetaOverlay(input.id) : null;
  const flagship = input.flagship ?? catalog?.flagship ?? false;
  return {
    id: input.id,
    label: shortModelDisplayName(input.label ?? catalog?.label ?? input.id),
    bestAt: input.bestAt ?? catalog?.bestAt ?? local?.bestAt ?? 'General assistant',
    strengths: input.strengths ?? catalog?.strengths ?? local?.strengths ?? ['chat'],
    contextTokens: input.contextTokens ?? catalog?.contextTokens ?? null,
    ...(flagship ? { flagship: true } : {}),
    pricing: getModelPricingDisplay(input.id, { free: input.free }),
  };
}

export function enrichCatalogModelsForApi(
  models: CatalogModel[],
  opts: { free: boolean }
): ModelMetaView[] {
  return models.map((model) =>
    buildModelMetaView({
      id: model.id,
      label: model.label,
      bestAt: model.bestAt,
      strengths: model.strengths,
      contextTokens: model.contextTokens,
      flagship: model.flagship,
      free: opts.free,
    })
  );
}

/** Score local/discovered model ids so the strongest host model can be flagged. */
export function localModelPowerScore(modelId: string): number {
  const id = modelId.toLowerCase();
  let score = 0;
  // Prefer newer Qwen generations over larger Qwen 2.5 weights (Rogly frontier is Qwen 3, not 2.5 Coder).
  if (/qwen3(?:[.\-_/]|$)/.test(id)) score += 20_000;
  // Gemma generations: Gemma 4 is current-generation general-purpose, on par with Qwen 3.
  else if (/gemma[-_]?4(?:[.\-_/]|$)/.test(id)) score += 20_000;
  else if (/gemma[-_]?3(?:[.\-_/]|$)/.test(id)) score += 8_000;
  else if (/qwen2\.5/.test(id)) score += 8_000;
  else if (/qwen2(?:[.\-_/]|$)/.test(id)) score += 4_000;
  const params = id.match(/(\d+(?:\.\d+)?)[_\s-]*b(?:illion)?\b/);
  if (params) score += Number(params[1]) * 1000;
  if (/(?:^|[^a-z])(?:r1|reason|thinking|opus|ultra|max)(?:[^a-z]|$)/.test(id)) score += 800;
  if (/\bpro\b/.test(id)) score += 200;
  if (/coder|code/.test(id)) score += 80;
  if (/mini|lite|tiny|nano|embed|bge|instruct-turbo/.test(id)) score -= 2500;
  return score;
}

/** Mark exactly one highest-scoring model as flagship in a discovered list. */
export function markFlagshipAmongModels<T extends { id: string; flagship?: boolean }>(models: T[]): T[] {
  if (models.length === 0) return models;
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < models.length; i += 1) {
    const score = localModelPowerScore(models[i]!.id);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return models.map((model, index) =>
    index === bestIndex ? { ...model, flagship: true } : { ...model, flagship: false }
  );
}
