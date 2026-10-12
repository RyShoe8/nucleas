import 'server-only';
import { Types } from 'mongoose';
import { z } from 'zod';
import { ContentWatch, WatchItem, WatchMailbox, WatchPost } from '@/lib/models/Watch';
import { getCompanyProfile, listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import { canUseWatches, WATCHES_FORBIDDEN } from './access';

/** Creating, changing, listing and reading watches. Everything is limited to the viewer's organization. */

const list = (max: number, itemMax: number) => z.array(z.string().trim().min(1).max(itemMax)).max(max).default([]);

export const watchInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    mailboxId: z.string().refine((v) => Types.ObjectId.isValid(v), 'Choose a mailbox.'),
    companyId: z.string().refine((v) => Types.ObjectId.isValid(v)).nullable().optional(),
    mode: z.enum(['match', 'deal']).default('match'),
    description: z.string().trim().max(1000).default(''),
    keywords: list(20, 60),
    senderAddresses: list(20, 200),
    senderDomains: list(20, 120),
    labels: list(10, 80),
    lookbackHours: z.number().int().min(6).max(720).default(168),
    threshold: z.number().int().min(0).max(100).default(60),
    dealUnitTokens: list(32, 12),
    aiSummary: z.boolean().default(true),
    autoPosts: z.boolean().default(false),
    active: z.boolean().default(true),
    intervalMinutes: z.number().int().min(15).max(1440).default(60),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'match' && !value.description && !value.keywords.length) {
      ctx.addIssue({ code: 'custom', path: ['description'], message: 'Describe what to look for, or add at least one keyword.' });
    }
  });

export type WatchInput = z.infer<typeof watchInputSchema>;

export interface WatchView {
  id: string;
  name: string;
  mailboxId: string;
  mailboxEmail: string;
  companyId: string | null;
  companyName: string | null;
  mode: 'match' | 'deal';
  description: string;
  keywords: string[];
  senderAddresses: string[];
  senderDomains: string[];
  labels: string[];
  lookbackHours: number;
  threshold: number;
  dealUnitTokens: string[];
  aiSummary: boolean;
  autoPosts: boolean;
  active: boolean;
  intervalMinutes: number;
  lastScanAt: string | null;
  lastScanOk: boolean | null;
  lastScanError: string | null;
  scanning: boolean;
  flaggedCount: number;
  scannedCount: number;
}

type WatchLean = {
  _id: Types.ObjectId;
  name: string;
  mailboxId: Types.ObjectId;
  companyId?: Types.ObjectId | null;
  mode?: string;
  description?: string;
  keywords?: string[];
  senderAddresses?: string[];
  senderDomains?: string[];
  labels?: string[];
  lookbackHours?: number;
  threshold?: number;
  dealUnitTokens?: string[];
  aiSummary?: boolean;
  autoPosts?: boolean;
  active?: boolean;
  intervalMinutes?: number;
  lastScanAt?: Date;
  lastScanOk?: boolean;
  lastScanError?: string;
  scanLeaseUntil?: Date;
};

async function toViews(viewer: CompanyViewer, rows: WatchLean[]): Promise<WatchView[]> {
  const mailboxes = await WatchMailbox.find({ organizationId: viewer.organizationId, _id: { $in: rows.map((r) => r.mailboxId) } }).select('emailAddress').lean<{ _id: Types.ObjectId; emailAddress: string }[]>();
  const emails = new Map(mailboxes.map((m) => [String(m._id), m.emailAddress]));
  const companies = new Map((await listCompanyProfiles(viewer)).map((c) => [c.id, c.name]));
  const counts = await WatchItem.aggregate<{ _id: Types.ObjectId; scanned: number; flagged: number }>([
    { $match: { organizationId: viewer.organizationId, watchId: { $in: rows.map((r) => r._id) }, skipReason: { $exists: false } } },
    { $group: { _id: '$watchId', scanned: { $sum: 1 }, flagged: { $sum: { $cond: ['$flagged', 1, 0] } } } },
  ]);
  const byWatch = new Map(counts.map((c) => [String(c._id), c]));
  return rows.map((r) => ({
    id: String(r._id),
    name: r.name,
    mailboxId: String(r.mailboxId),
    mailboxEmail: emails.get(String(r.mailboxId)) ?? 'Removed mailbox',
    companyId: r.companyId ? String(r.companyId) : null,
    companyName: r.companyId ? companies.get(String(r.companyId)) ?? null : null,
    mode: r.mode === 'deal' ? 'deal' : 'match',
    description: r.description ?? '',
    keywords: r.keywords ?? [],
    senderAddresses: r.senderAddresses ?? [],
    senderDomains: r.senderDomains ?? [],
    labels: r.labels ?? [],
    lookbackHours: r.lookbackHours ?? 168,
    threshold: r.threshold ?? 60,
    dealUnitTokens: r.dealUnitTokens ?? [],
    aiSummary: r.aiSummary !== false,
    autoPosts: r.autoPosts === true,
    active: r.active !== false,
    intervalMinutes: r.intervalMinutes ?? 60,
    lastScanAt: r.lastScanAt?.toISOString() ?? null,
    lastScanOk: r.lastScanOk ?? null,
    lastScanError: r.lastScanError ?? null,
    scanning: Boolean(r.scanLeaseUntil && r.scanLeaseUntil.getTime() > Date.now()),
    flaggedCount: byWatch.get(String(r._id))?.flagged ?? 0,
    scannedCount: byWatch.get(String(r._id))?.scanned ?? 0,
  }));
}

export type Result<T> = { ok: true; data: T } | { ok: false; status: 400 | 403 | 404; error: string };
const fail = (status: 400 | 403 | 404, error: string): { ok: false; status: 400 | 403 | 404; error: string } => ({ ok: false, status, error });

export async function listWatches(viewer: CompanyViewer): Promise<WatchView[] | null> {
  if (!canUseWatches(viewer)) return null;
  const rows = await ContentWatch.find({ organizationId: viewer.organizationId }).sort({ createdAt: -1 }).limit(100).lean<WatchLean[]>();
  return toViews(viewer, rows);
}

async function checkReferences(viewer: CompanyViewer, input: { mailboxId?: string; companyId?: string | null }): Promise<string | null> {
  if (input.mailboxId && !(await WatchMailbox.exists({ _id: new Types.ObjectId(input.mailboxId), organizationId: viewer.organizationId }))) return 'That mailbox is not connected.';
  if (input.companyId && !(await getCompanyProfile(viewer, input.companyId))) return 'Company not found.';
  return null;
}

export async function createWatch(viewer: CompanyViewer, raw: unknown): Promise<Result<WatchView>> {
  if (!canUseWatches(viewer)) return fail(403, WATCHES_FORBIDDEN);
  const parsed = watchInputSchema.safeParse(raw);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? 'Check the watch settings.');
  const bad = await checkReferences(viewer, parsed.data);
  if (bad) return fail(404, bad);
  const { companyId, mailboxId, ...fields } = parsed.data;
  const doc = await ContentWatch.create({ ...fields, organizationId: viewer.organizationId, createdByUserId: new Types.ObjectId(viewer.userId), mailboxId: new Types.ObjectId(mailboxId), ...(companyId ? { companyId: new Types.ObjectId(companyId) } : {}) });
  const [view] = await toViews(viewer, [doc.toObject() as unknown as WatchLean]);
  return { ok: true, data: view! };
}

export async function updateWatch(viewer: CompanyViewer, id: string, raw: unknown): Promise<Result<WatchView>> {
  if (!canUseWatches(viewer)) return fail(403, WATCHES_FORBIDDEN);
  if (!Types.ObjectId.isValid(id)) return fail(404, 'Watch not found.');
  const existing = await ContentWatch.findOne({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }).lean<WatchLean>();
  if (!existing) return fail(404, 'Watch not found.');
  // A change is validated as a whole watch: the stored settings overlaid with what was sent.
  const merged = {
    name: existing.name, mailboxId: String(existing.mailboxId), companyId: existing.companyId ? String(existing.companyId) : null, mode: existing.mode, description: existing.description, keywords: existing.keywords,
    senderAddresses: existing.senderAddresses, senderDomains: existing.senderDomains, labels: existing.labels, lookbackHours: existing.lookbackHours, threshold: existing.threshold,
    dealUnitTokens: existing.dealUnitTokens, aiSummary: existing.aiSummary, autoPosts: existing.autoPosts, active: existing.active, intervalMinutes: existing.intervalMinutes,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };
  const parsed = watchInputSchema.safeParse(merged);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? 'Check the watch settings.');
  const bad = await checkReferences(viewer, parsed.data);
  if (bad) return fail(404, bad);
  const { companyId, mailboxId, ...fields } = parsed.data;
  await ContentWatch.updateOne(
    { _id: existing._id },
    { $set: { ...fields, mailboxId: new Types.ObjectId(mailboxId), ...(companyId ? { companyId: new Types.ObjectId(companyId) } : {}) }, ...(companyId ? {} : { $unset: { companyId: '' } }) }
  );
  const fresh = await ContentWatch.findById(existing._id).lean<WatchLean>();
  const [view] = await toViews(viewer, [fresh!]);
  return { ok: true, data: view! };
}

export async function deleteWatch(viewer: CompanyViewer, id: string): Promise<Result<{ id: string }>> {
  if (!canUseWatches(viewer)) return fail(403, WATCHES_FORBIDDEN);
  if (!Types.ObjectId.isValid(id)) return fail(404, 'Watch not found.');
  const watch = await ContentWatch.findOne({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }).select('_id').lean();
  if (!watch) return fail(404, 'Watch not found.');
  await Promise.all([WatchItem.deleteMany({ watchId: watch._id }), WatchPost.deleteMany({ watchId: watch._id })]);
  await ContentWatch.deleteOne({ _id: watch._id });
  return { ok: true, data: { id } };
}

export interface ItemView {
  id: string;
  watchId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  sentAt: string | null;
  score: number;
  scoreBasis: string;
  reason: string;
  flagged: boolean;
  skipReason: string | null;
  summary: string;
  keyPoints: { category: string; text: string }[];
  bestDeal: Record<string, unknown> | null;
  dealCount: number;
  link: string | null;
  relevance: number;
  detectedKeywords: string[];
  hasPost: boolean;
}

type ItemLean = {
  _id: Types.ObjectId; watchId: Types.ObjectId; fromName?: string; fromEmail?: string; subject?: string; sentAt?: Date; score?: number; scoreBasis?: string; reason?: string; flagged?: boolean;
  skipReason?: string; summary?: string; keyPoints?: { category: string; text: string }[]; bestDeal?: Record<string, unknown>; deals?: unknown[]; link?: string; relevance?: number; detectedKeywords?: string[];
};

function itemView(row: ItemLean, hasPost: boolean): ItemView {
  return {
    id: String(row._id),
    watchId: String(row.watchId),
    fromName: row.fromName ?? '',
    fromEmail: row.fromEmail ?? '',
    subject: row.subject ?? '',
    sentAt: row.sentAt?.toISOString() ?? null,
    score: row.score ?? 0,
    scoreBasis: row.scoreBasis ?? 'none',
    reason: row.reason ?? '',
    flagged: Boolean(row.flagged),
    skipReason: row.skipReason ?? null,
    summary: row.summary ?? '',
    keyPoints: row.keyPoints ?? [],
    bestDeal: row.bestDeal ?? null,
    dealCount: row.deals?.length ?? 0,
    link: row.link ?? null,
    relevance: row.relevance ?? 1,
    detectedKeywords: row.detectedKeywords ?? [],
    hasPost,
  };
}

export type ItemFilter = 'flagged' | 'scored' | 'all';

/** Scanned emails for one watch, newest first. The default is only the flagged ones. */
export async function listItems(viewer: CompanyViewer, watchId: string, options: { filter?: ItemFilter; limit?: number; before?: string } = {}): Promise<Result<{ items: ItemView[]; hasMore: boolean }>> {
  if (!canUseWatches(viewer)) return fail(403, WATCHES_FORBIDDEN);
  if (!Types.ObjectId.isValid(watchId)) return fail(404, 'Watch not found.');
  const watch = await ContentWatch.exists({ _id: new Types.ObjectId(watchId), organizationId: viewer.organizationId });
  if (!watch) return fail(404, 'Watch not found.');
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const filter = options.filter ?? 'flagged';
  const before = options.before ? new Date(options.before) : null;
  const rows = await WatchItem.find({
    organizationId: viewer.organizationId,
    watchId: new Types.ObjectId(watchId),
    ...(filter === 'flagged' ? { flagged: true } : filter === 'scored' ? { skipReason: { $exists: false } } : {}),
    ...(before && Number.isFinite(before.getTime()) ? { sentAt: { $lt: before } } : {}),
  })
    .sort({ sentAt: -1 })
    .limit(limit + 1)
    .select('-text -htmlPreview -deals')
    .lean<ItemLean[]>();
  const page = rows.slice(0, limit);
  const withPosts = new Set((await WatchPost.find({ organizationId: viewer.organizationId, itemId: { $in: page.map((r) => r._id) }, status: 'draft' }).select('itemId').lean<{ itemId: Types.ObjectId }[]>()).map((p) => String(p.itemId)));
  return { ok: true, data: { items: page.map((r) => itemView(r, withPosts.has(String(r._id)))), hasMore: rows.length > limit } };
}

/** One email in full: its text and a safe HTML preview, for the detail view. */
export async function getItemDetail(viewer: CompanyViewer, itemId: string): Promise<Result<{ item: ItemView; text: string; html: string; deals: unknown[] }>> {
  if (!canUseWatches(viewer)) return fail(403, WATCHES_FORBIDDEN);
  if (!Types.ObjectId.isValid(itemId)) return fail(404, 'Email not found.');
  const row = await WatchItem.findOne({ _id: new Types.ObjectId(itemId), organizationId: viewer.organizationId }).lean<ItemLean & { text?: string; htmlPreview?: string; deals?: unknown[] }>();
  if (!row) return fail(404, 'Email not found.');
  const hasPost = Boolean(await WatchPost.exists({ organizationId: viewer.organizationId, itemId: row._id, status: 'draft' }));
  return { ok: true, data: { item: itemView(row, hasPost), text: row.text ?? '', html: row.htmlPreview ?? '', deals: row.deals ?? [] } };
}
