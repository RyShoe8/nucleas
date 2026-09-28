import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * Adaptive provider circuits used by automatic model selection. Permanent refusals and rate limits
 * open immediately; transport, upstream, and invalid-response failures must repeat in a short
 * window. Cooldowns grow with consecutive failures, and any success closes the circuit.
 */

const MAX_CIRCUIT_MS = 30 * 60 * 1000;
const TRACKING_WINDOW_MS = 10 * 60 * 1000;

const healthSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, required: true },
    /** '' = the whole credential. */
    model: { type: String, default: '' },
    httpStatus: { type: Number, required: true },
    message: { type: String, maxlength: 300 },
    failedAt: { type: Date, required: true },
    until: { type: Date, required: true },
    failureCount: { type: Number, default: 1 },
    circuitOpen: { type: Boolean, default: true },
    category: { type: String, enum: ['credentials', 'rate_limit', 'upstream', 'invalid_response'] as const },
  },
  { timestamps: false }
);
healthSchema.index({ profileId: 1, model: 1 }, { unique: true });
healthSchema.index({ until: 1 }, { expireAfterSeconds: 0 });

type HealthDoc = InferSchemaType<typeof healthSchema>;
export const AiModelHealth: Model<HealthDoc> =
  (mongoose.models.AiModelHealth as Model<HealthDoc> | undefined) ?? mongoose.model<HealthDoc>('AiModelHealth', healthSchema);

export interface HealthIssue {
  profileId: string;
  /** Null when the whole credential is benched. */
  model: string | null;
  httpStatus: number;
  message: string | null;
  until: string;
  failureCount: number;
  category: string | null;
}

export type FailurePolicy = { scope: 'credential' | 'model'; threshold: number; baseCooldownMs: number; category: 'credentials' | 'rate_limit' | 'upstream' | 'invalid_response' };

/** Authentication opens immediately; transient endpoint failures open only after repetition. */
export function failurePolicy(input: { httpStatus?: number; code?: string; kind?: string }): FailurePolicy | null {
  const { httpStatus } = input;
  if (httpStatus === 401 || httpStatus === 402) return { scope: 'credential', threshold: 1, baseCooldownMs: MAX_CIRCUIT_MS, category: 'credentials' };
  if (httpStatus === 403) return { scope: 'model', threshold: 1, baseCooldownMs: MAX_CIRCUIT_MS, category: 'credentials' };
  if (httpStatus === 429) return { scope: 'credential', threshold: 1, baseCooldownMs: 2 * 60_000, category: 'rate_limit' };
  if (httpStatus !== undefined && httpStatus >= 500) return { scope: 'credential', threshold: 2, baseCooldownMs: 60_000, category: 'upstream' };
  if (input.code === 'invalid_response') return { scope: 'model', threshold: 3, baseCooldownMs: 60_000, category: 'invalid_response' };
  if (input.code === 'unavailable' || input.kind === 'timeout' || input.kind === 'transport') {
    return { scope: 'credential', threshold: 3, baseCooldownMs: 60_000, category: 'upstream' };
  }
  return null;
}

/** Kept for callers/tests that only need the immediate permanent-refusal scope. */
export function benchScope(httpStatus: number | undefined): 'credential' | 'model' | null {
  const policy = failurePolicy({ httpStatus });
  return policy?.threshold === 1 ? policy.scope : null;
}

/** Health is best-effort bookkeeping: never wait on a database that is not connected. */
function connected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function recordModelFailure(input: { profileId: string; model: string; httpStatus?: number; message?: string; code?: string; kind?: string }): Promise<void> {
  const policy = failurePolicy(input);
  if (!policy || !Types.ObjectId.isValid(input.profileId) || !connected()) return;
  const now = new Date();
  const key = { profileId: new Types.ObjectId(input.profileId), model: policy.scope === 'credential' ? '' : input.model };
  const cutoff = new Date(now.getTime() - TRACKING_WINDOW_MS);
  // Reset stale streaks, then increment atomically so concurrent failures cannot undercount.
  await AiModelHealth.updateOne({ ...key, failedAt: { $lt: cutoff } }, { $set: { failureCount: 0, circuitOpen: false } });
  const counted = await AiModelHealth.findOneAndUpdate(
    key,
    { $inc: { failureCount: 1 }, $set: {
      httpStatus: input.httpStatus ?? 0, message: input.message?.slice(0, 300), failedAt: now,
      circuitOpen: false, category: policy.category, until: new Date(now.getTime() + TRACKING_WINDOW_MS),
    } },
    { upsert: true, new: true }
  ).lean<{ failureCount?: number }>();
  const failureCount = counted?.failureCount ?? 1;
  const circuitOpen = failureCount >= policy.threshold;
  const exponent = Math.max(0, failureCount - policy.threshold);
  const cooldownMs = Math.min(MAX_CIRCUIT_MS, policy.baseCooldownMs * 2 ** exponent);
  if (circuitOpen) {
    await AiModelHealth.updateOne(key, { $set: { circuitOpen: true, until: new Date(now.getTime() + cooldownMs) } });
  }
}

export async function recordModelSuccess(profileId: string, model: string): Promise<void> {
  if (!Types.ObjectId.isValid(profileId) || !connected()) return;
  await AiModelHealth.deleteMany({ profileId: new Types.ObjectId(profileId), model: { $in: ['', model] } });
}

export async function activeHealthIssues(now = new Date()): Promise<HealthIssue[]> {
  if (!connected()) return [];
  const rows = await AiModelHealth.find({ until: { $gt: now }, $or: [{ circuitOpen: true }, { circuitOpen: { $exists: false } }] })
    .lean<{ profileId: Types.ObjectId; model: string; httpStatus: number; message?: string; until: Date; failureCount?: number; category?: string }[]>();
  return rows.map((r) => ({ profileId: String(r.profileId), model: r.model || null, httpStatus: r.httpStatus, message: r.message ?? null, until: r.until.toISOString(), failureCount: r.failureCount ?? 1, category: r.category ?? null }));
}

/** True when this credential or model is benched. */
export function isBenched(issues: HealthIssue[], profileId: string, model: string): HealthIssue | null {
  return issues.find((i) => i.profileId === profileId && (i.model === null || i.model === model)) ?? null;
}
