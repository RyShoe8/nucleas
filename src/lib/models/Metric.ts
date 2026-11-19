import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/** One value per company, metric and UTC day. Daily metrics are re-written while providers revise recent days. */
const snapshotSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    metricKey: { type: String, required: true },
    /** YYYY-MM-DD (UTC). */
    date: { type: String, required: true },
    value: { type: Number, required: true },
    /** e.g. per-currency amounts in minor units. */
    breakdown: { type: Schema.Types.Mixed },
    /** Receipt that produced this value. */
    invocationId: { type: Schema.Types.ObjectId, ref: 'CapabilityInvocation' },
  },
  { timestamps: true }
);
snapshotSchema.index({ companyId: 1, metricKey: 1, date: 1 }, { unique: true });
snapshotSchema.index({ organizationId: 1, metricKey: 1, date: -1 });

/**
 * The same daily numbers split by website, for companies with several sites. A breakdown kept apart from
 * the company totals above, so a total is never stored twice or summed from these rows. `site` is the
 * canonical host (siteKey: no www., lowercase), so www.example.com and example.com are one site.
 */
const siteSnapshotSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    site: { type: String, required: true },
    metricKey: { type: String, required: true },
    /** YYYY-MM-DD (UTC). */
    date: { type: String, required: true },
    value: { type: Number, required: true },
    breakdown: { type: Schema.Types.Mixed },
    invocationId: { type: Schema.Types.ObjectId, ref: 'CapabilityInvocation' },
  },
  { timestamps: true }
);
siteSnapshotSchema.index({ companyId: 1, site: 1, metricKey: 1, date: 1 }, { unique: true });

/** Per-company sync bookkeeping with a lease so overlapping cron runs never sync the same company twice. */
const syncStateSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true, unique: true },
    lastRunAt: { type: Date },
    lastSuccessAt: { type: Date },
    /** Capabilities whose initial history backfill has completed (sources connected later backfill on their own). */
    backfilledCapabilities: { type: [String], default: [] },
    leaseUntil: { type: Date },
    leaseToken: { type: String },
    lastSummary: { type: String, maxlength: 500 },
  },
  { timestamps: true }
);

function modelFor<T>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}

export type MetricSnapshotDoc = InferSchemaType<typeof snapshotSchema>;
export const MetricSnapshot = modelFor<MetricSnapshotDoc>('MetricSnapshot', snapshotSchema);
export type MetricSiteSnapshotDoc = InferSchemaType<typeof siteSnapshotSchema>;
export const MetricSiteSnapshot = modelFor<MetricSiteSnapshotDoc>('MetricSiteSnapshot', siteSnapshotSchema);
export const MetricSyncState = modelFor<InferSchemaType<typeof syncStateSchema>>('MetricSyncState', syncStateSchema);
