/**
 * OpenAI-compatible model list discovery for custom / self-hosted credentials.
 * Fail closed: never throw provider bodies or secrets.
 */

import { localModelMetaOverlay, markFlagshipAmongModels } from '@/lib/ai/rolePipeline/modelMeta';
import { shortModelDisplayName, type ModelStrength } from '@/lib/ai/rolePipeline/providerCatalog';

/** What a provider says about a model in its own list (OpenRouter sends price and supported features for every model). */
export type ProviderModelInfo = {
  /** USD per 1M input / output tokens; null when the provider gives none (or "-1" for routers). */
  inputPer1M: number | null;
  outputPer1M: number | null;
  tools: boolean | null;
  reasoning: boolean | null;
  vision: boolean | null;
};

export type DiscoveredModel = {
  id: string;
  label: string;
  bestAt: string;
  strengths: ModelStrength[];
  contextTokens: number | null;
  info?: ProviderModelInfo | null;
  flagship?: boolean;
};

export type DiscoverModelsResult = {
  models: DiscoveredModel[];
  error: string | null;
};

/** Derive a models list URL from a chat-completions (or API root) endpoint. */
export function modelsUrlFromChatEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') throw new Error('Models discovery requires HTTPS.');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Models discovery rejects credentials, query, or hash in the endpoint.');
  }
  let path = url.pathname.replace(/\/+$/, '') || '';
  if (path.endsWith('/chat/completions')) {
    path = `${path.slice(0, -'/chat/completions'.length)}/models`;
  } else if (path.endsWith('/completions')) {
    path = `${path.slice(0, -'/completions'.length)}/models`;
  } else if (path.endsWith('/models')) {
    // already a models URL
  } else if (path.endsWith('/v1')) {
    path = `${path}/models`;
  } else if (!path || path === '/') {
    path = '/v1/models';
  } else {
    path = `${path}/models`;
  }
  url.pathname = path;
  return url;
}

function readContextTokens(item: object): number | null {
  const candidates = [
    (item as { max_model_len?: unknown }).max_model_len,
    (item as { context_length?: unknown }).context_length,
    (item as { max_context_length?: unknown }).max_context_length,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }
  return null;
}

function perMillion(value: unknown): number | null {
  const n = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e6) / 1e6 : null;
}

export function readProviderInfo(item: object): ProviderModelInfo | null {
  const pricing = (item as { pricing?: { prompt?: unknown; completion?: unknown } }).pricing;
  let inputPer1M = perMillion(pricing?.prompt);
  let outputPer1M = perMillion(pricing?.completion);
  // A zero price on both sides says "free variant or unmetered", not a real rate to bill against.
  if (inputPer1M === 0 && outputPer1M === 0) {
    inputPer1M = null;
    outputPer1M = null;
  }
  const params = (item as { supported_parameters?: unknown }).supported_parameters;
  const list = Array.isArray(params) ? params.filter((p): p is string => typeof p === 'string') : null;
  const modalities = (item as { architecture?: { input_modalities?: unknown } }).architecture?.input_modalities;
  const info: ProviderModelInfo = {
    inputPer1M,
    outputPer1M,
    tools: list ? list.includes('tools') : null,
    reasoning: list ? list.includes('reasoning') || list.includes('include_reasoning') : null,
    vision: Array.isArray(modalities) ? modalities.includes('image') : null,
  };
  return Object.values(info).every((v) => v === null) ? null : info;
}

export function mapOpenAiModelsResponse(body: unknown): DiscoveredModel[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id.trim() : '';
    if (!id || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    const overlay = localModelMetaOverlay(id);
    models.push({
      id,
      label: shortModelDisplayName(id),
      bestAt: overlay.bestAt,
      strengths: overlay.strengths,
      contextTokens: readContextTokens(item),
      info: readProviderInfo(item),
    });
  }
  return markFlagshipAmongModels(models.sort((a, b) => a.id.localeCompare(b.id)));
}

export async function discoverOpenAiCompatibleModels(input: {
  endpoint: string;
  bearerToken: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<DiscoverModelsResult> {
  const token = input.bearerToken.trim();
  if (!token || /[\r\n]/.test(token)) {
    return { models: [], error: 'Credential is missing or invalid.' };
  }
  let modelsUrl: URL;
  try {
    modelsUrl = modelsUrlFromChatEndpoint(input.endpoint);
  } catch {
    return { models: [], error: 'Unable to derive a models URL from this credential endpoint.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(controller.abort.bind(controller), input.timeoutMs ?? 10000);
  try {
    const response = await (input.fetcher ?? fetch)(modelsUrl, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        return { models: [], error: 'Remote authentication was rejected while listing models.' };
      }
      return { models: [], error: 'Unable to list models from the remote host.' };
    }
    const reader = response.body?.getReader();
    if (!reader) return { models: [], error: 'Unable to list models from the remote host.' };
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        // Aggregators such as OpenRouter list hundreds of models with long descriptions.
        if (size > 8_000_000) {
          await reader.cancel();
          return { models: [], error: 'Models response was too large.' };
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return { models: [], error: 'Models response was not valid JSON.' };
    }
    const models = mapOpenAiModelsResponse(parsed);
    if (models.length === 0) {
      return { models: [], error: 'No models were returned by the remote host.' };
    }
    return { models, error: null };
  } catch {
    return { models: [], error: 'Unable to reach the remote host to list models.' };
  } finally {
    clearTimeout(timeout);
  }
}
