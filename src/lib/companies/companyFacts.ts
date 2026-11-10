import 'server-only';
import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { z } from 'zod';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import { PropertyOverview } from '@/lib/models/PropertyOverview';

/**
 * What a company is, in the terms everyone works from: what it does, who it is for, the topics it
 * should be found for, who it competes with, and the facts worth knowing.
 *
 * The Company Overview (a crawl and analysis of the live site) drafts all of it. A person can correct
 * any part, and their version then stands until they hand that part back to the overview. The team and
 * Ask read the result, so a correction made here changes what every member works from.
 */
const competitorSchema = new Schema({ name: { type: String, maxlength: 120 }, domain: { type: String, maxlength: 200 }, note: { type: String, maxlength: 400 } }, { _id: false });
const factsSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, required: true },
    description: { type: String, maxlength: 2000 },
    audience: { type: String, maxlength: 2000 },
    keywords: { type: [String], default: undefined },
    competitors: { type: [competitorSchema], default: undefined },
    /** Things the site does not say: pricing, what is off limits, what is coming. */
    keyFacts: { type: String, maxlength: 4000 },
    /** When a person last set each part. A part with no date still comes from the overview. */
    editedAt: { type: Schema.Types.Mixed, default: {} },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true, minimize: false }
);
factsSchema.index({ organizationId: 1, companyId: 1 }, { unique: true });
type FactsDoc = InferSchemaType<typeof factsSchema>;
export const CompanyFacts: Model<FactsDoc> = (mongoose.models.CompanyFacts as Model<FactsDoc> | undefined) ?? mongoose.model<FactsDoc>('CompanyFacts', factsSchema);

export const FACT_KEYS = ['description', 'audience', 'keywords', 'competitors', 'keyFacts'] as const;
export type FactKey = (typeof FACT_KEYS)[number];
export interface Competitor { name: string; domain?: string; note?: string }
export type FactSource = 'you' | 'overview' | 'profile' | 'none';
export interface FactValues { description: string; audience: string; keywords: string[]; competitors: Competitor[]; keyFacts: string }
export interface CompanyFactsView {
  canManage: boolean;
  values: FactValues;
  /** Where each part comes from, and when it was last set or analysed. */
  sources: Record<FactKey, { source: FactSource; at: string | null }>;
  /** What the overview says for each part, so an edit can be compared with it or handed back. */
  overviewValues: Partial<FactValues>;
  overview: { status: string; rootUrl: string; completedAt: string | null; pageCount: number; issueCount: number } | null;
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
function competitorsFrom(raw: unknown): Competitor[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): Competitor[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const name = text(row.name, 120);
    if (!name) return [];
    const domain = text(row.domain, 200).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const note = text(row.note ?? row.reason ?? row.description ?? row.why, 400);
    return [{ name, ...(domain ? { domain } : {}), ...(note ? { note } : {}) }];
  }).slice(0, 12);
}

type OverviewLean = { status: string; rootUrl: string; completedAt?: Date; updatedAt?: Date; pageCount?: number; issueCount?: number; propertyDescription?: string; demographicTarget?: string; primaryKeywords?: string[]; competitors?: unknown };
type FactsLean = { description?: string; audience?: string; keywords?: string[]; competitors?: Competitor[]; keyFacts?: string; editedAt?: Partial<Record<FactKey, Date>> };

async function load(organizationId: Types.ObjectId, companyId: string) {
  const scope = { organizationId, companyId: new Types.ObjectId(companyId) };
  const [facts, analysed, latest] = await Promise.all([
    CompanyFacts.findOne(scope).lean<FactsLean>(),
    // The newest overview that finished its analysis: a crawl in progress must not blank the profile.
    PropertyOverview.findOne({ ...scope, status: 'complete' }).sort({ createdAt: -1 }).select('status rootUrl completedAt updatedAt pageCount issueCount propertyDescription demographicTarget primaryKeywords competitors').lean<OverviewLean>(),
    PropertyOverview.findOne(scope).sort({ createdAt: -1 }).select('status rootUrl completedAt updatedAt pageCount issueCount').lean<OverviewLean>(),
  ]);
  return { facts, analysed, latest };
}

function merge(facts: FactsLean | null, analysed: OverviewLean | null, profileDescription: string | undefined) {
  const overviewValues: Partial<FactValues> = analysed ? {
    ...(text(analysed.propertyDescription, 2000) ? { description: text(analysed.propertyDescription, 2000) } : {}),
    ...(text(analysed.demographicTarget, 2000) ? { audience: text(analysed.demographicTarget, 2000) } : {}),
    ...(analysed.primaryKeywords?.length ? { keywords: analysed.primaryKeywords.map((k) => text(k, 80)).filter(Boolean).slice(0, 30) } : {}),
    ...(competitorsFrom(analysed.competitors).length ? { competitors: competitorsFrom(analysed.competitors) } : {}),
  } : {};
  const analysedAt = analysed ? (analysed.completedAt ?? analysed.updatedAt ?? null) : null;
  const edited = facts?.editedAt ?? {};
  const values = {} as FactValues;
  const sources = {} as CompanyFactsView['sources'];
  const empty: FactValues = { description: '', audience: '', keywords: [], competitors: [], keyFacts: '' };
  for (const key of FACT_KEYS) {
    const mine = facts?.[key];
    const hasMine = edited[key] && mine !== undefined && mine !== null;
    const fromOverview = overviewValues[key];
    if (hasMine) { (values[key] as unknown) = mine; sources[key] = { source: 'you', at: new Date(edited[key]!).toISOString() }; }
    else if (fromOverview !== undefined) { (values[key] as unknown) = fromOverview; sources[key] = { source: 'overview', at: analysedAt ? new Date(analysedAt).toISOString() : null }; }
    else if (key === 'description' && profileDescription?.trim()) { values.description = profileDescription.trim(); sources.description = { source: 'profile', at: null }; }
    else { (values[key] as unknown) = empty[key]; sources[key] = { source: 'none', at: null }; }
  }
  return { values, sources, overviewValues };
}

export async function getCompanyFacts(viewer: CompanyViewer, companyId: string): Promise<CompanyFactsView | null> {
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return null;
  const { facts, analysed, latest } = await load(viewer.organizationId, profile.id);
  const shown = latest ?? analysed;
  return {
    canManage: isCompanyManager(viewer),
    ...merge(facts, analysed, profile.description),
    overview: shown ? { status: shown.status, rootUrl: shown.rootUrl, completedAt: shown.completedAt ? new Date(shown.completedAt).toISOString() : null, pageCount: shown.pageCount ?? 0, issueCount: shown.issueCount ?? 0 } : null,
  };
}

const patchSchema = z.object({
  description: z.string().trim().max(2000).nullable(),
  audience: z.string().trim().max(2000).nullable(),
  keywords: z.array(z.string().trim().min(1).max(80)).max(30).nullable(),
  competitors: z.array(z.object({ name: z.string().trim().min(1).max(120), domain: z.string().trim().max(200).optional(), note: z.string().trim().max(400).optional() })).max(12).nullable(),
  keyFacts: z.string().trim().max(4000).nullable(),
}).partial().strict();

/** Sets the parts given. null hands a part back to the Company Overview. */
export async function saveCompanyFacts(viewer: CompanyViewer, companyId: string, input: unknown): Promise<{ ok: true; view: CompanyFactsView } | { ok: false; status: 400 | 403 | 404; error: string }> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can edit company information.' };
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return { ok: false, status: 404, error: 'Company not found.' };
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? 'Check the company information and try again.' };
  const set: Record<string, unknown> = { updatedBy: new Types.ObjectId(viewer.userId) };
  const unset: Record<string, ''> = {};
  const now = new Date();
  for (const key of FACT_KEYS) {
    const value = parsed.data[key];
    if (value === undefined) continue;
    if (value === null) { unset[key] = ''; unset[`editedAt.${key}`] = ''; continue; }
    set[key] = key === 'competitors' ? competitorsFrom(value) : value;
    set[`editedAt.${key}`] = now;
  }
  if (Object.keys(set).length === 1 && !Object.keys(unset).length) return { ok: false, status: 400, error: 'Nothing to update.' };
  await CompanyFacts.updateOne({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(profile.id) }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { upsert: true });
  return { ok: true, view: (await getCompanyFacts(viewer, companyId))! };
}

/** The same information as context for the team and Ask, saying which parts a person confirmed. */
export async function companyFactsContext(organizationId: Types.ObjectId, companyId: string, profileDescription?: string): Promise<string> {
  const { facts, analysed } = await load(organizationId, companyId);
  const { values, sources } = merge(facts, analysed, profileDescription);
  const tag = (key: FactKey) => (sources[key].source === 'you' ? ' (confirmed by the company)' : sources[key].source === 'overview' ? ` (from the site analysis${sources[key].at ? `, ${sources[key].at!.slice(0, 10)}` : ''})` : '');
  return [
    values.description ? `What it does${tag('description')}: ${values.description.slice(0, 900)}` : '',
    values.audience ? `Who it is for${tag('audience')}: ${values.audience.slice(0, 700)}` : '',
    values.keywords.length ? `Topics it should be found for${tag('keywords')}: ${values.keywords.slice(0, 20).join(', ')}` : '',
    values.competitors.length ? `Competitors${tag('competitors')}: ${values.competitors.slice(0, 10).map((c) => `${c.name}${c.domain ? ` (${c.domain})` : ''}${c.note ? `: ${c.note.slice(0, 140)}` : ''}`).join('; ')}` : '',
    values.keyFacts ? `Key facts the company gave (treat as true): ${values.keyFacts.slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n');
}
