import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * A job: non-code work for one company, designed by Nucleas, run once or on a schedule.
 *   designing → needs_answers ⇄ designing → proposed → testing (dry run) → ready → active
 *   → paused / done; rejected and archived close it.
 * Whether finished runs need review or complete automatically is fixed when the job is approved.
 */
export const JOB_STATUSES = ['designing', 'needs_answers', 'proposed', 'testing', 'ready', 'active', 'paused', 'done', 'rejected', 'archived', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

const eventSchema = new Schema(
  { at: { type: Date, required: true }, userId: { type: Schema.Types.ObjectId }, action: { type: String, required: true, maxlength: 40 }, note: { type: String, maxlength: 500 } },
  { _id: false }
);

const jobSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: JOB_STATUSES, required: true, default: 'designing' },
    /** What was asked for, in the person's words. */
    request: { type: String, required: true, maxlength: 6000 },
    /** The design (see jobDesignSchema); absent until the designer has run. */
    design: { type: Schema.Types.Mixed },
    /** The person's answers to the designer's questions: question id → { option?, text? }. */
    answers: { type: Schema.Types.Mixed, default: {} },
    /** Review each run's result, or complete automatically when every check passes. */
    completion: { type: String, enum: ['review', 'automatic'] },
    level: { type: String, enum: ['low', 'medium', 'high'] },
    /** Hard cap on AI spend per calendar month (micro-USD). */
    monthlyBudgetMicros: { type: Number, default: 2_000_000 },
    designCostMicros: { type: Number, default: 0 },
    lastRunAt: { type: Date },
    error: { type: String, maxlength: 1000 },
    events: { type: [eventSchema], default: [] },
  },
  { timestamps: true }
);
jobSchema.index({ organizationId: 1, status: 1, updatedAt: -1 });
jobSchema.index({ organizationId: 1, companyId: 1, createdAt: -1 });

export type JobDoc = InferSchemaType<typeof jobSchema>;
export const Job: Model<JobDoc> = (mongoose.models.Job as Model<JobDoc> | undefined) ?? mongoose.model<JobDoc>('Job', jobSchema);

export const JOB_RUN_STATUSES = ['running', 'needs_review', 'completed', 'rejected', 'failed'] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

const runSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    companyId: { type: Schema.Types.ObjectId, required: true },
    /** A dry run never applies anything; it shows what a real run would produce. */
    dryRun: { type: Boolean, default: false },
    status: { type: String, enum: JOB_RUN_STATUSES, required: true, default: 'running' },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    /** Live progress lines, newest last. */
    progress: { type: [String], default: [] },
    output: { type: Schema.Types.Mixed },
    /** Deterministic check problems and the reviewer's notes. */
    issues: { type: Schema.Types.Mixed, default: [] },
    review: { verdict: { type: String, enum: ['pass', 'fail'] }, notes: String, model: String },
    models: { type: [String], default: [] },
    costMicros: { type: Number, default: 0 },
    decidedByUserId: { type: Schema.Types.ObjectId },
    decisionNote: { type: String, maxlength: 500 },
    error: { type: String, maxlength: 1000 },
  },
  { timestamps: true }
);
runSchema.index({ jobId: 1, createdAt: -1 });
runSchema.index({ organizationId: 1, status: 1, updatedAt: -1 });

export type JobRunDoc = InferSchemaType<typeof runSchema>;
export const JobRun: Model<JobRunDoc> = (mongoose.models.JobRun as Model<JobRunDoc> | undefined) ?? mongoose.model<JobRunDoc>('JobRun', runSchema);
