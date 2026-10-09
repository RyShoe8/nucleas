import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const schema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  persona: { type: String, default: '', maxlength: 20000 },
  profile: { type: Schema.Types.Mixed },
  examples: { type: String, default: '', maxlength: 16000 },
  sources: { type: [String], default: [] },
  status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
  revision: { type: Number, default: 0 },
  updatedByUserId: { type: Schema.Types.ObjectId, required: true },
}, { timestamps: true });
schema.index({ organizationId: 1, companyId: 1 }, { unique: true });
type BrandVoiceDoc = InferSchemaType<typeof schema>;
export const BrandVoice: Model<BrandVoiceDoc> = (mongoose.models.BrandVoice as Model<BrandVoiceDoc> | undefined) ?? mongoose.model<BrandVoiceDoc>('BrandVoice', schema);
