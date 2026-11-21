import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

// A reservation for one responsibility target. The canonical job and its runs still own the work.
const entry = new Schema({
    token: { type: String, required: true }, label: String,
    startedAt: { type: Date, required: true }, finishedAt: Date,
    costMicros: { type: Number, default: 0 }, costUnknown: { type: Boolean, default: true },
}, { _id: false });
const schema = new Schema({
    organizationId: { type: Schema.Types.ObjectId, required: true },
    responsibilityId: { type: Schema.Types.ObjectId, required: true },
    jobId: { type: Schema.Types.ObjectId, required: true, unique: true },
    limitMicros: { type: Number, required: true },
    entries: { type: [entry], default: [] },
    closedAt: Date, leaseToken: String, leaseExpiresAt: Date,
}, { timestamps: true });
schema.index({ organizationId: 1, responsibilityId: 1 });
export type WorkBudgetDoc = InferSchemaType<typeof schema>;
export const WorkBudget: Model<WorkBudgetDoc> = (mongoose.models.WorkBudget as Model<WorkBudgetDoc> | undefined) ?? mongoose.model('WorkBudget', schema);
