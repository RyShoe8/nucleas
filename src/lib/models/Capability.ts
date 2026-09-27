import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/** Receipt for every capability invocation. Append-mostly; status advances, history is never rewritten. */
const invocationSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    capabilityId: { type: String, required: true },
    capabilityVersion: { type: Number, required: true },
    kind: { type: String, enum: ['read', 'write'], required: true },
    risk: { type: String, required: true },
    provider: { type: String, required: true },
    method: { type: String, enum: ['api', 'mcp', 'browser', 'human'], default: 'api' },
    status: {
      type: String,
      enum: ['pending_approval', 'running', 'succeeded', 'verified', 'failed', 'needs_setup', 'plan_limited', 'needs_reauth', 'denied', 'cancelled'],
      required: true,
    },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    requestedByAiRunId: { type: Schema.Types.ObjectId, ref: 'AiRun' },
    /** Scheduled system work (e.g. 'metrics-sync') rather than a person or AI run. */
    requestedBySystem: { type: String },
    /** Input as submitted (capability inputs never contain credentials). */
    input: { type: Schema.Types.Mixed, default: {} },
    inputDigest: { type: String, required: true },
    /** Bounded result for display and short-lived reuse. */
    output: { type: Schema.Types.Mixed },
    summary: { type: String, maxlength: 500 },
    error: { type: String, maxlength: 500 },
    resource: {
      resourceType: String,
      externalId: String,
      label: String,
      externalUrl: String,
    },
    verified: { type: Boolean },
    providerUnits: { type: Number, default: 0 },
    approvalId: { type: Schema.Types.ObjectId, ref: 'CapabilityApproval' },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);
invocationSchema.index({ organizationId: 1, companyId: 1, createdAt: -1 });
invocationSchema.index({ companyId: 1, capabilityId: 1, inputDigest: 1, status: 1, finishedAt: -1 });

/** Human approval bound to one exact invocation (capability + input digest). Consumed once. */
const approvalSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    invocationId: { type: Schema.Types.ObjectId, ref: 'CapabilityInvocation', required: true, unique: true },
    capabilityId: { type: String, required: true },
    inputDigest: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'denied', 'expired'], default: 'pending' },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);
approvalSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

function modelFor<T>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}

export type CapabilityInvocationDoc = InferSchemaType<typeof invocationSchema>;
export const CapabilityInvocation = modelFor<CapabilityInvocationDoc>('CapabilityInvocation', invocationSchema);
export const CapabilityApproval = modelFor<InferSchemaType<typeof approvalSchema>>('CapabilityApproval', approvalSchema);
