import 'server-only';
import { Types, type PipelineStage } from 'mongoose';
import { MailAccount, MailMessage, MailRule } from '@/lib/models/Mail';
import { MAIN_BUCKETS, type Bucket } from './triage';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { apiForAccount, canUseMail, MAIL_FORBIDDEN } from './accounts';
import { buildRawMessage, replySubject } from './gmailMime';
import { parseAddressList, parseGmailMessage, type MailAddress } from './gmailParse';
import { mailStoreFor } from './accounts';

export type MailView = 'inbox' | 'unread' | 'starred' | 'sent' | 'all' | 'updates' | 'promotions' | 'suspicious';
export interface ThreadQuery {
  view?: MailView;
  accountId?: string;
  /** Mailboxes filed under this company. */
  companyAccountIds?: string[];
  /** Resolved to that company's mailboxes. */
  companyId?: string;
  q?: string;
  before?: string;
  limit?: number;
}

/** The match for a list of conversations. Pure, so the rules are testable without a database. */
export function threadFilter(organizationId: Types.ObjectId, query: ThreadQuery): Record<string, unknown> {
  const match: Record<string, unknown> = { organizationId, trashed: false };
  switch (query.view ?? 'inbox') {
    // The main box is what is left after triage: important and normal mail only.
    case 'inbox': match.inInbox = true; match['triage.bucket'] = { $in: MAIN_BUCKETS }; break;
    case 'unread': match.inInbox = true; match.unread = true; match['triage.bucket'] = { $in: MAIN_BUCKETS }; break;
    case 'updates': case 'promotions': case 'suspicious': match.inInbox = true; match['triage.bucket'] = query.view; break;
    case 'starred': match.starred = true; break;
    case 'sent': match.sent = true; break;
    case 'all': break;
  }
  if (query.accountId && Types.ObjectId.isValid(query.accountId)) match.accountId = new Types.ObjectId(query.accountId);
  else if (query.companyAccountIds) match.accountId = { $in: query.companyAccountIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)) };
  const q = query.q?.trim();
  if (q) match.$text = { $search: q.slice(0, 200) };
  const before = query.before ? new Date(query.before) : null;
  if (before && !Number.isNaN(before.getTime())) match.internalDate = { $lt: before };
  return match;
}

export function threadPipeline(match: Record<string, unknown>, limit: number): PipelineStage[] {
  return [
    { $match: match },
    { $sort: { internalDate: -1 } },
    {
      $group: {
        _id: { a: '$accountId', t: '$threadId' },
        latest: { $first: '$$ROOT' },
        count: { $sum: 1 },
        unreadCount: { $sum: { $cond: ['$unread', 1, 0] } },
        attachmentCount: { $sum: { $size: { $ifNull: ['$attachments', []] } } },
        starred: { $max: '$starred' },
      },
    },
    { $sort: { 'latest.internalDate': -1 } },
    { $limit: Math.min(Math.max(limit, 1), 100) },
  ];
}

export interface ThreadSummary {
  id: string;
  accountId: string;
  threadId: string;
  subject: string;
  snippet: string;
  from: MailAddress;
  date: string;
  unread: boolean;
  starred: boolean;
  count: number;
  hasAttachments: boolean;
  aiSummary: string | null;
  triage: { bucket: Bucket; reasons: string[]; risk: number } | null;
}

export async function listThreads(viewer: CompanyViewer, query: ThreadQuery): Promise<ThreadSummary[] | null> {
  if (!canUseMail(viewer)) return null;
  if (query.companyId && Types.ObjectId.isValid(query.companyId) && !query.accountId) {
    const accounts = await MailAccount.find({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(query.companyId) }).select('_id').lean<{ _id: Types.ObjectId }[]>();
    query = { ...query, companyAccountIds: accounts.map((a) => String(a._id)) };
  }
  const rows = await MailMessage.aggregate<{ latest: Record<string, any>; count: number; unreadCount: number; attachmentCount: number; starred: boolean }>(
    threadPipeline(threadFilter(viewer.organizationId, query), query.limit ?? 50)
  );
  return rows.map((r) => ({
    id: String(r.latest._id),
    accountId: String(r.latest.accountId),
    threadId: r.latest.threadId,
    subject: r.latest.subject || '(no subject)',
    snippet: r.latest.snippet ?? '',
    from: { name: r.latest.from?.name ?? '', email: r.latest.from?.email ?? '' },
    date: new Date(r.latest.internalDate).toISOString(),
    unread: r.unreadCount > 0,
    starred: Boolean(r.starred),
    count: r.count,
    hasAttachments: r.attachmentCount > 0,
    aiSummary: r.latest.aiSummary ?? null,
    triage: r.latest.triage ? { bucket: r.latest.triage.bucket, reasons: r.latest.triage.reasons ?? [], risk: r.latest.triage.risk ?? 0 } : null,
  }));
}

export interface ThreadMessage {
  id: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  date: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  unread: boolean;
  sent: boolean;
  attachments: { filename: string; mimeType: string; size: number; attachmentId: string; inline: boolean }[];
  aiSummary: string | null;
  triage: { bucket: Bucket; reasons: string[]; risk: number } | null;
}

export async function getThread(viewer: CompanyViewer, accountId: string, threadId: string): Promise<ThreadMessage[] | null> {
  if (!canUseMail(viewer) || !Types.ObjectId.isValid(accountId)) return null;
  const rows = await MailMessage.find({ organizationId: viewer.organizationId, accountId: new Types.ObjectId(accountId), threadId, trashed: false }).sort({ internalDate: 1 }).limit(60).lean();
  return rows.map((m) => ({
    id: String(m._id),
    from: { name: m.from?.name ?? '', email: m.from?.email ?? '' },
    to: (m.to ?? []).map((a) => ({ name: a.name ?? '', email: a.email ?? '' })),
    cc: (m.cc ?? []).map((a) => ({ name: a.name ?? '', email: a.email ?? '' })),
    date: new Date(m.internalDate).toISOString(),
    subject: m.subject ?? '',
    bodyText: m.bodyText ?? '',
    bodyHtml: m.bodyHtml ?? '',
    unread: Boolean(m.unread),
    sent: Boolean(m.sent),
    attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename ?? 'file', mimeType: a.mimeType ?? '', size: a.size ?? 0, attachmentId: a.attachmentId ?? '', inline: Boolean(a.inline) })),
    aiSummary: m.aiSummary ?? null,
    triage: m.triage ? { bucket: m.triage.bucket as Bucket, reasons: m.triage.reasons ?? [], risk: m.triage.risk ?? 0 } : null,
  }));
}

export type ThreadAction = 'read' | 'unread' | 'archive' | 'star' | 'unstar' | 'trash';

/** What an action means in Gmail (labels) and in the local copy. `latestOnly` actions touch only the newest message. */
export function actionPlan(action: ThreadAction): { add: string[]; remove: string[]; local: Record<string, unknown>; latestOnly: boolean; trash: boolean } {
  switch (action) {
    case 'read': return { add: [], remove: ['UNREAD'], local: { unread: false }, latestOnly: false, trash: false };
    case 'unread': return { add: ['UNREAD'], remove: [], local: { unread: true }, latestOnly: true, trash: false };
    case 'archive': return { add: [], remove: ['INBOX'], local: { inInbox: false }, latestOnly: false, trash: false };
    case 'star': return { add: ['STARRED'], remove: [], local: { starred: true }, latestOnly: true, trash: false };
    case 'unstar': return { add: [], remove: ['STARRED'], local: { starred: false }, latestOnly: false, trash: false };
    case 'trash': return { add: [], remove: [], local: { trashed: true, inInbox: false }, latestOnly: false, trash: true };
  }
}

export type MailActionResult = { ok: true } | { ok: false; status: 400 | 403 | 404 | 502; error: string };

/** Apply an action to a whole conversation: Gmail first (so the two never disagree), then the local copy. */
export async function applyThreadAction(viewer: CompanyViewer, input: { accountId: string; threadId: string; action: ThreadAction }, fetchImpl: typeof fetch = fetch): Promise<MailActionResult> {
  if (!canUseMail(viewer)) return { ok: false, status: 403, error: MAIL_FORBIDDEN };
  if (!Types.ObjectId.isValid(input.accountId)) return { ok: false, status: 404, error: 'Mailbox not found.' };
  const plan = actionPlan(input.action);
  const account = await MailAccount.findOne({ _id: new Types.ObjectId(input.accountId), organizationId: viewer.organizationId }).lean();
  if (!account) return { ok: false, status: 404, error: 'Mailbox not found.' };
  let messages = await MailMessage.find({ organizationId: viewer.organizationId, accountId: account._id, threadId: input.threadId }).sort({ internalDate: 1 }).select('_id gmailId unread starred inInbox').lean();
  if (!messages.length) return { ok: false, status: 404, error: 'Conversation not found.' };
  if (plan.latestOnly) messages = messages.slice(-1);
  // Only touch what would change.
  const needs = (m: (typeof messages)[number]) => {
    if (plan.trash) return true;
    if (plan.remove.includes('UNREAD')) return m.unread;
    if (plan.remove.includes('INBOX')) return m.inInbox;
    if (plan.remove.includes('STARRED')) return m.starred;
    if (plan.add.includes('UNREAD')) return !m.unread;
    if (plan.add.includes('STARRED')) return !m.starred;
    return true;
  };
  const targets = messages.filter(needs);
  try {
    const api = await apiForAccount(account, fetchImpl);
    for (const m of targets) {
      if (plan.trash) await api.trash(m.gmailId);
      else await api.modify(m.gmailId, { add: plan.add, remove: plan.remove });
    }
  } catch (error) {
    return { ok: false, status: 502, error: `Gmail did not apply that (${error instanceof Error ? error.message.slice(0, 120) : 'error'}). Nothing was changed here.` };
  }
  if (targets.length) await MailMessage.updateMany({ _id: { $in: targets.map((m) => m._id) } }, { $set: plan.local });
  return { ok: true };
}

/** How many unread conversations sit in each place, for the sidebar. */
export async function mailCounts(viewer: CompanyViewer): Promise<Record<'inbox' | 'updates' | 'promotions' | 'suspicious', number> | null> {
  if (!canUseMail(viewer)) return null;
  const rows = await MailMessage.aggregate<{ _id: string; n: number }>([
    { $match: { organizationId: viewer.organizationId, inInbox: true, unread: true, trashed: false } },
    { $group: { _id: { bucket: '$triage.bucket', a: '$accountId', t: '$threadId' } } },
    { $group: { _id: '$_id.bucket', n: { $sum: 1 } } },
  ]);
  const by = new Map(rows.map((r) => [r._id, r.n]));
  return { inbox: MAIN_BUCKETS.reduce((n, b) => n + (by.get(b) ?? 0), 0), updates: by.get('updates') ?? 0, promotions: by.get('promotions') ?? 0, suspicious: by.get('suspicious') ?? 0 };
}

const domainOfEmail = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';

/**
 * Teach the filter. "spam": Gmail files the conversation as spam (so it stops arriving everywhere) and the sender,
 * or their whole domain, is blocked here. "not_spam": the conversation and everything else from that sender
 * moves to the main box and the sender is allowed from now on.
 */
export async function teachFilter(
  viewer: CompanyViewer,
  input: { accountId: string; threadId: string; verdict: 'spam' | 'not_spam'; scope?: 'sender' | 'domain' },
  fetchImpl: typeof fetch = fetch
): Promise<MailActionResult> {
  if (!canUseMail(viewer)) return { ok: false, status: 403, error: MAIL_FORBIDDEN };
  if (!Types.ObjectId.isValid(input.accountId)) return { ok: false, status: 404, error: 'Mailbox not found.' };
  const account = await MailAccount.findOne({ _id: new Types.ObjectId(input.accountId), organizationId: viewer.organizationId }).lean();
  if (!account) return { ok: false, status: 404, error: 'Mailbox not found.' };
  const messages = await MailMessage.find({ organizationId: viewer.organizationId, accountId: account._id, threadId: input.threadId }).select('_id gmailId from sent').lean();
  if (!messages.length) return { ok: false, status: 404, error: 'Conversation not found.' };
  const sender = messages.find((m) => !m.sent)?.from?.email?.toLowerCase();
  if (!sender || account.emailAddress === sender) return { ok: false, status: 400, error: 'There is no sender to teach the filter about.' };
  const scope = input.scope ?? 'sender';
  const rule = { organizationId: viewer.organizationId, type: scope, value: scope === 'domain' ? domainOfEmail(sender) : sender } as const;
  const kind = input.verdict === 'spam' ? 'block' : 'allow';

  if (input.verdict === 'spam') {
    try {
      const api = await apiForAccount(account, fetchImpl);
      for (const m of messages) if (!m.sent) await api.modify(m.gmailId, { add: ['SPAM'], remove: ['INBOX'] });
    } catch (error) {
      return { ok: false, status: 502, error: `Gmail did not file it as spam (${error instanceof Error ? error.message.slice(0, 120) : 'error'}). Nothing was changed here.` };
    }
    await MailMessage.deleteMany({ _id: { $in: messages.filter((m) => !m.sent).map((m) => m._id) } });
  } else {
    // Everything already here from this sender (or domain) that triage filed away comes back.
    const from = scope === 'domain' ? { 'from.email': { $regex: `@${rule.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } } : { 'from.email': sender };
    await MailMessage.updateMany({ organizationId: viewer.organizationId, ...from, 'triage.bucket': { $nin: MAIN_BUCKETS } }, { $set: { 'triage.bucket': 'normal', 'triage.by': 'user', 'triage.uncertain': false, 'triage.reasons': [`You allowed ${rule.value}.`] } });
  }
  await MailRule.updateOne({ organizationId: viewer.organizationId, type: rule.type, value: rule.value }, { $set: { kind, createdByUserId: new Types.ObjectId(viewer.userId) } }, { upsert: true });
  return { ok: true };
}

/** Move a conversation to another place by hand ("this is not a newsletter"); it stays there. */
export async function moveThread(viewer: CompanyViewer, input: { accountId: string; threadId: string; bucket: Bucket }): Promise<MailActionResult> {
  if (!canUseMail(viewer)) return { ok: false, status: 403, error: MAIL_FORBIDDEN };
  if (!Types.ObjectId.isValid(input.accountId)) return { ok: false, status: 404, error: 'Mailbox not found.' };
  const moved = await MailMessage.updateMany(
    { organizationId: viewer.organizationId, accountId: new Types.ObjectId(input.accountId), threadId: input.threadId },
    { $set: { 'triage.bucket': input.bucket, 'triage.by': 'user', 'triage.uncertain': false, 'triage.reasons': ['You moved it.'] } }
  );
  return moved.matchedCount ? { ok: true } : { ok: false, status: 404, error: 'Conversation not found.' };
}

export interface SendInput {
  accountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  /** The message being answered (its id in Nucleas): threads the reply and fills the subject. */
  replyToMessageId?: string;
}

export type SendResult = { ok: true; threadId: string } | { ok: false; status: 400 | 403 | 404 | 502; error: string };

export async function sendMail(viewer: CompanyViewer, input: SendInput, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  if (!canUseMail(viewer)) return { ok: false, status: 403, error: MAIL_FORBIDDEN };
  if (!Types.ObjectId.isValid(input.accountId)) return { ok: false, status: 404, error: 'Mailbox not found.' };
  const account = await MailAccount.findOne({ _id: new Types.ObjectId(input.accountId), organizationId: viewer.organizationId }).lean();
  if (!account) return { ok: false, status: 404, error: 'Mailbox not found.' };
  if (account.needsReauth) return { ok: false, status: 400, error: 'This mailbox needs to be connected again before it can send.' };
  const to = parseAddressList(input.to);
  if (!to.length) return { ok: false, status: 400, error: 'Add a recipient (an email address).' };
  if (!input.text.trim()) return { ok: false, status: 400, error: 'Write a message first.' };
  let replyTo: { messageIdHeader?: string | null; referencesHeader?: string | null; threadId: string; subject?: string } | null = null;
  if (input.replyToMessageId && Types.ObjectId.isValid(input.replyToMessageId)) {
    replyTo = await MailMessage.findOne({ _id: new Types.ObjectId(input.replyToMessageId), organizationId: viewer.organizationId, accountId: account._id }).select('messageIdHeader referencesHeader threadId subject').lean();
  }
  let raw: string;
  try {
    raw = buildRawMessage({
      from: { name: account.label || undefined, email: account.emailAddress },
      to,
      cc: parseAddressList(input.cc),
      bcc: parseAddressList(input.bcc),
      subject: replyTo ? replySubject(input.subject || replyTo.subject || '') : input.subject || '(no subject)',
      text: input.text,
      ...(replyTo?.messageIdHeader ? { inReplyTo: replyTo.messageIdHeader } : {}),
      ...(replyTo?.referencesHeader ? { references: replyTo.referencesHeader } : {}),
    });
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error ? error.message : 'That message could not be built.' };
  }
  try {
    const api = await apiForAccount(account, fetchImpl);
    const sent = await api.send(raw, replyTo?.threadId);
    // Show it right away instead of waiting for the next sync.
    const stored = parseGmailMessage(await api.getMessage(sent.id));
    await mailStoreFor(account.organizationId, account._id).upsert(stored);
    return { ok: true, threadId: sent.threadId };
  } catch (error) {
    return { ok: false, status: 502, error: `Gmail did not send it (${error instanceof Error ? error.message.slice(0, 120) : 'error'}). Nothing was sent.` };
  }
}

export async function fetchAttachment(viewer: CompanyViewer, messageId: string, attachmentId: string, fetchImpl: typeof fetch = fetch): Promise<{ data: Buffer; filename: string; mimeType: string } | null> {
  if (!canUseMail(viewer) || !Types.ObjectId.isValid(messageId)) return null;
  const message = await MailMessage.findOne({ _id: new Types.ObjectId(messageId), organizationId: viewer.organizationId }).select('gmailId accountId attachments').lean();
  const meta = message?.attachments?.find((a) => a.attachmentId === attachmentId);
  if (!message || !meta) return null;
  const account = await MailAccount.findOne({ _id: message.accountId, organizationId: viewer.organizationId }).lean();
  if (!account) return null;
  const api = await apiForAccount(account, fetchImpl);
  return { data: await api.attachment(message.gmailId, attachmentId), filename: meta.filename ?? 'attachment', mimeType: meta.mimeType || 'application/octet-stream' };
}
