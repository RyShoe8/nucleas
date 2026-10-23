import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
const schema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true }, companyId: { type: Schema.Types.ObjectId, required: true },
  domain: { type: String, required: true }, name: String, url: String, sources: [String], priority: Number,
  status: { type: String, enum: ['new', 'checked', 'unavailable', 'ineligible', 'used'], default: 'new' },
  reason: String, checkedAt: Date, nextCheckAt: Date,
}, { timestamps: true });
schema.index({ organizationId: 1, companyId: 1, domain: 1 }, { unique: true });
export type LinkProspectDoc = InferSchemaType<typeof schema>;
export const LinkProspect: Model<LinkProspectDoc> = (mongoose.models.LinkProspect as Model<LinkProspectDoc> | undefined) ?? mongoose.model('LinkProspect', schema);
