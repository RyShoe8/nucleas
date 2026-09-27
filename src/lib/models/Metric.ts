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
export const MetricSyncState = modelFor<InferSchemaType<typeof syncStateSchema>>('MetricSyncState', syncStateSchema);
