import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * The record a publishing job keeps so nothing is posted twice: every item it has seen (a page on the
 * company's site, a flagged email) and, per item, what happened on each platform.
 */

export const PUBLISH_ITEM_STATUSES = ['baseline', 'processed', 'skipped'] as const;

const factsSchema = new Schema(
  {
    title: { type: String, maxlength: 500 },
    description: { type: String, maxlength: 2000 },
    text: { type: String, maxlength: 6000 },
    image: { type: String, maxlength: 2000 },
    images: { type: [String], default: [] },
    video: { type: String, maxlength: 2000 },
  },
  { _id: false }
);

const itemSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    companyId: { type: Schema.Types.ObjectId, required: true },
    /** The page URL, or the flagged email's id: unique per job. */
    key: { type: String, required: true, maxlength: 2000 },
    url: { type: String, maxlength: 2000 },
    title: { type: String, maxlength: 500 },
    publishedAt: { type: Date },
    /** baseline: already there when the job was switched on, never posted. */
    status: { type: String, enum: PUBLISH_ITEM_STATUSES, required: true },
    skipReason: { type: String, maxlength: 300 },
    /** The same offer arriving in several emails shares this key, so it is added once. */
    dedupeKey: { type: String, maxlength: 300 },
    facts: { type: factsSchema },
  },
  { timestamps: true }
);
itemSchema.index({ jobId: 1, key: 1 }, { unique: true });
itemSchema.index({ jobId: 1, createdAt: -1 });
itemSchema.index({ jobId: 1, dedupeKey: 1, createdAt: -1 });

export type PublishItemDoc = InferSchemaType<typeof itemSchema>;
export const PublishItem: Model<PublishItemDoc> = (mongoose.models.PublishItem as Model<PublishItemDoc> | undefined) ?? mongoose.model<PublishItemDoc>('PublishItem', itemSchema);

/**
 * ready: waiting for a person to post it by hand. publishing: Nucleas is posting it right now (never
 * retried automatically, so a crash cannot double-post). posted, failed, skipped are final.
 */
export const PUBLISH_DELIVERY_STATUSES = ['ready', 'publishing', 'posted', 'failed', 'skipped'] as const;
export type PublishDeliveryStatus = (typeof PUBLISH_DELIVERY_STATUSES)[number];

const assetSchema = new Schema(
  { kind: { type: String, enum: ['image', 'video'], required: true }, url: { type: String, required: true, maxlength: 2000 } },
  { _id: false }
);

const deliverySchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    companyId: { type: Schema.Types.ObjectId, required: true },
    itemId: { type: Schema.Types.ObjectId, ref: 'PublishItem', required: true },
    platform: { type: String, required: true, maxlength: 40 },
    /** How the job was set when this was made; an auto post that could not be published becomes a manual card. */
    mode: { type: String, enum: ['auto', 'manual'], required: true },
    status: { type: String, enum: PUBLISH_DELIVERY_STATUSES, required: true },
    title: { type: String, maxlength: 300 },
    body: { type: String, required: true, maxlength: 40000 },
    link: { type: String, maxlength: 2000 },
    assets: { type: [assetSchema], default: [] },
    /** Admin records: the form values (field key → value) and the filled form or saved page as a JPEG (base64). */
    values: { type: Schema.Types.Mixed },
    screenshot: { type: String, maxlength: 1_200_000, select: false },
    postedUrl: { type: String, maxlength: 2000 },
    postedAt: { type: Date },
    postedByUserId: { type: Schema.Types.ObjectId },
    error: { type: String, maxlength: 1000 },
  },
  { timestamps: true }
);
deliverySchema.index({ itemId: 1, platform: 1 }, { unique: true });
deliverySchema.index({ jobId: 1, createdAt: -1 });
deliverySchema.index({ organizationId: 1, status: 1, createdAt: -1 });

export type PublishDeliveryDoc = InferSchemaType<typeof deliverySchema>;
export const PublishDelivery: Model<PublishDeliveryDoc> = (mongoose.models.PublishDelivery as Model<PublishDeliveryDoc> | undefined) ?? mongoose.model<PublishDeliveryDoc>('PublishDelivery', deliverySchema);
