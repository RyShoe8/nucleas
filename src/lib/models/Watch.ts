import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * Content Watches: a read-only mailbox, a rule describing what to look for, and the emails scanned against it.
 * Everything is scoped to an organization; a watch may optionally belong to one company (its Voice writes the
 * social posts), but nothing requires it.
 */

const mailboxSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    emailAddress: { type: String, required: true, trim: true, lowercase: true },
    /** secretBox ciphertext of the Google refresh token (read-only Gmail scope). Never returned to a browser. */
    refreshTokenSealed: { type: String, required: true, select: false },
    status: { type: String, enum: ['connected', 'needs_reauth'], default: 'connected' },
    lastError: { type: String, maxlength: 400 },
    connectedByUserId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true }
);
mailboxSchema.index({ organizationId: 1, emailAddress: 1 }, { unique: true });
export type WatchMailboxDoc = InferSchemaType<typeof mailboxSchema>;
export const WatchMailbox: Model<WatchMailboxDoc> = (mongoose.models.WatchMailbox as Model<WatchMailboxDoc> | undefined) ?? mongoose.model<WatchMailboxDoc>('WatchMailbox', mailboxSchema);

const watchSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    createdByUserId: { type: Schema.Types.ObjectId, required: true },
    mailboxId: { type: Schema.Types.ObjectId, ref: 'WatchMailbox', required: true },
    /** Optional: the company whose Voice writes this watch's social posts. */
    companyId: { type: Schema.Types.ObjectId, ref: 'Client' },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** match: score each email against the plain-words description. deal: score by deal strength. */
    mode: { type: String, enum: ['match', 'deal'], default: 'match' },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    keywords: { type: [String], default: [] },
    senderAddresses: { type: [String], default: [] },
    senderDomains: { type: [String], default: [] },
    labels: { type: [String], default: [] },
    lookbackHours: { type: Number, default: 168, min: 6, max: 720 },
    /** 0-100. An email is flagged when its score reaches this. In deal mode the score is the deal strength percent. */
    threshold: { type: Number, default: 60, min: 0, max: 100 },
    dealUnitTokens: { type: [String], default: [] },
    aiSummary: { type: Boolean, default: true },
    /** Draft social posts (in the company's Voice) for newly flagged emails. Needs a company. */
    autoPosts: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    intervalMinutes: { type: Number, default: 60, min: 15, max: 1440 },
    lastScanAt: { type: Date },
    lastScanOk: { type: Boolean },
    lastScanError: { type: String, maxlength: 400 },
    lastScanStats: { type: Schema.Types.Mixed },
    scanLeaseUntil: { type: Date },
  },
  { timestamps: true }
);
watchSchema.index({ organizationId: 1, createdAt: -1 });
watchSchema.index({ active: 1, lastScanAt: 1 });
export type ContentWatchDoc = InferSchemaType<typeof watchSchema>;
export const ContentWatch: Model<ContentWatchDoc> = (mongoose.models.ContentWatch as Model<ContentWatchDoc> | undefined) ?? mongoose.model<ContentWatchDoc>('ContentWatch', watchSchema);

const itemSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    watchId: { type: Schema.Types.ObjectId, ref: 'ContentWatch', required: true },
    mailboxId: { type: Schema.Types.ObjectId, required: true },
    gmailId: { type: String, required: true },
    threadId: { type: String },
    fromName: { type: String, maxlength: 200 },
    fromEmail: { type: String, maxlength: 320 },
    subject: { type: String, maxlength: 500, default: '' },
    sentAt: { type: Date },
    /** The cleaned email text the scan used (capped). */
    text: { type: String, maxlength: 20000, default: '' },
    /** Why the email was passed over without scoring (too short, wrong sender, no keyword). */
    skipReason: { type: String, maxlength: 80 },
    detectedKeywords: { type: [String], default: [] },
    /** 1-10 heuristic from keyword density, recency and promo wording (Content Intelligence's relevance). */
    relevance: { type: Number, default: 1 },
    score: { type: Number, default: 0, min: 0, max: 100 },
    scoreBasis: { type: String, enum: ['ai', 'keywords', 'deal', 'none'], default: 'none' },
    reason: { type: String, maxlength: 300 },
    flagged: { type: Boolean, default: false },
    summary: { type: String, maxlength: 1500 },
    keyPoints: { type: [{ category: String, text: String, _id: false }], default: [] },
    deals: { type: [Schema.Types.Mixed], default: [] },
    bestDeal: { type: Schema.Types.Mixed },
    link: { type: String, maxlength: 2000 },
    /** Sanitized HTML for display only. */
    htmlPreview: { type: String, maxlength: 80000 },
  },
  { timestamps: true }
);
itemSchema.index({ watchId: 1, gmailId: 1 }, { unique: true });
itemSchema.index({ watchId: 1, flagged: 1, sentAt: -1 });
itemSchema.index({ organizationId: 1, sentAt: -1 });
export type WatchItemDoc = InferSchemaType<typeof itemSchema>;
export const WatchItem: Model<WatchItemDoc> = (mongoose.models.WatchItem as Model<WatchItemDoc> | undefined) ?? mongoose.model<WatchItemDoc>('WatchItem', itemSchema);

const postSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    watchId: { type: Schema.Types.ObjectId, required: true },
    itemId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId },
    /** Stable key for the deal tier within the email, or "content-only". */
    dealKey: { type: String, required: true },
    source: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    status: { type: String, enum: ['draft', 'archived'], default: 'draft' },
    title: { type: String, maxlength: 300 },
    copyByPlatform: { type: Schema.Types.Mixed, default: {} },
    link: { type: String, maxlength: 2000 },
    dealSummary: { type: String, maxlength: 300 },
    createdByUserId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true }
);
postSchema.index({ itemId: 1, dealKey: 1 }, { unique: true });
postSchema.index({ watchId: 1, status: 1, createdAt: -1 });
export type WatchPostDoc = InferSchemaType<typeof postSchema>;
export const WatchPost: Model<WatchPostDoc> = (mongoose.models.WatchPost as Model<WatchPostDoc> | undefined) ?? mongoose.model<WatchPostDoc>('WatchPost', postSchema);
