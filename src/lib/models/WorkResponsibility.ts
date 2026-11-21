import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
const targetSchema = new Schema({
    key: { type: String, required: true }, url: { type: String, required: true },
    status: { type: String, enum: ['queued', 'working', 'review', 'current', 'blocked'], default: 'queued' },
    jobId: Schema.Types.ObjectId, attempts: { type: Number, default: 0 },
    score: Number, evidence: String, checkedAt: Date, checkedBy: Schema.Types.ObjectId,
    gatesPassed: [String], rubricVersion: Number, pageRevision: String, lastObservedAt: Date, observationError: String,
}, { _id: false });
const schema = new Schema({
    organizationId: { type: Schema.Types.ObjectId, required: true }, companyId: { type: Schema.Types.ObjectId, required: true },
    createdByUserId: { type: Schema.Types.ObjectId, required: true },
    agreement: { type: Schema.Types.Mixed, required: true },
    sourceTurnId: { type: Schema.Types.ObjectId, index: true },
    status: { type: String, enum: ['proposed', 'active', 'paused', 'monitoring', 'archived'], default: 'proposed' },
    rubricVersion: { type: Number, default: 1 }, revision: { type: Number, default: 0 },
    monthlyBudgetMicros: { type: Number, default: 0 }, unitBudgetMicros: { type: Number, default: 0 },
    targets: { type: [targetSchema], default: [] },
    // Reservations bound planned spend even when several target runs are in flight.
    allocationMonth: String, allocatedMicros: { type: Number, default: 0 },
    leaseToken: String, leaseExpiresAt: Date, error: String, nextCheckAt: Date,
}, { timestamps: true });
schema.index({ organizationId: 1, companyId: 1, status: 1 });
schema.index({ status: 1, leaseExpiresAt: 1 });
export type WorkResponsibilityDoc = InferSchemaType<typeof schema>;
export const WorkResponsibility: Model<WorkResponsibilityDoc> = (mongoose.models.WorkResponsibility as Model<WorkResponsibilityDoc> | undefined) ?? mongoose.model('WorkResponsibility', schema);
const assessmentSchema = new Schema({
    organizationId: { type: Schema.Types.ObjectId, required: true }, companyId: { type: Schema.Types.ObjectId, required: true },
    responsibilityId: { type: Schema.Types.ObjectId, required: true }, targetKey: { type: String, required: true },
    rubricVersion: { type: Number, required: true }, standard: String, score: Number, gatesPassed: [String], requiredGates: [String], evidence: String,
    pageRevision: String, checkedAt: { type: Date, required: true }, checkedBy: { type: Schema.Types.ObjectId, required: true },
});
assessmentSchema.index({ responsibilityId: 1, targetKey: 1, checkedAt: -1 });
type Assessment = InferSchemaType<typeof assessmentSchema>;
export const WorkAssessment: Model<Assessment> = (mongoose.models.WorkAssessment as Model<Assessment> | undefined) ?? mongoose.model('WorkAssessment', assessmentSchema);
const versionSchema = new Schema({
    organizationId: { type: Schema.Types.ObjectId, required: true }, companyId: { type: Schema.Types.ObjectId, required: true },
    responsibilityId: { type: Schema.Types.ObjectId, required: true }, version: { type: Number, required: true },
    agreement: { type: Schema.Types.Mixed, required: true }, changedBy: { type: Schema.Types.ObjectId, required: true },
}, { timestamps: true });
versionSchema.index({ responsibilityId: 1, version: 1 }, { unique: true });
type AgreementVersion = InferSchemaType<typeof versionSchema>;
export const WorkAgreementVersion: Model<AgreementVersion> = (mongoose.models.WorkAgreementVersion as Model<AgreementVersion> | undefined) ?? mongoose.model('WorkAgreementVersion', versionSchema);
