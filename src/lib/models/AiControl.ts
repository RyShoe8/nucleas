import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { runStateSchema } from '@nucleas/ai-contracts';

const scope = {
  organizationId: { type: String, required: true },
  projectId: { type: Schema.Types.ObjectId, required: true, ref: 'Project' },
};
const objectiveSchema = new Schema({
  ...scope,
  createdByUserId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
  requestId: { type: String, required: true },
  title: { type: String, required: true, maxlength: 200 },
  outcome: { type: String, required: true, maxlength: 6000 },
  constraints: { type: String, default: '', maxlength: 6000 },
  acceptanceCriteria: { type: [String], required: true },
}, { timestamps: true });
objectiveSchema.index({ organizationId: 1, projectId: 1, requestId: 1 }, { unique: true });
objectiveSchema.index({ organizationId: 1, projectId: 1, createdAt: -1 });
objectiveSchema.index({ organizationId: 1, projectId: 1, createdAt: -1, _id: -1 });

const planTask = new Schema({
  key: { type: String, required: true }, name: { type: String, required: true },
  description: { type: String, default: '' }, acceptanceCriteria: { type: [String], required: true },
  dependsOn: { type: [String], default: [] },
}, { _id: false });
const planSchema = new Schema({
  ...scope,
  objectiveId: { type: Schema.Types.ObjectId, required: true, ref: 'AiObjective' },
  requestId: { type: String, required: true },
  createdByUserId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
  source: { type: String, enum: ['human', 'remote-model'], default: 'human', required: true },
  runId: { type: Schema.Types.ObjectId, ref: 'AiRun' },
  summary: { type: String, required: true }, tasks: { type: [planTask], required: true },
  digest: { type: String, required: true },
  projectUpdatedAt: { type: Date, required: true },
  status: { type: String, enum: ['draft', 'approved'], default: 'draft', required: true },
  expiresAt: { type: Date, required: true },
  approvedByUserId: { type: Schema.Types.ObjectId, ref: 'User' }, approvedAt: Date,
  materializedTaskIds: { type: [Schema.Types.ObjectId], default: [] },
}, { timestamps: true });
planSchema.index({ organizationId: 1, projectId: 1, requestId: 1 }, { unique: true });
planSchema.index({ organizationId: 1, projectId: 1, createdAt: -1 });
planSchema.index({ organizationId: 1, projectId: 1, createdAt: -1, _id: -1 });

const runSchema = new Schema({
  ...scope,
  taskId: Schema.Types.ObjectId, parentRunId: Schema.Types.ObjectId,
  role: { type: String, enum: ['architect', 'worker', 'reviewer'], required: true },
  status: { type: String, enum: runStateSchema.options, default: 'queued', required: true },
  revision: { type: Number, default: 0, required: true },
  model: String, nodeId: Schema.Types.ObjectId, inputDigest: { type: String, required: true },
  policyDigest: { type: String, required: true },
  createdByUserId: { type: Schema.Types.ObjectId, required: true },
  startedAt: Date, completedAt: Date,
  objectiveId: Schema.Types.ObjectId, planId: Schema.Types.ObjectId,
  currentArtifactId: Schema.Types.ObjectId, currentReviewId: Schema.Types.ObjectId,
  failureCode: String, inputTokens: Number, outputTokens: Number, latencyMs: Number,
  /** Input tokens read from and written to the provider's prompt cache (already counted in inputTokens). */
  cacheReadTokens: Number, cacheWriteTokens: Number,
  costMicros: Number,
}, { timestamps: true });
runSchema.index({ organizationId: 1, projectId: 1, createdAt: -1 });
runSchema.index({ organizationId: 1, projectId: 1, createdAt: -1, _id: -1 });
runSchema.index({ organizationId: 1, status: 1, createdAt: -1, _id: -1 });

const acknowledgementSchema = new Schema({
  organizationId: { type: String, required: true }, userId: { type: Schema.Types.ObjectId, required: true },
  runId: { type: Schema.Types.ObjectId, required: true }, revision: { type: Number, required: true, min: 0 },
}, { timestamps: true });
acknowledgementSchema.index({ organizationId: 1, userId: 1, runId: 1 }, { unique: true });

const eventSchema = new Schema({
  ...scope, runId: { type: Schema.Types.ObjectId, required: true },
  sequence: { type: Number, required: true }, type: { type: String, required: true },
  summary: { type: String, required: true, maxlength: 2000 },
}, { timestamps: { createdAt: true, updatedAt: false } });
eventSchema.index({ organizationId: 1, runId: 1, sequence: 1 }, { unique: true });

const budgetSchema = new Schema({
  organizationId: { type: String, required: true },
  // One explicit scope key (org or project) and UTC accounting period per ledger.
  scopeKey: { type: String, required: true }, period: { type: String, required: true },
  limitMicros: { type: Number, required: true, min: 0 },
  spentMicros: { type: Number, default: 0, required: true, min: 0 },
  reservedMicros: { type: Number, default: 0, required: true, min: 0 },
}, { timestamps: true });
budgetSchema.index({ organizationId: 1, scopeKey: 1, period: 1 }, { unique: true });
const reservationSchema = new Schema({
  organizationId: { type: String, required: true },
  runId: { type: Schema.Types.ObjectId, required: true },
  budgetId: { type: Schema.Types.ObjectId, required: true },
  amountMicros: { type: Number, required: true, min: 0 },
  state: { type: String, enum: ['reserved', 'settled'], default: 'reserved', required: true },
  actualMicros: Number,
}, { timestamps: true });
reservationSchema.index({ organizationId: 1, runId: 1, budgetId: 1 }, { unique: true });

const jobSchema = new Schema({
  ...scope,
  requestId: { type: String, required: true }, runId: { type: Schema.Types.ObjectId, required: true },
  objectiveId: { type: Schema.Types.ObjectId, required: true },
  createdByUserId: { type: Schema.Types.ObjectId, required: true },
  status: { type: String, enum: ['queued', 'running', 'done', 'blocked', 'cancelled'], default: 'queued', required: true },
  active: { type: Boolean, default: true, required: true },
  input: { type: String, required: true, maxlength: 16000 }, inputDigest: { type: String, required: true },
  policyDigest: { type: String, required: true }, projectUpdatedAt: { type: Date, required: true },
  leaseToken: String, leaseExpiresAt: Date, dispatchedAt: Date, inputClearedAt: Date,
  reservationMicros: { type: Number, required: true }, cancelRequested: { type: Boolean, default: false },
}, { timestamps: true });
jobSchema.index({ organizationId: 1, projectId: 1, requestId: 1 }, { unique: true });
jobSchema.index({ organizationId: 1, projectId: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true } });
jobSchema.index({ status: 1, createdAt: 1 });
jobSchema.index({ status: 1, leaseExpiresAt: 1 });
jobSchema.index({ runId: 1 }, { unique: true });
jobSchema.index({ active: 1, status: 1, inputClearedAt: 1, _id: 1 });
const dispatchLockSchema = new Schema({
  _id: { type: String, required: true },
  token: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  /** Holder AiRun id — used to steal locks after Stop when the run is no longer live. */
  runId: { type: Schema.Types.ObjectId, ref: 'AiRun' },
});
const dispatchUsageSchema = new Schema({
  _id: { type: String, required: true },
  day: { type: String, required: true },
  attempts: { type: Number, required: true },
  lastStartedAt: { type: Date, required: true },
});

function modelFor<T>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}
export const AiObjective = modelFor<InferSchemaType<typeof objectiveSchema>>('AiObjective', objectiveSchema);
export const AiPlan = modelFor<InferSchemaType<typeof planSchema>>('AiPlan', planSchema);
export const AiRun = modelFor<InferSchemaType<typeof runSchema>>('AiRun', runSchema);
export const AiRunAcknowledgement = modelFor<InferSchemaType<typeof acknowledgementSchema>>('AiRunAcknowledgement', acknowledgementSchema);
export const AiRunEvent = modelFor<InferSchemaType<typeof eventSchema>>('AiRunEvent', eventSchema);
export const AiBudget = modelFor<InferSchemaType<typeof budgetSchema>>('AiBudget', budgetSchema);
export const AiBudgetReservation = modelFor<InferSchemaType<typeof reservationSchema>>('AiBudgetReservation', reservationSchema);
export const AiPlanningJob = modelFor<InferSchemaType<typeof jobSchema>>('AiPlanningJob', jobSchema);
export const AiDispatchLock = modelFor<InferSchemaType<typeof dispatchLockSchema>>('AiDispatchLock', dispatchLockSchema);
export const AiDispatchUsage = modelFor<InferSchemaType<typeof dispatchUsageSchema>>('AiDispatchUsage', dispatchUsageSchema);

const searchApiUsageSchema = new Schema({
  organizationId: { type: String, required: true },
  periodMonth: { type: String, required: true },
  braveQueries: { type: Number, default: 0, required: true, min: 0 },
  googleCseWebQueries: { type: Number, default: 0, required: true, min: 0 },
  googleCseImageQueries: { type: Number, default: 0, required: true, min: 0 },
}, { timestamps: true });
searchApiUsageSchema.index({ organizationId: 1, periodMonth: 1 }, { unique: true });

export const AiSearchApiUsage = modelFor<InferSchemaType<typeof searchApiUsageSchema>>(
  'AiSearchApiUsage',
  searchApiUsageSchema
);
