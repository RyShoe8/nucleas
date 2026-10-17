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
    /** Legacy, kept in step with rank (discount → deal) for older readers. See lib/watches/settings. */
    mode: { type: String, enum: ['match', 'deal'], default: 'match' },
    /** The sentence the watch was designed from ("Watch my inbox for AI industry news"). */
    brief: { type: String, trim: true, maxlength: 500, default: '' },
    /** Which emails count, in plain words. */
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    /** What one collected item is called ("deal", "story", "release"), for job and post wording. */
    noun: { type: String, trim: true, maxlength: 30 },
    /** The facts pulled out of each flagged email. */
    fields: { type: [{ key: String, label: String, kind: String, _id: false }], default: [] },
    /** fit | discount | newest. Missing on watches saved before rankings: derived from mode. */
    rank: { type: String, enum: ['fit', 'discount', 'newest'] },
    /** Discount ranking: the smallest saving or bonus (percent) worth flagging. Not capped at 100. */
    minDiscountPct: { type: Number, min: 0, max: 1000 },
    keywords: { type: [String], default: [] },
    senderAddresses: { type: [String], default: [] },
    senderDomains: { type: [String], default: [] },
    labels: { type: [String], default: [] },
    lookbackHours: { type: Number, default: 168, min: 6, max: 720 },
    /** 0-100: how closely an email must fit the description. (Before rankings, a deal watch's deal strength minimum.) */
    threshold: { type: Number, default: 60, min: 0, max: 100 },
    dealUnitTokens: { type: [String], default: [] },
    aiSummary: { type: Boolean, default: true },
    /** Draft social posts (in the company's Voice) for newly flagged emails. Needs a company. */
    autoPosts: { type: Boolean, default: false },
    /** A newsletter or roundup written in the company's Voice from what was flagged each period. */
    digest: {
      enabled: { type: Boolean, default: false },
      cadence: { type: String, enum: ['daily', 'weekly'], default: 'weekly' },
      maxItems: { type: Number, default: 10, min: 3, max: 25 },
      lastRunAt: { type: Date },
      lastArticleId: { type: Schema.Types.ObjectId },
      lastError: { type: String, maxlength: 300 },
    },
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
    /** The watch's ranking measure: fit (0-100) or, for discount watches, the saving or bonus percent (uncapped). */
    score: { type: Number, default: 0, min: 0 },
    /** 0-100 fit to the description; absent when nothing measured it. */
    fit: { type: Number, min: 0, max: 100 },
    scoreBasis: { type: String, enum: ['ai', 'keywords', 'deal', 'none'], default: 'none' },
    reason: { type: String, maxlength: 300 },
    flagged: { type: Boolean, default: false },
    summary: { type: String, maxlength: 1500 },
    keyPoints: { type: [{ category: String, text: String, _id: false }], default: [] },
    deals: { type: [Schema.Types.Mixed], default: [] },
    bestDeal: { type: Schema.Types.Mixed },
    /** The watch's fields for this email: { field key: value }. */
    values: { type: Schema.Types.Mixed },
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
