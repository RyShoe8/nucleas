import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * A low-privilege account on a company's own website or app, used only to open pages read-only while
 * planning a change, so the plan can see what the page really shows. The password is sealed (AES-GCM,
 * purpose-scoped) and never returned by any API.
 */
const schema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    companyId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    /** https origin the account belongs to, e.g. https://playbound.club. Pages outside it are never opened. */
    baseUrl: { type: String, required: true, maxlength: 300 },
    username: { type: String, required: true, maxlength: 200 },
    passwordSealed: { type: String, required: true, maxlength: 2000 },
    passwordHint: { type: String, maxlength: 12, default: '' },
    updatedByUserId: { type: Schema.Types.ObjectId },
    lastCheckedAt: { type: Date },
    lastCheckOk: { type: Boolean },
    lastCheckNote: { type: String, maxlength: 300 },
  },
  { timestamps: true }
);

schema.index({ organizationId: 1, companyId: 1 }, { unique: true });

function modelFor<T>(name: string, definition: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, definition);
}

export type CompanyTestAccountDoc = InferSchemaType<typeof schema>;
export const CompanyTestAccount = modelFor<CompanyTestAccountDoc>('CompanyTestAccount', schema);
