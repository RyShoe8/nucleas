import mongoose, { Schema } from 'mongoose';

const schema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  companyId: { type: Schema.Types.ObjectId, required: true },
  url: { type: String, required: true },
  alt: { type: String, required: true },
}, { timestamps: true });
export const PublishingImage = mongoose.models.PublishingImage || mongoose.model('PublishingImage', schema);
