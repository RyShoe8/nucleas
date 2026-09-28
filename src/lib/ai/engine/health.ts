import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * Credentials and models that just failed at the provider, so automatic selection skips them for a
 * while instead of picking them again. A rejected key (401) or an unpaid account (402) benches the
 * whole credential; a refused model (403) benches only that model. Any success clears it.
 */

const BENCH_MS = 30 * 60 * 1000;

const healthSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, required: true },
    /** '' = the whole credential. */
    model: { type: String, default: '' },
    httpStatus: { type: Number, required: true },
    message: { type: String, maxlength: 300 },
    failedAt: { type: Date, required: true },
    until: { type: Date, required: true },
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
}

/** Which failures bench what: 401/402 the credential, 403 the model; others (rate limits, outages) nothing. */
export function benchScope(httpStatus: number | undefined): 'credential' | 'model' | null {
  if (httpStatus === 401 || httpStatus === 402) return 'credential';
  if (httpStatus === 403) return 'model';
  return null;
}

/** Health is best-effort bookkeeping: never wait on a database that is not connected. */
function connected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function recordModelFailure(input: { profileId: string; model: string; httpStatus?: number; message?: string }): Promise<void> {
  const scope = benchScope(input.httpStatus);
  if (!scope || !Types.ObjectId.isValid(input.profileId) || !connected()) return;
  const now = new Date();
  await AiModelHealth.updateOne(
    { profileId: new Types.ObjectId(input.profileId), model: scope === 'credential' ? '' : input.model },
    { $set: { httpStatus: input.httpStatus, message: input.message?.slice(0, 300), failedAt: now, until: new Date(now.getTime() + BENCH_MS) } },
    { upsert: true }
  );
}

export async function recordModelSuccess(profileId: string, model: string): Promise<void> {
  if (!Types.ObjectId.isValid(profileId) || !connected()) return;
  await AiModelHealth.deleteMany({ profileId: new Types.ObjectId(profileId), model: { $in: ['', model] } });
}

export async function activeHealthIssues(now = new Date()): Promise<HealthIssue[]> {
  if (!connected()) return [];
  const rows = await AiModelHealth.find({ until: { $gt: now } })
    .lean<{ profileId: Types.ObjectId; model: string; httpStatus: number; message?: string; until: Date }[]>();
  return rows.map((r) => ({ profileId: String(r.profileId), model: r.model || null, httpStatus: r.httpStatus, message: r.message ?? null, until: r.until.toISOString() }));
}

/** True when this credential or model is benched. */
export function isBenched(issues: HealthIssue[], profileId: string, model: string): HealthIssue | null {
  return issues.find((i) => i.profileId === profileId && (i.model === null || i.model === model)) ?? null;
}
