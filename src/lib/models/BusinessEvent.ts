import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * First-party business events pushed by a company's own platform (e.g. a free signup), which no
 * connected provider can see. Subjects are stored only as a one-way hash: enough to count and
 * de-duplicate, never enough to identify a person.
 */
const businessEventSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    source: { type: String, required: true },
    type: { type: String, required: true },
    /** sha256 of the platform's user id, salted per company. */
    subjectHash: { type: String, required: true },
    occurredAt: { type: Date, required: true },
    receivedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false }
);
businessEventSchema.index({ companyId: 1, type: 1, subjectHash: 1 }, { unique: true });
businessEventSchema.index({ companyId: 1, type: 1, occurredAt: 1 });

export type BusinessEventDoc = InferSchemaType<typeof businessEventSchema>;
export const BusinessEvent: Model<BusinessEventDoc> =
  (mongoose.models.BusinessEvent as Model<BusinessEventDoc> | undefined) ?? mongoose.model<BusinessEventDoc>('BusinessEvent', businessEventSchema);
