import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { listAvailableModels, type AvailableModel } from './catalog';
import type { ModelStrength } from '@/lib/ai/rolePipeline/providerCatalog';
import { localModelPowerScore } from '@/lib/ai/rolePipeline/modelMeta';

/**
 * The one model-selection system. Every AI job asks for a need at a cost level; the engine picks
 * the best available model automatically. Admins may pin a model per need (applies at every level).
 *
 * Paid models are ranked by power for each task: high uses #1, medium #2, low #3.
 *   low    — #3 paid model plans and reviews; Rogly does the work; never pays to retry
 *   medium — #2 paid model plans and reviews; Rogly does the work and may retry on the #2 model
 *   high   — #1 paid model plans, reviews and does the work; Rogly only for utilities
 * Rogly always uses its strongest model for the job.
 */

export const COST_LEVELS = ['low', 'medium', 'high'] as const;
export type CostLevel = (typeof COST_LEVELS)[number];

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

/**
 * Paid models ranked by power for the task: price is the most reliable cross-provider signal of
 * capability; the provider's flagship flag breaks ties (it is per-provider, so it never outranks price).
 */
function rankByPower(models: AvailableModel[]): AvailableModel[] {
  return [...models].sort(
    (a, b) => (b.blendedPricePer1M ?? 0) - (a.blendedPricePer1M ?? 0) || Number(b.flagship) - Number(a.flagship) || a.model.localeCompare(b.model)
  );
}

/** Power rank per level: high = #1, medium = #2, low = #3 (nearest available when fewer exist). */
export const LEVEL_RANK: Record<CostLevel, number> = { high: 1, medium: 2, low: 3 };

function ranked(models: AvailableModel[], rank: number): AvailableModel | undefined {
  const sorted = rankByPower(models);
  return sorted[Math.min(rank, sorted.length) - 1];
}

/**
 * Rogly pick for a need. Free models have no cost, so the rule is purely quality: the most advanced
 * free model that fits the job (localModelPowerScore: newer generation > size > reasoning). New
 * Rogly models are picked up automatically when they outrank the current ones.
 */
function freeFor(models: AvailableModel[], need: Need): AvailableModel | undefined {
  const free = models.filter((m) => m.free);
  const strongest = (pool: AvailableModel[]) =>
    [...pool].sort((a, b) => localModelPowerScore(b.model) - localModelPowerScore(a.model) || (b.contextTokens ?? 0) - (a.contextTokens ?? 0))[0];
  if (need === 'code' || need === 'research') return strongest(withStrength(free, 'coding')) ?? strongest(free);
  if (need === 'vision') return strongest(withStrength(free, 'vision'));
  // Writing and utilities: any text-capable model; take the strongest.
  return strongest(withStrength(free, 'chat', 'reasoning')) ?? strongest(free);
}

function paidFor(models: AvailableModel[], need: Need): AvailableModel[] {
  const paid = models.filter((m) => !m.free && m.blendedPricePer1M !== null);
  switch (need) {
    case 'plan':
    case 'review':
    case 'research':
      return withStrength(paid, 'reasoning', 'coding', 'chat');
    case 'code':
      return withStrength(paid, 'coding', 'reasoning');
    case 'vision':
      return withStrength(paid, 'vision');
    default:
      return withStrength(paid, 'chat', 'reasoning');
  }
}

export function selectFrom(models: AvailableModel[], need: Need, level: CostLevel): Omit<Selection, 'source'> {
  const paid = paidFor(models, need);
  const free = freeFor(models, need);
  const base = { need, level };
  // The paid model for this task at this level: #1 (high), #2 (medium) or #3 (low) by power.
  const paidPick = ranked(paid, LEVEL_RANK[level]);

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
      // High: the #1 paid model does the work. Low/medium: Rogly does the work; medium may retry
      // on its #2 paid model when Rogly fails, low never pays to retry.
      if (level === 'high') return { ...base, primary: choice(paidPick ?? free), fallback: null };
      return { ...base, primary: choice(free ?? paidPick), fallback: level === 'medium' && free ? choice(paidPick) : null };
  }
}

// ---------- Settings: org default level and optional pins ----------

const settingsSchema = new Schema(
  {
    organizationId: { type: String, required: true, unique: true },
    defaultCostLevel: { type: String, enum: COST_LEVELS, default: 'low' },
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

export async function readEngineSettings(organizationId: string): Promise<{ defaultCostLevel: CostLevel; pins: Pins }> {
  const doc = await AiEngineSettings.findOne({ organizationId }).lean<{ defaultCostLevel?: CostLevel; pins?: Pins }>();
  return { defaultCostLevel: doc?.defaultCostLevel ?? 'low', pins: doc?.pins ?? {} };
}

export function isCostLevel(value: unknown): value is CostLevel {
  return typeof value === 'string' && (COST_LEVELS as readonly string[]).includes(value);
}

/** Selects a model for a need. A pin overrides the automatic choice at every level. */
export async function selectModel(
  organizationId: string,
  need: Need,
  level: CostLevel,
  options: { models?: AvailableModel[]; settings?: { pins: Pins } } = {}
): Promise<Selection> {
  const models = options.models ?? (await listAvailableModels());
  const settings = options.settings ?? (await readEngineSettings(organizationId));
  const pin = settings.pins[need];
  if (pin) {
    const pinned = models.find((m) => m.profileId === pin.profileId && m.model === pin.model);
    if (pinned) return { need, level, primary: choice(pinned), fallback: null, source: 'pinned' };
  }
  const auto = selectFrom(models, need, level);
  return { ...auto, source: auto.primary ? 'auto' : 'none' };
}

export async function saveEngineSettings(
  organizationId: string,
  input: { defaultCostLevel?: CostLevel; pin?: { need: Need; profileId: string; model: string } | null; unpin?: Need },
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const update: Record<string, unknown> = { updatedByUserId: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined };
  if (input.defaultCostLevel) {
    if (!isCostLevel(input.defaultCostLevel)) return { ok: false, error: 'Unknown cost level.' };
    update.defaultCostLevel = input.defaultCostLevel;
  }
  const set: Record<string, unknown> = { ...update };
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
