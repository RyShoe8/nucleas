import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
const upload = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  companyId: { type: Schema.Types.ObjectId, required: true },
  userId: { type: Schema.Types.ObjectId, required: true },
  assetId: { type: Schema.Types.ObjectId, required: true, unique: true },
  size: { type: Number, required: true }, sha256: { type: String, required: true },
  state: { type: String, enum: ['pending', 'verifying', 'complete'], default: 'pending' },
  lease: String, expiresAt: Date,
}, { timestamps: true });
upload.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
upload.index({ organizationId: 1, companyId: 1, userId: 1 });
type Upload = InferSchemaType<typeof upload>;
export const AnimationUpload: Model<Upload> = mongoose.models.AnimationUpload ?? mongoose.model('AnimationUpload', upload);
