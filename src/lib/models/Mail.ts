import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * One connected mailbox (Gmail). The refresh token is sealed (AES-GCM, purpose-scoped) and never returned by
 * any API. `companyId` is optional: platform mailboxes belong to no company, client mailboxes to one.
 */
const accountSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    provider: { type: String, enum: ['gmail'] as const, required: true, default: 'gmail' },
    emailAddress: { type: String, required: true, lowercase: true, maxlength: 320 },
    /** What people call it: "Playbound support", "Acme — owner". */
    label: { type: String, maxlength: 80, default: '' },
    color: { type: String, maxlength: 16, default: '' },
    companyId: { type: Schema.Types.ObjectId },
    refreshTokenSealed: { type: String, required: true, maxlength: 4000 },
    scopes: { type: [String], default: [] },
    /** Gmail's history cursor: changes since this point are fetched next time. */
    historyId: { type: String, maxlength: 40 },
    lastSyncAt: { type: Date },
    lastSyncOk: { type: Boolean },
    lastSyncError: { type: String, maxlength: 300 },
    /** The grant was revoked or expired: the person must connect again. */
    needsReauth: { type: Boolean, default: false },
    createdByUserId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true }
);
accountSchema.index({ organizationId: 1, emailAddress: 1 }, { unique: true });

const addressSchema = new Schema({ name: { type: String, maxlength: 200, default: '' }, email: { type: String, maxlength: 320, default: '' } }, { _id: false });
const attachmentSchema = new Schema(
  { filename: { type: String, maxlength: 300 }, mimeType: { type: String, maxlength: 120 }, size: { type: Number, default: 0 }, attachmentId: { type: String, maxlength: 500 }, inline: { type: Boolean, default: false } },
  { _id: false }
);

/** A synced message. Body text is capped; HTML is sanitized and has remote images removed before it is stored. */
const messageSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    accountId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    gmailId: { type: String, required: true, maxlength: 40 },
    threadId: { type: String, required: true, maxlength: 40 },
    internalDate: { type: Date, required: true },
    from: { type: addressSchema, default: () => ({}) },
    to: { type: [addressSchema], default: [] },
    cc: { type: [addressSchema], default: [] },
    replyTo: { type: String, maxlength: 320 },
    subject: { type: String, maxlength: 500, default: '' },
    snippet: { type: String, maxlength: 400, default: '' },
    bodyText: { type: String, maxlength: 120_000, default: '' },
    bodyHtml: { type: String, maxlength: 400_000, default: '' },
    /** The Message-ID header, for threading replies. */
    messageIdHeader: { type: String, maxlength: 500 },
    referencesHeader: { type: String, maxlength: 2000 },
    labels: { type: [String], default: [] },
    unread: { type: Boolean, default: false },
    starred: { type: Boolean, default: false },
    inInbox: { type: Boolean, default: false },
    sent: { type: Boolean, default: false },
    trashed: { type: Boolean, default: false },
    attachments: { type: [attachmentSchema], default: [] },
    /** AI summary of the message, cached after the first request. */
    aiSummary: { type: String, maxlength: 1500 },
  },
  { timestamps: true }
);
messageSchema.index({ organizationId: 1, accountId: 1, gmailId: 1 }, { unique: true });
messageSchema.index({ organizationId: 1, inInbox: 1, internalDate: -1 });
messageSchema.index({ organizationId: 1, accountId: 1, threadId: 1, internalDate: 1 });
messageSchema.index({ subject: 'text', snippet: 'text', bodyText: 'text', 'from.email': 'text', 'from.name': 'text' }, { name: 'mail_text' });

function modelFor<T>(name: string, definition: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, definition);
}

export type MailAccountDoc = InferSchemaType<typeof accountSchema>;
export type MailMessageDoc = InferSchemaType<typeof messageSchema>;
export const MailAccount = modelFor<MailAccountDoc>('MailAccount', accountSchema);
export const MailMessage = modelFor<MailMessageDoc>('MailMessage', messageSchema);
