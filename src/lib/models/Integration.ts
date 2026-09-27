import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * Company integrations. `organizationId` follows the tenant convention used by User/Client:
 * the organization admin's user id.
 */

export const INTEGRATION_STATUSES = ['declared', 'connected', 'needs_reauth', 'error', 'disabled'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

const connectionSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
    /** Null for org-scoped accounts shared by every company (e.g. Ahrefs). */
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    provider: { type: String, required: true, trim: true },
    scope: { type: String, enum: ['org', 'company'], required: true },
    status: { type: String, enum: INTEGRATION_STATUSES, default: 'declared' },
    source: { type: String, enum: ['stack_backfill', 'baseline', 'manual', 'onboarding'], required: true },
    secretId: { type: Schema.Types.ObjectId, ref: 'IntegrationSecret' },
    credentialHint: { type: String, trim: true },
    /** Provider-reported account identity after verification (e.g. Brevo company name). */
    accountLabel: { type: String, trim: true },
    /** Provider plan when known; capabilities report plan_limited from this. */
    planLabel: { type: String, trim: true },
    /** Credential works but the provider plan withholds data/API access. */
    planLimited: { type: Boolean, default: false },
    grantedScopes: { type: [String], default: [] },
    connectedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    lastVerifiedAt: { type: Date },
    lastError: { type: String, trim: true, maxlength: 500 },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true }
);
connectionSchema.index({ organizationId: 1, companyId: 1, provider: 1 }, { unique: true });
connectionSchema.index({ organizationId: 1, provider: 1, status: 1 });

const secretSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
    provider: { type: String, required: true, trim: true },
    /** secretBox ciphertext under purpose `integration:<provider>`. Never selected by default. */
    sealed: { type: String, required: true, select: false },
    hint: { type: String, trim: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    rotatedAt: { type: Date },
  },
  { timestamps: true }
);

const externalResourceSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    provider: { type: String, required: true, trim: true },
    resourceType: { type: String, required: true, trim: true },
    externalId: { type: String, required: true, trim: true },
    externalUrl: { type: String, trim: true },
    label: { type: String, trim: true },
    canonicalType: { type: String, required: true, trim: true },
    canonicalId: { type: Schema.Types.ObjectId, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true }
);
externalResourceSchema.index({ organizationId: 1, provider: 1, resourceType: 1, externalId: 1 }, { unique: true });
externalResourceSchema.index({ canonicalType: 1, canonicalId: 1 });

function modelFor<T>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}

export type IntegrationConnectionDoc = InferSchemaType<typeof connectionSchema>;
export type ExternalResourceDoc = InferSchemaType<typeof externalResourceSchema>;

export const IntegrationConnection = modelFor<IntegrationConnectionDoc>('IntegrationConnection', connectionSchema);
export const IntegrationSecret = modelFor<InferSchemaType<typeof secretSchema>>('IntegrationSecret', secretSchema);
export const ExternalResource = modelFor<ExternalResourceDoc>('ExternalResource', externalResourceSchema);
