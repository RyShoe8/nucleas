import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { listAvailableModels, type AvailableModel } from './catalog';
import type { ModelStrength } from '@/lib/ai/rolePipeline/providerCatalog';
import { localModelPowerScore } from '@/lib/ai/rolePipeline/modelMeta';

/**
 * The one model-selection system. Every AI job asks for a need at a cost level; the engine picks
 * the best available model automatically. Admins may pin a model per need (applies at every level).
 *
 * Each level has a price ceiling (blended $ per 1M tokens, editable by admins). The paid pick is the
 * model with the best benchmark score for the task that costs no more than the ceiling:
 *   low    — plans and reviews under the low ceiling; Rogly does the work; never pays to retry
 *   medium — plans and reviews under the medium ceiling; Rogly does the work, retrying on that model
 *   high   — plans and reviews with no ceiling; the best model under the medium ceiling does the work
 * Rogly always uses its strongest model for the job.
 */

/** free: Rogly models only, never a paid call or paid retry. The others allow paid models up to their price ceiling. */
export const COST_LEVELS = ['free', 'low', 'medium', 'high'] as const;
export type CostLevel = (typeof COST_LEVELS)[number];
/** Levels that allow paid models, and so have a price ceiling. */
export type PaidCostLevel = Exclude<CostLevel, 'free'>;
export const PAID_COST_LEVELS: readonly PaidCostLevel[] = ['low', 'medium', 'high'];

export const NEEDS = ['plan', 'review', 'write', 'research', 'code', 'vision', 'utility'] as const;
export type Need = (typeof NEEDS)[number];

export const NEED_LABELS: Record<Need, { label: string; description: string }> = {
  plan: { label: 'Plan', description: 'Reads the request and a compact summary; decides what to fetch and how to answer. Small call, no tools.' },
  review: { label: 'Review', description: 'Checks work before the user sees it.' },
  write: { label: 'Write', description: 'Turns fetched data and research into the answer or draft. Carries the large inputs.' },
  research: { label: 'Research', description: 'Multi-step web research with tools.' },
  code: { label: 'Code', description: 'Explores repositories, edits code and runs checks.' },
  vision: { label: 'Vision', description: 'Understands screenshots and images.' },
  utility: { label: 'Utilities', description: 'Summaries, estimates, voice/palette intent.' },
};

export interface ModelChoice {
  profileId: string;
  model: string;
  free: boolean;
  label: string;
}

export interface Selection {
  need: Need;
  level: CostLevel;
  primary: ModelChoice | null;
  /** Used when the primary (free) model fails; only ever set when the level allows paying for a retry. */
  fallback: ModelChoice | null;
  source: 'pinned' | 'auto' | 'none';
}

// ---------- Pure selection rules ----------

function choice(m: AvailableModel | undefined): ModelChoice | null {
  return m ? { profileId: m.profileId, model: m.model, free: m.free, label: m.profileLabel } : null;
}

function withStrength(models: AvailableModel[], ...strengths: ModelStrength[]): AvailableModel[] {
  for (const s of strengths) {
    const hit = models.filter((m) => m.strengths.includes(s));
    if (hit.length) return hit;
  }
  return [];
}

/** The benchmark score that matters for a need: the coding index for code, the intelligence index otherwise. */
export function benchmarkScore(m: AvailableModel, need: Need): number | null {
  if (!m.benchmark) return null;
  return need === 'code' ? (m.benchmark.coding ?? m.benchmark.intelligence) : m.benchmark.intelligence;
}

/**
 * Paid models strongest first for the task: benchmark score, then price (the only signal when no
 * benchmark key is configured), then flagship, then id.
 */
function rankByPower(models: AvailableModel[], need: Need): AvailableModel[] {
  return [...models].sort(
    (a, b) =>
      (benchmarkScore(b, need) ?? -1) - (benchmarkScore(a, need) ?? -1) ||
      (b.blendedPricePer1M ?? 0) - (a.blendedPricePer1M ?? 0) ||
      Number(b.flagship) - Number(a.flagship) ||
      a.model.localeCompare(b.model)
  );
}

/** Max blended $ per 1M tokens a level may spend on a paid model; null = no ceiling. */
export type PriceCeilings = Record<PaidCostLevel, number | null>;
export const DEFAULT_PRICE_CEILINGS: PriceCeilings = { low: 1.5, medium: 5, high: null };

/**
 * The strongest model the level can afford. When nothing fits under the ceiling, the cheapest
 * capable model (so a level never fails just because prices moved).
 */
function bestUnder(pool: AvailableModel[], need: Need, ceiling: number | null): AvailableModel | undefined {
  const affordable = pool.filter((m) => ceiling === null || (m.blendedPricePer1M ?? Infinity) <= ceiling);
  if (affordable.length) return rankByPower(affordable, need)[0];
  return [...pool].sort((a, b) => (a.blendedPricePer1M ?? Infinity) - (b.blendedPricePer1M ?? Infinity))[0];
}

/**
 * How well a free model did on Nucleas's own checks for the kind of work a need is (0–1), or null
 * when it has not been measured. Code weighs exact edits and tool use; research weighs tool use and
 * grounded answers; planning mixes all of them; utilities are mostly routing and forced JSON;
 * writing is grounded answers. Results from before the code check existed skip it.
 */
export function checkScore(m: AvailableModel, need: Need): number | null {
  const s = m.checks?.scores;
  if (!s || m.checks?.overall === null || m.checks?.overall === undefined) return null;
  const v = (n: number | null) => n ?? 0;
  const code = s.code ?? null;
  switch (need) {
    case 'code':
      return code === null ? 0.5 * v(s.tools) + 0.25 * v(s.grounded) + 0.25 * v(s.json) : 0.4 * code + 0.35 * v(s.tools) + 0.15 * v(s.grounded) + 0.1 * v(s.json);
    case 'research':
      return 0.5 * v(s.tools) + 0.4 * v(s.grounded) + 0.1 * v(s.json);
    case 'plan':
    case 'review':
      return code === null
        ? 0.3 * v(s.routing) + 0.3 * v(s.grounded) + 0.2 * v(s.tools) + 0.2 * v(s.json)
        : 0.25 * v(s.routing) + 0.25 * v(s.grounded) + 0.2 * v(s.tools) + 0.15 * v(s.json) + 0.15 * code;
    case 'utility':
      return 0.5 * v(s.routing) + 0.3 * v(s.json) + 0.2 * v(s.grounded);
    case 'write':
      return 0.7 * v(s.grounded) + 0.3 * v(s.json);
    default:
      return null;
  }
}

/** Measured models that passed come first, then unmeasured ones, then measured ones that did poorly. */
const PASSING_CHECK = 0.5;

/**
 * Rogly pick for a need. Free models have no cost, so the rule is purely quality: the best score on
 * Nucleas's own checks when the models have been measured, otherwise the most advanced model by its
 * name (localModelPowerScore: newer generation > size > reasoning). New Rogly models are picked up
 * automatically and measured the next time checks run.
 */
function freeFor(models: AvailableModel[], need: Need): AvailableModel | undefined {
  const free = models.filter((m) => m.free && m.autoEligible);
  const tier = (m: AvailableModel) => {
    const score = checkScore(m, need);
    return score === null ? 1 : score >= PASSING_CHECK ? 0 : 2;
  };
  const strongest = (pool: AvailableModel[]) =>
    [...pool].sort(
      (a, b) =>
        tier(a) - tier(b) ||
        (checkScore(b, need) ?? 0) - (checkScore(a, need) ?? 0) ||
        // Equal scores: the faster model (measured average reply time).
        (a.checks?.avgLatencyMs ?? 1e9) - (b.checks?.avgLatencyMs ?? 1e9) ||
        localModelPowerScore(b.model) - localModelPowerScore(a.model) ||
        (b.contextTokens ?? 0) - (a.contextTokens ?? 0)
    )[0];
  // Tool-driven work skips models whose host was measured to refuse tool calls.
  const toolCapable = (pool: AvailableModel[]) => pool.filter((m) => m.checks?.supports.tools !== false);
  if (need === 'code' || need === 'research') return strongest(toolCapable(withStrength(free, 'coding'))) ?? strongest(toolCapable(free)) ?? strongest(free);
  if (need === 'vision') return strongest(withStrength(free, 'vision'));
  // Writing and utilities: any text-capable model; take the strongest.
  return strongest(withStrength(free, 'chat', 'reasoning')) ?? strongest(free);
}

/**
 * Paid models that can do the task. Every model with a benchmark score for it takes part; models
 * without one are used only when nothing is scored (no benchmark key yet), matched by strength tags.
 */
function paidFor(models: AvailableModel[], need: Need): AvailableModel[] {
  const paid = models.filter((m) => !m.free && m.autoEligible && m.blendedPricePer1M !== null);
  if (need === 'vision') {
    const vision = withStrength(paid, 'vision');
    const scored = vision.filter((m) => benchmarkScore(m, need) !== null);
    return scored.length ? scored : vision;
  }
  const scored = paid.filter((m) => benchmarkScore(m, need) !== null);
  if (scored.length) return scored;
  switch (need) {
    case 'plan':
    case 'review':
    case 'research':
      return withStrength(paid, 'reasoning', 'coding', 'chat');
    case 'code':
      return withStrength(paid, 'coding', 'reasoning');
    default:
      return withStrength(paid, 'chat', 'reasoning');
  }
}

export function selectFrom(models: AvailableModel[], need: Need, level: CostLevel, ceilings: PriceCeilings = DEFAULT_PRICE_CEILINGS): Omit<Selection, 'source'> {
  const free = freeFor(models, need);
  const base = { need, level };
  // Free: Rogly for everything, no paid fallback of any kind.
  if (level === 'free') return { ...base, primary: choice(free), fallback: null };
  const paid = paidFor(models, need);
  // The strongest paid model for this task within the level's price ceiling.
  const paidPick = bestUnder(paid, need, ceilings[level]);

  switch (need) {
    case 'plan':
    case 'review':
      // No paid credential at all: fall back to the free model rather than failing.
      return { ...base, primary: choice(paidPick ?? free), fallback: null };
    case 'utility':
      // Utilities never need paid models; Rogly's strongest text model handles them at every level.
      return { ...base, primary: choice(free ?? paidPick), fallback: null };
    case 'write':
    case 'research':
    case 'code':
    case 'vision':
      // High: a paid model does the work — the strongest within the medium ceiling (the high-ceiling
      // model plans and reviews). Low/medium: Rogly does the work; medium may retry on its paid
      // pick when Rogly fails, low never pays to retry.
      if (level === 'high') return { ...base, primary: choice(bestUnder(paid, need, ceilings.medium) ?? free), fallback: null };
      return { ...base, primary: choice(free ?? paidPick), fallback: level === 'medium' && free ? choice(paidPick) : null };
  }
}


// ---------- Settings: org default level and optional pins ----------

const settingsSchema = new Schema(
  {
    organizationId: { type: String, required: true, unique: true },
    defaultCostLevel: { type: String, enum: COST_LEVELS, default: 'low' },
    /** level -> max blended $ per 1M tokens (null = none). Missing levels use the defaults. */
    priceCeilings: { type: Schema.Types.Mixed },
    /** need -> pinned model (applies at every level). */
    pins: { type: Schema.Types.Mixed, default: {} },
    updatedByUserId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true }
);
type SettingsDoc = InferSchemaType<typeof settingsSchema>;
export const AiEngineSettings: Model<SettingsDoc> =
  (mongoose.models.AiEngineSettings as Model<SettingsDoc> | undefined) ?? mongoose.model<SettingsDoc>('AiEngineSettings', settingsSchema);

type Pins = Partial<Record<Need, { profileId: string; model: string }>>;

export interface EngineSettings {
  defaultCostLevel: CostLevel;
  priceCeilings: PriceCeilings;
  pins: Pins;
}

export async function readEngineSettings(organizationId: string): Promise<EngineSettings> {
  const doc = await AiEngineSettings.findOne({ organizationId }).lean<{ defaultCostLevel?: CostLevel; priceCeilings?: Partial<PriceCeilings>; pins?: Pins }>();
  return {
    defaultCostLevel: doc?.defaultCostLevel ?? 'low',
    priceCeilings: { ...DEFAULT_PRICE_CEILINGS, ...(doc?.priceCeilings ?? {}) },
    pins: doc?.pins ?? {},
  };
}

/** A ceiling is a positive dollar amount, or null for none. */
export function isPriceCeiling(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000);
}

export function isCostLevel(value: unknown): value is CostLevel {
  return typeof value === 'string' && (COST_LEVELS as readonly string[]).includes(value);
}

/** Selects a model for a need. A pin overrides the automatic choice at every level. */
export async function selectModel(
  organizationId: string,
  need: Need,
  level: CostLevel,
  options: { models?: AvailableModel[]; settings?: Pick<EngineSettings, 'pins' | 'priceCeilings'> } = {}
): Promise<Selection> {
  const models = options.models ?? (await listAvailableModels());
  const settings = options.settings ?? (await readEngineSettings(organizationId));
  const pin = settings.pins[need];
  if (pin) {
    const pinned = models.find((m) => m.profileId === pin.profileId && m.model === pin.model);
    // At the free level a paid pin does not apply.
    if (pinned && (level !== 'free' || pinned.free)) return { need, level, primary: choice(pinned), fallback: null, source: 'pinned' };
  }
  const auto = selectFrom(models, need, level, settings.priceCeilings);
  return { ...auto, source: auto.primary ? 'auto' : 'none' };
}

export async function saveEngineSettings(
  organizationId: string,
  input: { defaultCostLevel?: CostLevel; priceCeilings?: Partial<PriceCeilings>; pin?: { need: Need; profileId: string; model: string } | null; unpin?: Need },
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const update: Record<string, unknown> = { updatedByUserId: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined };
  if (input.defaultCostLevel) {
    if (!isCostLevel(input.defaultCostLevel)) return { ok: false, error: 'Unknown cost level.' };
    update.defaultCostLevel = input.defaultCostLevel;
  }
  const set: Record<string, unknown> = { ...update };
  for (const [level, ceiling] of Object.entries(input.priceCeilings ?? {})) {
    if (!(PAID_COST_LEVELS as readonly string[]).includes(level) || !isPriceCeiling(ceiling)) return { ok: false, error: 'Price ceilings must be a dollar amount above 0, or empty for none.' };
    set[`priceCeilings.${level}`] = ceiling === null ? null : Math.round(ceiling * 1000) / 1000;
  }
  const unset: Record<string, ''> = {};
  if (input.pin) {
    if (!(NEEDS as readonly string[]).includes(input.pin.need)) return { ok: false, error: 'Unknown need.' };
    const available = await listAvailableModels();
    if (!available.some((m) => m.profileId === input.pin!.profileId && m.model === input.pin!.model)) {
      return { ok: false, error: 'That model is not available from an enabled credential.' };
    }
    set[`pins.${input.pin.need}`] = { profileId: input.pin.profileId, model: input.pin.model };
  }
  if (input.unpin) unset[`pins.${input.unpin}`] = '';
  await AiEngineSettings.updateOne({ organizationId }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { upsert: true });
  return { ok: true };
}

/** The paid ranking the engine uses for a need (for display in the AI Engine window). */
export function rankPaid(models: AvailableModel[], need: Need): AvailableModel[] {
  return rankByPower(paidFor(models, need), need);
}
