import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/** One message in a user's private Nucleas assistant thread (portfolio-wide). */
const turnSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['user', 'assistant', 'status'], required: true },
    text: { type: String, required: true, maxlength: 40_000 },
    /** Companies this message focused on (explicit focus or detected in the question). */
    companyIds: { type: [Schema.Types.ObjectId], ref: 'Client', default: [] },
    /** Capability receipts produced while answering. */
    invocationIds: { type: [Schema.Types.ObjectId], default: [] },
    runId: { type: Schema.Types.ObjectId, ref: 'AiRun' },
    costMicros: { type: Number },
    contextSources: { type: [String], default: [] },
    /** 'orchestrated' (routes) or 'direct' (one chosen model). */
    mode: { type: String, enum: ['orchestrated', 'direct'] },
    /** Per-step record: which model handled each step and what it cost. */
    stages: { type: Schema.Types.Mixed },
    /** Files attached to a user message: what they were and the text models were given (capped). */
    attachments: {
      type: [
        {
          name: String,
          mime: String,
          size: Number,
          kind: { type: String, enum: ['text', 'pdf', 'image'] },
          text: { type: String, maxlength: 20_000 },
          error: String,
          describedBy: String,
          _id: false,
        },
      ],
      default: undefined,
    },
    /** A job this answer designed (see Jobs). */
    jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
    /** A code change this answer proposed (see Building). */
    buildRequestId: { type: Schema.Types.ObjectId, ref: 'BuildRequest' },
  },
  { timestamps: true }
);
turnSchema.index({ organizationId: 1, userId: 1, createdAt: -1 });
turnSchema.index({ organizationId: 1, companyIds: 1, role: 1 });

export type CompanyAssistantTurnDoc = InferSchemaType<typeof turnSchema>;
export const CompanyAssistantTurn: Model<CompanyAssistantTurnDoc> =
  (mongoose.models.CompanyAssistantTurn as Model<CompanyAssistantTurnDoc> | undefined) ??
  mongoose.model<CompanyAssistantTurnDoc>('CompanyAssistantTurn', turnSchema);
