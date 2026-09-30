import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { decryptModelSecret, encryptModelSecret, secretLast4 } from '@/lib/ai/modelSecrets';

/**
 * Benchmark scores from Artificial Analysis (https://artificialanalysis.ai/, free API, attribution
 * required). The engine ranks paid models by these scores per task: the coding index for code, the
 * intelligence index for everything else. One key for the whole install, pasted by an admin in the
 * AI Engine window; rows are cached for a day and the last good set is kept when a refresh fails.
 */

const ENDPOINT = 'https://artificialanalysis.ai/api/v2/data/llms/models';
const TTL_MS = 24 * 60 * 60 * 1000;
export const BENCHMARK_SOURCE = { name: 'Artificial Analysis', url: 'https://artificialanalysis.ai/' };

export interface BenchmarkRow {
  slug: string;
  name: string;
  creator: string;
  intelligence: number | null;
  coding: number | null;
  math: number | null;
}

export interface ModelBenchmark {
  intelligence: number | null;
  coding: number | null;
  math: number | null;
  /** The Artificial Analysis entry the scores came from. */
  source: string;
  /**
   * Set when the model is a compressed (quantized) copy of the listed one: the scores are the listed
   * model's, discounted by a rule-of-thumb factor. An estimate, not something Nucleas measured.
   */
  estimated?: { quantization: string; factor: number };
}

const sourceSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    apiKeyCiphertext: { type: String },
    apiKeyLast4: { type: String },
    rows: { type: Schema.Types.Mixed, default: [] },
    fetchedAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true }
);
type SourceDoc = InferSchemaType<typeof sourceSchema>;
export const AiBenchmarkSource: Model<SourceDoc> =
  (mongoose.models.AiBenchmarkSource as Model<SourceDoc> | undefined) ?? mongoose.model<SourceDoc>('AiBenchmarkSource', sourceSchema);

const KEY = 'artificial_analysis';

type Stored = { apiKeyCiphertext?: string; apiKeyLast4?: string; rows?: BenchmarkRow[]; fetchedAt?: Date; error?: string };

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function parseBenchmarkResponse(body: unknown): BenchmarkRow[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw) => {
    const r = raw as { slug?: unknown; name?: unknown; model_creator?: { name?: unknown }; evaluations?: Record<string, unknown> };
    if (typeof r.slug !== 'string') return [];
    const e = r.evaluations ?? {};
    return [
      {
        slug: r.slug,
        name: typeof r.name === 'string' ? r.name : r.slug,
        creator: typeof r.model_creator?.name === 'string' ? r.model_creator.name : '',
        intelligence: num(e.artificial_analysis_intelligence_index),
        coding: num(e.artificial_analysis_coding_index),
        math: num(e.artificial_analysis_math_index),
      },
    ];
  });
}

async function fetchRows(apiKey: string): Promise<BenchmarkRow[]> {
  const res = await fetch(ENDPOINT, { headers: { 'x-api-key': apiKey }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403) throw new Error('Artificial Analysis rejected the API key.');
  if (!res.ok) throw new Error(`Artificial Analysis returned ${res.status}.`);
  const rows = parseBenchmarkResponse(await res.json());
  if (rows.length === 0) throw new Error('Artificial Analysis returned no models.');
  return rows;
}

/** Cached benchmark rows; refreshed daily (or when forced) while a key is configured. */
export async function benchmarkRows(force = false): Promise<BenchmarkRow[]> {
  const doc = await AiBenchmarkSource.findOne({ key: KEY }).lean<Stored>();
  if (!doc?.apiKeyCiphertext) return [];
  const fresh = doc.fetchedAt && Date.now() - new Date(doc.fetchedAt).getTime() < TTL_MS;
  if (!force && fresh) return doc.rows ?? [];
  try {
    const rows = await fetchRows(decryptModelSecret(doc.apiKeyCiphertext));
    await AiBenchmarkSource.updateOne({ key: KEY }, { $set: { rows, fetchedAt: new Date() }, $unset: { error: '' } });
    return rows;
  } catch (err) {
    // Keep the last good scores; retry on the next day's refresh.
    await AiBenchmarkSource.updateOne({ key: KEY }, { $set: { error: err instanceof Error ? err.message : 'refresh failed', fetchedAt: new Date() } });
    return doc.rows ?? [];
  }
}

/** Saves (after verifying) or removes the Artificial Analysis API key. */
export async function saveBenchmarkKey(apiKey: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!apiKey) {
    await AiBenchmarkSource.deleteOne({ key: KEY });
    return { ok: true };
  }
  const trimmed = apiKey.trim();
  let rows: BenchmarkRow[];
  try {
    rows = await fetchRows(trimmed);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reach Artificial Analysis.' };
  }
  await AiBenchmarkSource.updateOne(
    { key: KEY },
    { $set: { apiKeyCiphertext: encryptModelSecret(trimmed), apiKeyLast4: secretLast4(trimmed), rows, fetchedAt: new Date() }, $unset: { error: '' } },
    { upsert: true }
  );
  return { ok: true };
}

export async function benchmarkStatus(): Promise<{ configured: boolean; keyLast4: string | null; models: number; fetchedAt: string | null; error: string | null }> {
  const doc = await AiBenchmarkSource.findOne({ key: KEY }).lean<Stored>();
  return {
    configured: Boolean(doc?.apiKeyCiphertext),
    keyLast4: doc?.apiKeyLast4 ?? null,
    models: doc?.rows?.length ?? 0,
    fetchedAt: doc?.fetchedAt ? new Date(doc.fetchedAt).toISOString() : null,
    error: doc?.error ?? null,
  };
}

// ---------- Matching provider model ids to benchmark entries ----------

// ---------- Compression (quantization) ----------

/**
 * Typical share of the uncompressed model's benchmark score a compressed copy keeps. Rules of thumb
 * from published quantization studies (8-bit is nearly lossless; 4-bit loses a few percent, more on
 * small models), not measurements of these exact files.
 */
const QUANT_TOKENS: Record<string, { label: string; factor: number }> = {
  fp8: { label: 'FP8', factor: 0.995 }, int8: { label: 'INT8', factor: 0.995 }, w8a8: { label: 'W8A8', factor: 0.995 }, w8a16: { label: 'W8A16', factor: 0.995 }, '8bit': { label: '8-bit', factor: 0.995 },
  awq: { label: 'AWQ 4-bit', factor: 0.97 }, gptq: { label: 'GPTQ 4-bit', factor: 0.97 }, int4: { label: 'INT4', factor: 0.97 }, w4a16: { label: 'W4A16 4-bit', factor: 0.97 },
  w4a8: { label: 'W4A8', factor: 0.96 }, '4bit': { label: '4-bit', factor: 0.97 }, fp4: { label: 'FP4', factor: 0.96 }, nvfp4: { label: 'NVFP4', factor: 0.96 }, bnb: { label: 'bitsandbytes', factor: 0.97 },
  qat: { label: 'QAT 4-bit', factor: 0.985 }, gguf: { label: 'GGUF', factor: 1 },
};
/** GGUF quality levels: q4_k_m, q5_0, q8_0, iq3... */
const GGUF_LEVEL = /[-_.](i?q([2-8]))(?:_[a-z0-9]+)*$/;
const GGUF_FACTORS: Record<string, number> = { '2': 0.85, '3': 0.93, '4': 0.97, '5': 0.985, '6': 0.99, '7': 0.995, '8': 0.995 };
/** Compressed-tensors marker: only counts as compression when another compression tag is present. */
const COMPANION_TOKENS = new Set(['ct']);

export interface Quantization { tokens: string[]; label: string | null; factor: number; /** The name with the GGUF file extension and quality level removed. */ base: string }

function baseName(id: string): string {
  return id
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/^.*\//, '')
    .replace(/[-_](20\d{2})-?(\d{2})-?(\d{2})$/, '')
    .replace(/:.*$/, '');
}

/** The compression tags in a model id, the label to show, and the score factor (1 when uncompressed). */
export function parseQuantization(id: string): Quantization {
  let base = baseName(id);
  const tokens: string[] = [];
  const labels: string[] = [];
  let factor = 1;
  const isGguf = base.includes('gguf');
  base = base.replace(/[-_.]?gguf$/, '');
  const gguf = GGUF_LEVEL.exec(base);
  if (gguf && (isGguf || /q[2-8]_/.test(base))) {
    base = base.slice(0, gguf.index);
    tokens.push(gguf[1]);
    labels.push(gguf[1].toUpperCase());
    factor = Math.min(factor, GGUF_FACTORS[gguf[2]] ?? 1);
  }
  if (isGguf) tokens.push('gguf');
  const parts = base.split(/[-._\s]+/).filter(Boolean);
  const factors: { token: string; factor: number }[] = [];
  for (const part of parts) {
    const hit = QUANT_TOKENS[part];
    if (!hit) continue;
    tokens.push(part);
    labels.push(hit.label);
    factors.push({ token: part, factor: hit.factor });
  }
  // Quantization-aware training is done for 4-bit, so it keeps more than post-training 4-bit tags
  // that describe the same weights (e.g. "qat-w4a16"); they don't stack. Otherwise the lowest factor wins.
  const qat = factors.some((f) => f.token === 'qat');
  factor = Math.min(factor, ...factors.filter((f) => !(qat && f.token !== 'qat' && f.factor < 0.985)).map((f) => f.factor));
  if (tokens.length && parts.some((p) => COMPANION_TOKENS.has(p))) tokens.push(...parts.filter((p) => COMPANION_TOKENS.has(p)));
  return { tokens, label: labels.length ? [...new Set(labels)].join(' + ') : null, factor, base };
}

/** Words that name a run setting or release stage rather than a different model. */
const VARIANT_WORDS = new Set(['reasoning', 'non', 'thinking', 'high', 'medium', 'low', 'minimal', 'xhigh', 'max', 'adaptive', 'preview', 'exp', 'experimental', 'latest', 'instruct', 'it']);

/**
 * Order-insensitive identity of a model name: "anthropic/claude-sonnet-4.5" and Artificial
 * Analysis's "claude-4-5-sonnet-thinking" both become "4 5 claude sonnet".
 */
export function modelKey(id: string): string {
  const quant = parseQuantization(id);
  // Compression tags never appear in a leaderboard entry, so they are dropped from the identity.
  return quant.base
    .split(/[-._\s]+/)
    .filter((t) => t && !VARIANT_WORDS.has(t) && !quant.tokens.includes(t))
    .sort()
    .join(' ');
}

/** Best benchmark entry for a provider model id (the strongest variant when several match), or null. */
export function matchBenchmark(id: string, rows: BenchmarkRow[]): ModelBenchmark | null {
  const key = modelKey(id);
  if (!key) return null;
  const hits = rows.filter((r) => modelKey(r.slug) === key && (r.intelligence !== null || r.coding !== null));
  if (hits.length === 0) return null;
  const best = (pick: (r: BenchmarkRow) => number | null) =>
    hits.reduce<number | null>((acc, r) => (pick(r) !== null && (acc === null || pick(r)! > acc) ? pick(r) : acc), null);
  const top = [...hits].sort((a, b) => (b.intelligence ?? -1) - (a.intelligence ?? -1))[0];
  const quant = parseQuantization(id);
  // A compressed copy scores a little below the listed model: discount it and say so.
  const adjust = (v: number | null): number | null => (v === null || quant.factor === 1 ? v : Math.round(v * quant.factor * 10) / 10);
  return {
    intelligence: adjust(best((r) => r.intelligence)),
    coding: adjust(best((r) => r.coding)),
    math: adjust(best((r) => r.math)),
    source: top.slug,
    ...(quant.factor < 1 && quant.label ? { estimated: { quantization: quant.label, factor: quant.factor } } : {}),
  };
}
