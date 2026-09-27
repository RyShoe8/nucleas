import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/** One message in a user's private assistant thread for a company. */
const turnSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['user', 'assistant', 'status'], required: true },
    text: { type: String, required: true, maxlength: 40_000 },
    /** Capability receipts produced while answering. */
    invocationIds: { type: [Schema.Types.ObjectId], default: [] },
    runId: { type: Schema.Types.ObjectId, ref: 'AiRun' },
    costMicros: { type: Number },
    contextSources: { type: [String], default: [] },
  },
  { timestamps: true }
);
turnSchema.index({ companyId: 1, userId: 1, createdAt: -1 });

export type CompanyAssistantTurnDoc = InferSchemaType<typeof turnSchema>;
export const CompanyAssistantTurn: Model<CompanyAssistantTurnDoc> =
  (mongoose.models.CompanyAssistantTurn as Model<CompanyAssistantTurnDoc> | undefined) ??
  mongoose.model<CompanyAssistantTurnDoc>('CompanyAssistantTurn', turnSchema);
