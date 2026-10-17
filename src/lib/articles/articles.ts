import 'server-only';
import { Types } from 'mongoose';
import { z } from 'zod';
import { ArticleDraft } from '@/lib/models/ArticleDraft';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { getCompanyProfile, type CompanyViewer } from '@/lib/companies/companyProfile';

/** Anyone who can see a company can write for it; editing a draft is limited to the person who started it or a manager. */
export const articleInputSchema = z.object({
  companyId: z.string().regex(/^[a-f0-9]{24}$/i),
  topic: z.string().trim().min(3).max(300),
  notes: z.string().trim().max(3000).default(''),
  length: z.enum(['short', 'standard', 'long']).default('standard'),
  faq: z.boolean().default(false),
  referenceUrls: z.array(z.string().trim().url().max(2000)).max(5).default([]),
  links: z.array(z.object({ url: z.string().trim().url().max(2000), anchor: z.string().trim().max(200).optional() })).max(8).default([]),
});
export type ArticleInput = z.infer<typeof articleInputSchema>;

export const LENGTH_WORDS = { short: 600, standard: 1000, long: 1800 } as const;

export interface ArticleView {
  id: string;
  companyId: string;
  topic: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  stage: string;
  progress: string;
  error: string | null;
  body: string;
  metaDescription: string;
  fidelity: number | null;
  fidelityMeasured: boolean;
  genericity: number | null;
  warnings: string[];
  sources: string[];
  researchNote: string | null;
  modelPath: string[];
  targetWords: number;
  /** digest: a newsletter a watch wrote from its flagged emails. */
  kind: 'article' | 'digest';
  createdAt: string;
  updatedAt: string;
}

type Row = {
  _id: Types.ObjectId; companyId: Types.ObjectId; topic: string; title?: string; status: ArticleView['status']; stage?: string; progress?: string; error?: string | null; body?: string; metaDescription?: string;
  fidelity?: number; fidelityMeasured?: boolean; genericity?: number; warnings?: string[]; sourcesUsed?: string[]; researchNote?: string; modelPath?: string[]; targetWords?: number; kind?: string; createdAt?: Date; updatedAt?: Date;
};

export function articleView(r: Row): ArticleView {
  return {
    id: String(r._id), companyId: String(r.companyId), topic: r.topic, title: r.title ?? '', status: r.status, stage: r.stage ?? 'research', progress: r.progress ?? '', error: r.error ?? null,
    body: r.body ?? '', metaDescription: r.metaDescription ?? '', fidelity: r.fidelity ?? null, fidelityMeasured: Boolean(r.fidelityMeasured), genericity: r.genericity ?? null,
    warnings: r.warnings ?? [], sources: r.sourcesUsed ?? [], researchNote: r.researchNote ?? null, modelPath: r.modelPath ?? [], targetWords: r.targetWords ?? 0, kind: r.kind === 'digest' ? 'digest' : 'article',
    createdAt: r.createdAt?.toISOString() ?? '', updatedAt: r.updatedAt?.toISOString() ?? '',
  };
}

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function createArticle(viewer: CompanyViewer, input: ArticleInput): Promise<Result<{ id: string }>> {
  const company = await getCompanyProfile(viewer, input.companyId);
  if (!company) return { ok: false, status: 404, error: 'Company not found.' };
  const voice = await BrandVoice.exists({ organizationId: viewer.organizationId, companyId: input.companyId, status: 'approved' });
  if (!voice) return { ok: false, status: 409, error: 'Approve this company’s Voice first, so the article sounds like the brand.' };
  const doc = await ArticleDraft.create({
    organizationId: viewer.organizationId,
    companyId: input.companyId,
    createdByUserId: viewer.userId,
    topic: input.topic,
    notes: input.notes,
    targetWords: LENGTH_WORDS[input.length],
    faq: input.faq,
    referenceUrls: input.referenceUrls,
    links: input.links,
  });
  return { ok: true, data: { id: String(doc._id) } };
}

export async function listArticles(viewer: CompanyViewer, companyId?: string): Promise<ArticleView[]> {
  const filter: Record<string, unknown> = { organizationId: viewer.organizationId, archived: false };
  if (companyId) filter.companyId = companyId;
  const rows = await ArticleDraft.find(filter).sort({ createdAt: -1 }).limit(100).select('-facts -outline -attempts').lean<Row[]>();
  return rows.map((r) => articleView({ ...r, body: '' }));
}

export async function getArticle(viewer: CompanyViewer, id: string): Promise<ArticleView | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const row = await ArticleDraft.findOne({ _id: id, organizationId: viewer.organizationId, archived: false }).lean<Row>();
  return row ? articleView(row) : null;
}

/** Manual edits to the finished text. Re-scoring is the caller's job (see the PATCH route). */
export async function saveArticleText(viewer: CompanyViewer, id: string, patch: { title?: string; body?: string; metaDescription?: string }): Promise<Result<ArticleView>> {
  if (!Types.ObjectId.isValid(id)) return { ok: false, status: 404, error: 'Article not found.' };
  const update: Record<string, unknown> = {};
  if (typeof patch.title === 'string') update.title = patch.title.slice(0, 300);
  if (typeof patch.body === 'string') update.body = patch.body.slice(0, 60000);
  if (typeof patch.metaDescription === 'string') update.metaDescription = patch.metaDescription.slice(0, 400);
  const row = await ArticleDraft.findOneAndUpdate({ _id: id, organizationId: viewer.organizationId, archived: false }, { $set: update }, { new: true }).lean<Row>();
  return row ? { ok: true, data: articleView(row) } : { ok: false, status: 404, error: 'Article not found.' };
}

export async function archiveArticle(viewer: CompanyViewer, id: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const res = await ArticleDraft.updateOne({ _id: id, organizationId: viewer.organizationId }, { $set: { archived: true } });
  return res.matchedCount > 0;
}

/** Puts a failed or parked article back in the queue so the pipeline picks up at its saved stage. */
export async function requeueArticle(viewer: CompanyViewer, id: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const res = await ArticleDraft.updateOne({ _id: id, organizationId: viewer.organizationId, status: { $in: ['failed', 'queued'] } }, { $set: { status: 'queued', error: null, leaseUntil: null, progress: 'Waiting to start' } });
  return res.matchedCount > 0;
}

/** Start over from research (the "write it again" button). */
export async function restartArticle(viewer: CompanyViewer, id: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const res = await ArticleDraft.updateOne(
    { _id: id, organizationId: viewer.organizationId, status: { $in: ['done', 'failed'] } },
    { $set: { status: 'queued', stage: 'research', error: null, leaseUntil: null, progress: 'Waiting to start', facts: [], outline: [], body: '', attempts: [], warnings: [], modelPath: [] } }
  );
  return res.matchedCount > 0;
}
