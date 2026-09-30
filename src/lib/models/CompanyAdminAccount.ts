import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * A signed-in session on a company's own website or app, captured by a person logging in themselves in a browser window inside Nucleas.
 * Nucleas uses it only to open pages read-only while planning a change, so the plan can see what the page
 * really shows. No password is ever stored: only the session cookies, sealed (AES-GCM, purpose-scoped),
 * never returned by any API, and they stop working when the site expires or the person logs out.
 */
const schema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    companyId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    /** https origin the session belongs to, e.g. https://playbound.club. Pages outside it are never opened. */
    baseUrl: { type: String, required: true, maxlength: 300 },
    /** The captured cookies (JSON), sealed. Absent until a session is captured. */
    sessionSealed: { type: String, maxlength: 60_000 },
    cookieCount: { type: Number, default: 0 },
    capturedAt: { type: Date },
    /** The earliest expiry among the session's cookies, when the site sets one. */
    expiresAt: { type: Date },
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

export type CompanyAdminAccountDoc = InferSchemaType<typeof schema>;
export const CompanyAdminAccount = modelFor<CompanyAdminAccountDoc>('CompanyAdminAccount', schema);
