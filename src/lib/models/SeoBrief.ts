import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

export const SEO_BRIEF_STATUSES = ['draft', 'approved'] as const;

const pageSchema = new Schema(
  { url: { type: String, required: true, maxlength: 4000 }, purpose: { type: String, required: true, maxlength: 500 }, keywords: { type: [String], default: [] } },
  { _id: false }
);

const seoBriefSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    status: { type: String, enum: SEO_BRIEF_STATUSES, required: true, default: 'draft' },
    projectName: { type: String, required: true, maxlength: 200 },
    summary: { type: String, required: true, maxlength: 4000 },
    audience: { type: String, required: true, maxlength: 4000 },
    goals: { type: [String], default: [] },
    primaryTopics: { type: [String], default: [] },
    competitors: { type: [String], default: [] },
    excludedTopics: { type: [String], default: [] },
    geographicTargets: { type: [String], default: [] },
    positioning: { type: String, default: '', maxlength: 4000 },
    priorityPages: { type: [pageSchema], default: [] },
    notes: { type: String, default: '', maxlength: 4000 },
    revision: { type: Number, required: true, default: 1 },
    approvedAt: { type: Date },
    approvedByUserId: { type: Schema.Types.ObjectId },
    updatedByUserId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true }
);

seoBriefSchema.index({ organizationId: 1, projectId: 1 }, { unique: true });
seoBriefSchema.index({ organizationId: 1, companyId: 1, status: 1 });

export type SeoBriefDoc = InferSchemaType<typeof seoBriefSchema>;
export const SeoBrief: Model<SeoBriefDoc> =
  (mongoose.models.SeoBrief as Model<SeoBriefDoc> | undefined) ?? mongoose.model<SeoBriefDoc>('SeoBrief', seoBriefSchema);
