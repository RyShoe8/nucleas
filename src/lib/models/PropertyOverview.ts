import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const overviewSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, required: true, index: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
    runId: { type: Schema.Types.ObjectId, ref: 'JobRun' },
    rootUrl: { type: String, required: true },
    status: { type: String, enum: ['queued', 'crawling', 'complete', 'failed'], default: 'queued' },
    startedAt: Date,
    completedAt: Date,
    error: { type: String, maxlength: 1500 },
    progress: { type: String, maxlength: 300 },
    pageCount: { type: Number, default: 0 },
    edgeCount: { type: Number, default: 0 },
    issueCount: { type: Number, default: 0 },
    clusters: { type: Schema.Types.Mixed, default: [] },
    summary: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
overviewSchema.index({ organizationId: 1, companyId: 1, createdAt: -1 });

const pageSchema = new Schema(
  {
    overviewId: { type: Schema.Types.ObjectId, required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, required: true },
    url: { type: String, required: true },
    routePattern: { type: String, required: true },
    statusCode: Number,
    contentType: String,
    title: String,
    description: String,
    canonical: String,
    robots: String,
    language: String,
    h1: { type: [String], default: [] },
    h2: { type: [String], default: [] },
    h3: { type: [String], default: [] },
    metaKeywords: { type: [String], default: [] },
    wordCount: { type: Number, default: 0 },
    internalLinks: { type: [String], default: [] },
    externalLinks: { type: [String], default: [] },
    incomingLinks: { type: Number, default: 0 },
    imageCount: { type: Number, default: 0 },
    imagesMissingAlt: { type: Number, default: 0 },
    structuredDataTypes: { type: [String], default: [] },
    datePublished: Date,
    dateModified: Date,
    indexable: { type: Boolean, default: true },
    templateKey: String,
    issues: { type: [String], default: [] },
    fetchedAt: { type: Date, required: true },
    renderMode: { type: String, enum: ['html', 'rendered'], default: 'html' },
    renderedText: { type: String, maxlength: 50_000 },
    /** Compressed storage can be added later; this bounded snapshot makes every crawled page auditable now. */
    htmlSnapshot: { type: String, maxlength: 750_000 },
  },
  { timestamps: true }
);
pageSchema.index({ overviewId: 1, url: 1 }, { unique: true });

export type PropertyOverviewDoc = InferSchemaType<typeof overviewSchema>;
export type PropertyPageDoc = InferSchemaType<typeof pageSchema>;
export const PropertyOverview: Model<PropertyOverviewDoc> =
  (mongoose.models.PropertyOverview as Model<PropertyOverviewDoc> | undefined) ?? mongoose.model<PropertyOverviewDoc>('PropertyOverview', overviewSchema);
export const PropertyPage: Model<PropertyPageDoc> =
  (mongoose.models.PropertyPage as Model<PropertyPageDoc> | undefined) ?? mongoose.model<PropertyPageDoc>('PropertyPage', pageSchema);
