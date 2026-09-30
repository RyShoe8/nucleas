import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * A code change for one company, from plan to pull request.
 *   proposed → (edited) → approved into the queue (queued) → building → ready | failed
 *   ready → pr_opened; any open state → rejected / discarded.
 * Approval, retries and pull requests are human actions; the build itself never pushes.
 */
export const BUILD_STATUSES = ['proposed', 'rejected', 'queued', 'building', 'ready', 'failed', 'pr_opened', 'discarded'] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

const eventSchema = new Schema(
  {
    at: { type: Date, required: true },
    userId: { type: Schema.Types.ObjectId },
    action: { type: String, required: true, maxlength: 40 },
    note: { type: String, maxlength: 500 },
  },
  { _id: false }
);

const buildSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: BUILD_STATUSES, required: true, default: 'proposed' },
    /** What was asked for, in the user's words. */
    request: { type: String, required: true, maxlength: 6000 },
    title: { type: String, required: true, maxlength: 200 },
    summary: { type: String, maxlength: 2000, default: '' },
    steps: { type: [String], default: [] },
    /** The plan the build follows (editable until approved). */
    planMarkdown: { type: String, required: true, maxlength: 40_000 },
    repository: {
      owner: { type: String, required: true },
      repo: { type: String, required: true },
      defaultBranch: { type: String, required: true },
    },
    level: { type: String, enum: ['free', 'low', 'medium', 'high'] },
    planCostMicros: { type: Number, default: 0 },
    assistantTurnId: { type: Schema.Types.ObjectId },
    approvedByUserId: { type: Schema.Types.ObjectId },
    approvedAt: { type: Date },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    attempts: { type: Number, default: 0 },
    result: {
      artifactId: { type: Schema.Types.ObjectId },
      outcome: { type: String, enum: ['completed', 'blocked', 'failed'] },
      summary: { type: String, maxlength: 4000 },
      baseCommit: { type: String },
      changedFiles: { type: [String], default: undefined },
      checks: { type: [{ command: String, exitCode: Number, timedOut: Boolean, _id: false }], default: undefined },
      limitations: { type: [String], default: undefined },
      model: { type: String },
      /** The AI engine chose the model (false = the build service's own configured model). */
      engineModel: { type: Boolean },
      inputTokens: { type: Number },
      outputTokens: { type: Number },
      costMicros: { type: Number },
    },
    error: { type: String, maxlength: 1000 },
    pullRequest: {
      url: { type: String },
      number: { type: Number },
      branch: { type: String },
    },
    events: { type: [eventSchema], default: [] },
  },
  { timestamps: true }
);
buildSchema.index({ organizationId: 1, status: 1, updatedAt: -1 });
buildSchema.index({ organizationId: 1, companyId: 1, createdAt: -1 });

export type BuildRequestDoc = InferSchemaType<typeof buildSchema>;
export const BuildRequest: Model<BuildRequestDoc> =
  (mongoose.models.BuildRequest as Model<BuildRequestDoc> | undefined) ?? mongoose.model<BuildRequestDoc>('BuildRequest', buildSchema);
