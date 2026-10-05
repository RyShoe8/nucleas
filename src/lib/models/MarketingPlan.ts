import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

export const MARKETING_PLAN_STATUSES = ['draft', 'approved'] as const;

const pageSchema = new Schema(
  { url: { type: String, required: true, maxlength: 4000 }, purpose: { type: String, required: true, maxlength: 500 }, keywords: { type: [String], default: [] } },
  { _id: false }
);

const marketingPlanSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    status: { type: String, enum: MARKETING_PLAN_STATUSES, required: true, default: 'draft' },
    companyName: { type: String, required: true, maxlength: 200 },
    summary: { type: String, required: true, maxlength: 5000 },
    audience: { type: String, required: true, maxlength: 5000 },
    goals: { type: [String], default: [] },
    positioning: { type: String, default: '', maxlength: 5000 },
    messagingPillars: { type: [String], default: [] },
    primaryTopics: { type: [String], default: [] },
    competitors: { type: [String], default: [] },
    excludedTopics: { type: [String], default: [] },
    geographicTargets: { type: [String], default: [] },
    priorityPages: { type: [pageSchema], default: [] },
    seoStrategy: { type: String, default: '', maxlength: 6000 },
    aiCitationStrategy: { type: String, default: '', maxlength: 6000 },
    aiTargetQuestions: { type: [String], default: [] },
    aiSourceTargets: { type: [String], default: [] },
    socialStrategy: { type: String, default: '', maxlength: 6000 },
    socialPlatforms: { type: [String], default: [] },
    socialContentPillars: { type: [String], default: [] },
    socialCadence: { type: String, default: '', maxlength: 2000 },
    kpis: { type: [String], default: [] },
    notes: { type: String, default: '', maxlength: 5000 },
    revision: { type: Number, required: true, default: 1 },
    approvedAt: Date,
    approvedByUserId: { type: Schema.Types.ObjectId },
    updatedByUserId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true }
);

marketingPlanSchema.index({ organizationId: 1, companyId: 1 }, { unique: true });
marketingPlanSchema.index({ organizationId: 1, status: 1, updatedAt: -1 });

export type MarketingPlanDoc = InferSchemaType<typeof marketingPlanSchema>;
export const MarketingPlan: Model<MarketingPlanDoc> =
  (mongoose.models.MarketingPlan as Model<MarketingPlanDoc> | undefined) ?? mongoose.model<MarketingPlanDoc>('MarketingPlan', marketingPlanSchema);
