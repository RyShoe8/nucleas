import mongoose, { Schema, type Model } from 'mongoose';

/**
 * Cached answers from free SEO sources (Google autocomplete, page outlines). Shared across the organization, so asking
 * again within the window costs nothing and does not hit the source. Rows expire on their own.
 */
const seoLookupSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: ['keyword_ideas', 'page_outline'], required: true },
    /** Normalized request, e.g. "best slot apps|us|en|expand". */
    key: { type: String, required: true, maxlength: 2000 },
    data: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);
seoLookupSchema.index({ organizationId: 1, kind: 1, key: 1 }, { unique: true });
seoLookupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export interface SeoLookupDoc {
  organizationId: mongoose.Types.ObjectId;
  kind: 'keyword_ideas' | 'page_outline';
  key: string;
  data: unknown;
  expiresAt: Date;
}

export const SeoLookup: Model<SeoLookupDoc> =
  (mongoose.models.SeoLookup as Model<SeoLookupDoc> | undefined) ?? mongoose.model<SeoLookupDoc>('SeoLookup', seoLookupSchema);
