import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * A company's own brand files: the high-quality logo and an icon. Both are optional. Whenever Nucleas makes
 * an image or video for the company it starts from these rather than inventing a look.
 */
export const BRAND_ASSET_KINDS = ['logo', 'icon'] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

const schema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    kind: { type: String, enum: BRAND_ASSET_KINDS, required: true },
    url: { type: String, required: true, maxlength: 1000 },
    fileName: { type: String, maxlength: 200 },
    contentType: { type: String, required: true, maxlength: 60 },
    sizeBytes: { type: Number, required: true },
    uploadedByUserId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true }
);
schema.index({ organizationId: 1, companyId: 1, kind: 1 }, { unique: true });
type BrandAssetDoc = InferSchemaType<typeof schema>;
export const BrandAsset: Model<BrandAssetDoc> = (mongoose.models.BrandAsset as Model<BrandAssetDoc> | undefined) ?? mongoose.model<BrandAssetDoc>('BrandAsset', schema);
