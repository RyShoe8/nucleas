import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const scope = { organizationId: { type: Schema.Types.ObjectId, required: true }, companyId: { type: Schema.Types.ObjectId, required: true } };
const settingsSchema = new Schema({ ...scope, repoIds: { type: [String], default: [] }, configured: { type: Boolean, default: false } }, { timestamps: true });
settingsSchema.index({ organizationId: 1, companyId: 1 }, { unique: true });
const schema = new Schema({
  ...scope,
  createdByUserId: { type: String, required: true },
  active: { type: Boolean, default: true },
  status: { type: String, enum: ['queued', 'generating', 'draft', 'failed', 'publishing', 'publish_uncertain', 'published', 'rejected'], required: true },
  progress: { type: String, default: '' }, error: { type: String, default: null },
  title: { type: String, default: '', maxlength: 160 }, summary: { type: String, default: '', maxlength: 400 }, bodyMarkdown: { type: String, default: '', maxlength: 40000 },
  coverageStart: Date, coverageEnd: Date, coveredIds: { type: [String], default: [] },
  publishedUrl: { type: String, default: null }, idempotencyKey: { type: String, required: true },
  leaseUntil: Date, leaseToken: String,
  /** Absent on existing drafts: they retain the legacy transport for their full lifetime. */
  transport: { type: new Schema({ kind: { type: String, enum: ['legacy', 'connector'], required: true }, connectionId: String, revision: Number, origin: String }, { _id: false }), default: undefined },
  sources: { type: [{ _id: false, id: String, title: String, url: String, description: String }], default: [] },
  logs: { type: [{ _id: false, stage: String, message: String, at: Date }], default: [] },
  warnings: { type: [String], default: [] },
}, { timestamps: true, autoIndex: true });
schema.index({ organizationId: 1, companyId: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'one_active_company_roundup' });
schema.index({ organizationId: 1, companyId: 1, createdAt: -1 });
type Row = InferSchemaType<typeof schema>;
type Settings = InferSchemaType<typeof settingsSchema>;
export const ReleaseRoundup: Model<Row> = (mongoose.models.ReleaseRoundup as Model<Row>) || mongoose.model('ReleaseRoundup', schema);
export const ReleaseRoundupSettings: Model<Settings> = (mongoose.models.ReleaseRoundupSettings as Model<Settings>) || mongoose.model('ReleaseRoundupSettings', settingsSchema);
