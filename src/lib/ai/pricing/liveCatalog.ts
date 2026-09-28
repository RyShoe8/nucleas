/** Reference pricing only; never changes the settlement ledger. */
export const PRICING_SOURCE = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const PRICING_SOURCE_PAGE = 'https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json';
export type PricingRow = {
  id: string; provider: string; mode: string;
  input: number | null; output: number | null; cacheRead: number | null;
  variable: boolean;
  /** Capability flags from the registry (used for automatic model selection). */
  supportsReasoning?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
  /** Context window in tokens (max_input_tokens), when listed. */
  maxInputTokens?: number | null;
};
export type PricingSnapshot = { fetchedAt: string; rows: PricingRow[] };
const perMillion = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isFinite(value * 1e6)
    ? value * 1e6 : null;

export function parsePricingCatalog(body: unknown): PricingRow[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid pricing catalog');
  const rows: PricingRow[] = [];
  for (const [id, value] of Object.entries(body)) {
    if (id === 'sample_spec' || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (typeof item.litellm_provider !== 'string' || typeof item.mode !== 'string') continue;
    if (!['chat', 'completion', 'embedding'].includes(item.mode)) continue;
    rows.push({
      id, provider: item.litellm_provider, mode: item.mode,
      input: perMillion(item.input_cost_per_token),
      output: perMillion(item.output_cost_per_token),
      cacheRead: perMillion(item.cache_read_input_token_cost),
      variable: Object.keys(item).some(key => /cost.*(above|below|audio|image|video|pixel|second|reasoning|batch|tier|priority)/.test(key)),
      supportsReasoning: item.supports_reasoning === true,
      supportsVision: item.supports_vision === true,
      supportsTools: item.supports_function_calling === true,
      maxInputTokens: typeof item.max_input_tokens === 'number' && item.max_input_tokens > 0 ? item.max_input_tokens : null,
    });
  }
  if (!rows.length) throw new Error('No token pricing entries returned');
  return rows.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
}

export async function fetchPricingCatalog(fetcher: typeof fetch = fetch): Promise<PricingSnapshot> {
  const response = await fetcher(PRICING_SOURCE, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Pricing source unavailable');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty pricing response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12_000_000) {
        await reader.cancel();
        throw new Error('Pricing response too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const rows = parsePricingCatalog(JSON.parse(new TextDecoder().decode(bytes)));
  return { fetchedAt: new Date().toISOString(), rows };
}

