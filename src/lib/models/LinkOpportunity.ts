import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

export const LINK_OPPORTUNITY_STATUSES = [
  'recommended',
  'saved',
  'approved',
  'rejected',
  'submitted',
  'live',
  'submission_rejected',
  'removed',
  'expired',
] as const;
export type LinkOpportunityStatus = (typeof LINK_OPPORTUNITY_STATUSES)[number];

const historySchema = new Schema(
  {
    at: { type: Date, required: true },
    status: { type: String, enum: LINK_OPPORTUNITY_STATUSES, required: true },
    userId: { type: Schema.Types.ObjectId },
    note: { type: String, maxlength: 1000 },
    verification: { type: String, enum: ['found', 'not_found', 'unavailable'] },
  },
  { _id: false }
);

const linkOpportunitySchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    runId: { type: Schema.Types.ObjectId, ref: 'JobRun', required: true },
    fingerprint: { type: String, required: true, maxlength: 64 },
    opportunityUrl: { type: String, required: true, maxlength: 4000 },
    targetUrl: { type: String, maxlength: 4000 },
    liveLinkUrl: { type: String, maxlength: 4000 },
    status: { type: String, enum: LINK_OPPORTUNITY_STATUSES, required: true, default: 'recommended' },
    values: { type: Schema.Types.Mixed, required: true },
    sources: { type: [String], default: [] },
    note: { type: String, maxlength: 1000 },
    submittedAt: { type: Date },
    lastVerifiedAt: { type: Date },
    nextVerificationAt: { type: Date },
    verificationMessage: { type: String, maxlength: 500 },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

linkOpportunitySchema.index({ jobId: 1, fingerprint: 1 }, { unique: true });
linkOpportunitySchema.index({ organizationId: 1, companyId: 1, updatedAt: -1 });
linkOpportunitySchema.index({ status: 1, nextVerificationAt: 1 });

export type LinkOpportunityDoc = InferSchemaType<typeof linkOpportunitySchema>;
export const LinkOpportunity: Model<LinkOpportunityDoc> =
  (mongoose.models.LinkOpportunity as Model<LinkOpportunityDoc> | undefined) ??
  mongoose.model<LinkOpportunityDoc>('LinkOpportunity', linkOpportunitySchema);
