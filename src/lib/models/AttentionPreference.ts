import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { DIGEST_MINUTES } from '@/lib/attention/types';
const schema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  intervalMinutes: { type: Number, enum: DIGEST_MINUTES, default: 0, required: true },
  nextDigestAt: { type: Date }, lastDigestAt: { type: Date }, leaseToken: String, leaseUntil: Date,
}, { timestamps: true });
schema.index({ organizationId: 1, userId: 1 }, { unique: true });
schema.index({ intervalMinutes: 1, nextDigestAt: 1, leaseUntil: 1 });
type Doc = InferSchemaType<typeof schema>;
export const AttentionPreference = (mongoose.models.AttentionPreference as mongoose.Model<Doc> | undefined) ?? mongoose.model<Doc>('AttentionPreference', schema);
