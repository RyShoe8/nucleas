import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const ideModes = [
  'orchestrated',
  'marketing',
  'product',
  'support',
  'engineering',
  'researcher',
  'direct',
] as const;

const artifactSchema = new Schema(
  {
    kind: { type: String, enum: ['image'] as const, required: true },
    assetId: { type: String, required: true, maxlength: 64 },
    name: { type: String, required: true, maxlength: 200 },
    url: { type: String, required: true, maxlength: 4000 },
  },
  { _id: false }
);

const planSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 200 },
    summary: { type: String, required: true, maxlength: 2000 },
    steps: { type: [String], default: undefined },
    markdown: { type: String, required: true, maxlength: 24000 },
    status: {
      type: String,
      enum: ['ready_for_review', 'approved', 'building'] as const,
      required: true,
    },
  },
  { _id: false }
);

const stageToolSchema = new Schema(
  {
    stage: { type: String, enum: ['planner', 'worker', 'reviewer'] as const, required: true },
    model: { type: String, required: true, maxlength: 200 },
    toolsUsed: { type: [String], default: [] },
    compact: { type: Boolean },
  },
  { _id: false }
);

const evidenceReceiptSchema = new Schema(
  {
    kind: { type: String, enum: ['repository'] as const, required: true },
    tool: { type: String, enum: ['repo_search', 'repo_read'] as const, required: true },
    path: { type: String, required: true, maxlength: 500 },
    revision: { type: String, required: true, maxlength: 64 },
    startLine: { type: Number, required: true, min: 1 },
    endLine: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  },
  { _id: false }
);

const schema = new Schema(
  {
    organizationId: { type: String, required: true, immutable: true },
    projectId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    createdByUserId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    mode: { type: String, enum: ideModes, required: true },
    /** Direct mode company credential; empty string for worker modes. */
    directProfileId: {
      type: String,
      required: function (this: { mode?: string }) {
        return this.mode === 'direct';
      },
      default: '',
      maxlength: 64,
    },
    /** Direct mode model id; empty string for worker modes. */
    directModel: {
      type: String,
      required: function (this: { mode?: string }) {
        return this.mode === 'direct';
      },
      default: '',
      maxlength: 200,
    },
    requestId: { type: String, required: true, maxlength: 80 },
    role: { type: String, enum: ['user', 'assistant', 'status'] as const, required: true },
    text: { type: String, required: true, maxlength: 24000 },
    failureCategory: { type: String, maxlength: 64 },
    debugHint: { type: String, maxlength: 400 },
    runId: { type: String, maxlength: 64 },
    costMicros: { type: Number },
    reservedMicros: { type: Number },
    noProviderFee: { type: Boolean },
    toolsUsed: { type: [String], default: undefined },
    artifacts: { type: [artifactSchema], default: undefined },
    evidenceReceipts: { type: [evidenceReceiptSchema], default: undefined },
    stageTools: { type: [stageToolSchema], default: undefined },
    plan: { type: planSchema, default: undefined },
  },
  { timestamps: true }
);

schema.index(
  { organizationId: 1, projectId: 1, createdByUserId: 1, mode: 1, directProfileId: 1, directModel: 1, _id: -1 },
  { name: 'ide_chat_thread_time' }
);
schema.index(
  { organizationId: 1, projectId: 1, createdByUserId: 1, requestId: 1 },
  { unique: true, name: 'ide_chat_request_unique' }
);

function modelFor<T>(name: string, definition: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, definition);
}

export type AiIdeChatTurnDoc = InferSchemaType<typeof schema>;
export const AiIdeChatTurn = modelFor<AiIdeChatTurnDoc>('AiIdeChatTurn', schema);
export const ideChatHistoryModes = ideModes;
