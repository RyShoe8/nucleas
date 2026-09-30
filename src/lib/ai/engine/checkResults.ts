import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { EDIT_CASES, GROUNDED_CASES, ROUTING_CASES, TOOL_CASES } from './checkCases';

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
    /** Exact code edits, scored by applying them. */
    code: { type: Number, default: null },
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
    /** Partial results while a check runs across several passes (see runQueuedModelChecks). */
    progress: { type: Schema.Types.Mixed },
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
  code: number | null;
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
  /** While a check runs across passes: parts finished so far (of 5). */
  stagesDone: number;
  /** Where it is inside the current part, e.g. "routing 7 of 12"; null between parts. */
  stepDetail: string | null;
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
  progress?: { done?: string[]; cursor?: { stage: string; index: number } | null; toolRun?: { mode: string; seed?: { results?: unknown[] } } | null } | null;
};

const STAGE_TOTALS: Record<string, number> = { routing: ROUTING_CASES.length, grounded: GROUNDED_CASES.length, code: EDIT_CASES.length };

/** "routing 7 of 12" for the part a check is in the middle of. */
export function stepDetailFor(progress: LeanCheck['progress']): string | null {
  const cursor = progress?.cursor;
  if (cursor && STAGE_TOTALS[cursor.stage]) return `${cursor.stage} ${cursor.index} of ${STAGE_TOTALS[cursor.stage]}`;
  const tools = progress?.toolRun;
  if (tools) return `tools${tools.mode === 'prompted' ? ' (prompted)' : ''} ${tools.seed?.results?.length ?? 0} of ${TOOL_CASES.length}`;
  return null;
}

export function toCheckRow(doc: LeanCheck): ModelCheckRow {
  return {
    profileId: String(doc.profileId),
    model: doc.model,
    status: doc.status,
    checkedAt: doc.checkedAt ? doc.checkedAt.toISOString() : null,
    supports: { jsonSchema: doc.supports?.jsonSchema ?? null, jsonObject: doc.supports?.jsonObject ?? null, tools: doc.supports?.tools ?? null },
    scores: { json: doc.scores?.json ?? null, routing: doc.scores?.routing ?? null, tools: doc.scores?.tools ?? null, grounded: doc.scores?.grounded ?? null, code: doc.scores?.code ?? null },
    overall: doc.overall ?? null,
    avgLatencyMs: doc.avgLatencyMs ?? null,
    notes: doc.notes ?? [],
    toolMode: doc.toolMode ?? null,
    stagesDone: doc.progress?.done?.length ?? 0,
    stepDetail: stepDetailFor(doc.progress),
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
