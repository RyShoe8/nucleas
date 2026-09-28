import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * What Nucleas measured about each free model by running it (see modelChecks.ts): which request
 * features the host really supports and how well the model does the small tasks Ask depends on.
 * Selection uses these scores instead of guessing from the model's name.
 */

const scoresSchema = new Schema(
  {
    /** Replies that parse as the JSON asked for. */
    json: { type: Number, default: null },
    /** Deciding whether a request is a question, a code change or a job. */
    routing: { type: Number, default: null },
    /** Calling the right tool with the right arguments. */
    tools: { type: Number, default: null },
    /** Answering from given facts and admitting when they do not say. */
    grounded: { type: Number, default: null },
  },
  { _id: false }
);

const checkSchema = new Schema(
  {
    profileId: { type: Schema.Types.ObjectId, required: true },
    model: { type: String, required: true },
    status: { type: String, enum: ['queued', 'running', 'done', 'failed'], required: true },
    queuedAt: { type: Date },
    startedAt: { type: Date },
    checkedAt: { type: Date },
    /** Host accepts response_format json_schema (guided decoding) / json_object / tools. */
    supports: {
      jsonSchema: { type: Boolean, default: null },
      jsonObject: { type: Boolean, default: null },
      tools: { type: Boolean, default: null },
    },
    scores: { type: scoresSchema, default: () => ({}) },
    overall: { type: Number, default: null },
    avgLatencyMs: { type: Number, default: null },
    /** Short notes on what went wrong, for the admin view. */
    notes: { type: [String], default: [] },
    /** How chats give this model tools: native tools parameter, or described in the prompt. */
    toolMode: { type: String, enum: ['native', 'prompted'], default: null },
    error: { type: String, maxlength: 300 },
  },
  { timestamps: false }
);
checkSchema.index({ profileId: 1, model: 1 }, { unique: true });
checkSchema.index({ status: 1, queuedAt: 1 });

type CheckDoc = InferSchemaType<typeof checkSchema>;
export const AiModelCheck: Model<CheckDoc> =
  (mongoose.models.AiModelCheck as Model<CheckDoc> | undefined) ?? mongoose.model<CheckDoc>('AiModelCheck', checkSchema);

export interface CheckScores {
  json: number | null;
  routing: number | null;
  tools: number | null;
  grounded: number | null;
}

export interface ModelCheckSummary {
  status: 'queued' | 'running' | 'done' | 'failed';
  checkedAt: string | null;
  supports: { jsonSchema: boolean | null; jsonObject: boolean | null; tools: boolean | null };
  scores: CheckScores;
  overall: number | null;
  avgLatencyMs: number | null;
  notes: string[];
  toolMode: 'native' | 'prompted' | null;
  error: string | null;
}

export interface ModelCheckRow extends ModelCheckSummary {
  profileId: string;
  model: string;
}

type LeanCheck = {
  profileId: Types.ObjectId;
  model: string;
  status: ModelCheckSummary['status'];
  checkedAt?: Date | null;
  supports?: { jsonSchema?: boolean | null; jsonObject?: boolean | null; tools?: boolean | null };
  scores?: Partial<CheckScores>;
  overall?: number | null;
  avgLatencyMs?: number | null;
  notes?: string[];
  toolMode?: 'native' | 'prompted' | null;
  error?: string | null;
};

export function toCheckRow(doc: LeanCheck): ModelCheckRow {
  return {
    profileId: String(doc.profileId),
    model: doc.model,
    status: doc.status,
    checkedAt: doc.checkedAt ? doc.checkedAt.toISOString() : null,
    supports: { jsonSchema: doc.supports?.jsonSchema ?? null, jsonObject: doc.supports?.jsonObject ?? null, tools: doc.supports?.tools ?? null },
    scores: { json: doc.scores?.json ?? null, routing: doc.scores?.routing ?? null, tools: doc.scores?.tools ?? null, grounded: doc.scores?.grounded ?? null },
    overall: doc.overall ?? null,
    avgLatencyMs: doc.avgLatencyMs ?? null,
    notes: doc.notes ?? [],
    toolMode: doc.toolMode ?? null,
    error: doc.error ?? null,
  };
}

/** Check results are best-effort input to selection: never wait on a database that is not connected. */
export async function modelCheckRows(): Promise<ModelCheckRow[]> {
  if (mongoose.connection.readyState !== 1) return [];
  const docs = await AiModelCheck.find({}).lean<LeanCheck[]>();
  return docs.map(toCheckRow);
}

/** The latest completed measurements for one model, if any. */
export function checksFor(rows: ModelCheckRow[], profileId: string, model: string): ModelCheckRow | null {
  const row = rows.find((r) => r.profileId === profileId && r.model === model);
  return row && row.checkedAt ? row : null;
}
