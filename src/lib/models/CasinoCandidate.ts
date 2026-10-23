import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
const schema = new Schema({
 organizationId: { type: Schema.Types.ObjectId, required: true }, companyId: { type: Schema.Types.ObjectId, required: true }, jobId: { type: Schema.Types.ObjectId, required: true }, runId: { type: Schema.Types.ObjectId, required: true },
 domain: { type: String, required: true }, name: { type: String, required: true }, research: { type: Schema.Types.Mixed, required: true }, sources: { type: [String], default: [] },
 status: { type: String, enum: ['review','rejected','adding','added','failed'], default: 'review', required: true },
 blockers: { type: [String], default: [] }, note: { type: String, maxlength: 2000 }, decidedByUserId: Schema.Types.ObjectId, decidedAt: Date,
 siteUrl: String, error: String, addedAt: Date,
}, { timestamps: true });
schema.index({ organizationId: 1, companyId: 1, domain: 1 }, { unique: true });
schema.index({ organizationId: 1, companyId: 1, status: 1, createdAt: -1 });
export type CasinoCandidateDoc = InferSchemaType<typeof schema>;
export const CasinoCandidate: Model<CasinoCandidateDoc> = (mongoose.models.CasinoCandidate as Model<CasinoCandidateDoc> | undefined) ?? mongoose.model('CasinoCandidate', schema);
