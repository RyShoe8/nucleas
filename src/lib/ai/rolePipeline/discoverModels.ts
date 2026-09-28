/**
 * OpenAI-compatible model list discovery for custom / self-hosted credentials.
 * Fail closed: never throw provider bodies or secrets.
 */

import { localModelMetaOverlay, markFlagshipAmongModels } from '@/lib/ai/rolePipeline/modelMeta';
import { shortModelDisplayName, type ModelStrength } from '@/lib/ai/rolePipeline/providerCatalog';

export type DiscoveredModel = {
  id: string;
  label: string;
  bestAt: string;
  strengths: ModelStrength[];
  contextTokens: number | null;
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
