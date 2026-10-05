import 'server-only';
import { Types } from 'mongoose';
import Project from '@/lib/models/Project';
import { Job } from '@/lib/models/Job';
import { MarketingPlan } from '@/lib/models/MarketingPlan';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import type { JobRunOutput } from './schema';
import { linkBuildingDesign } from './templates/linkBuilding';
import { socialMediaDesign } from './templates/socialMedia';
import { aiCitationDesign } from './templates/aiCitations';
import { readEngineSettings } from '@/lib/ai/engine/select';

export interface MarketingPlanView {
  companyId: string;
  companyName: string;
  status: 'draft' | 'approved';
  summary: string;
  audience: string;
  goals: string[];
  positioning: string;
  messagingPillars: string[];
  primaryTopics: string[];
  competitors: string[];
  excludedTopics: string[];
  geographicTargets: string[];
  priorityPages: { url: string; purpose: string; keywords: string[] }[];
  seoStrategy: string;
  aiCitationStrategy: string;
  aiTargetQuestions: string[];
  aiSourceTargets: string[];
  socialStrategy: string;
  socialPlatforms: string[];
  socialContentPillars: string[];
  socialCadence: string;
  kpis: string[];
  notes: string;
  revision: number;
  approvedAt: string | null;
  updatedAt: string;
}

type MarketingPlanLean = Omit<MarketingPlanView, 'companyId' | 'approvedAt' | 'updatedAt'> & {
  companyId: Types.ObjectId;
  approvedAt?: Date;
  updatedAt: Date;
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value : String(value ?? '').split(/[,\n]/)).map(String).map((item) => item.trim()).filter(Boolean).slice(0, 100);
function pages(value: unknown): MarketingPlanView['priorityPages'] {
  let raw = value;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    try {
      const url = new URL(String(item.url ?? ''));
      if (!['http:', 'https:'].includes(url.protocol)) return [];
      return [{ url: url.toString(), purpose: String(item.purpose ?? '').slice(0, 500), keywords: strings(item.keywords).slice(0, 30) }];
    } catch { return []; }
  }).slice(0, 50);
}

function view(row: MarketingPlanLean): MarketingPlanView {
  return {
    companyId: String(row.companyId), companyName: row.companyName, status: row.status,
    summary: row.summary, audience: row.audience, goals: row.goals ?? [], positioning: row.positioning ?? '', messagingPillars: row.messagingPillars ?? [],
    primaryTopics: row.primaryTopics ?? [], competitors: row.competitors ?? [], excludedTopics: row.excludedTopics ?? [], geographicTargets: row.geographicTargets ?? [], priorityPages: row.priorityPages ?? [], seoStrategy: row.seoStrategy ?? '',
    aiCitationStrategy: row.aiCitationStrategy ?? '', aiTargetQuestions: row.aiTargetQuestions ?? [], aiSourceTargets: row.aiSourceTargets ?? [],
    socialStrategy: row.socialStrategy ?? '', socialPlatforms: row.socialPlatforms ?? [], socialContentPillars: row.socialContentPillars ?? [], socialCadence: row.socialCadence ?? '', kpis: row.kpis ?? [], notes: row.notes ?? '',
    revision: row.revision, approvedAt: row.approvedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getMarketingPlan(viewer: CompanyViewer, companyId: string): Promise<MarketingPlanView | null> {
  if (!Types.ObjectId.isValid(companyId) || !(await getCompanyProfile(viewer, companyId))) return null;
  const row = await MarketingPlan.findOne({ organizationId: viewer.organizationId, companyId }).lean<MarketingPlanLean>();
  return row ? view(row) : null;
}

export async function approvedMarketingPlan(organizationId: Types.ObjectId, companyId: Types.ObjectId): Promise<MarketingPlanView | null> {
  const row = await MarketingPlan.findOne({ organizationId, companyId, status: 'approved' }).lean<MarketingPlanLean>();
  return row ? view(row) : null;
}

export function marketingPlanContext(plan: MarketingPlanView): string {
  return JSON.stringify({ company: plan.companyName, revision: plan.revision, summary: plan.summary, audience: plan.audience, goals: plan.goals, positioning: plan.positioning, messagingPillars: plan.messagingPillars, seo: { strategy: plan.seoStrategy, topics: plan.primaryTopics, competitors: plan.competitors, exclusions: plan.excludedTopics, geographies: plan.geographicTargets, priorityPages: plan.priorityPages }, aiCitations: { strategy: plan.aiCitationStrategy, targetQuestions: plan.aiTargetQuestions, sourceTargets: plan.aiSourceTargets }, social: { strategy: plan.socialStrategy, platforms: plan.socialPlatforms, contentPillars: plan.socialContentPillars, cadence: plan.socialCadence }, kpis: plan.kpis });
}

export async function saveGeneratedMarketingPlan(input: { organizationId: Types.ObjectId; companyId: Types.ObjectId; userId: string; companyName: string; output: JobRunOutput }): Promise<void> {
  const record = input.output.records[0]?.values;
  if (!record) return;
  await MarketingPlan.findOneAndUpdate(
    { organizationId: input.organizationId, companyId: input.companyId },
    { $set: { companyName: input.companyName, status: 'draft', summary: String(record.summary ?? ''), audience: String(record.audience ?? ''), goals: strings(record.goals), positioning: String(record.positioning ?? ''), messagingPillars: strings(record.messaging_pillars), primaryTopics: strings(record.primary_topics), competitors: strings(record.competitors), excludedTopics: strings(record.excluded_topics), geographicTargets: strings(record.geographic_targets), priorityPages: pages(record.priority_pages), seoStrategy: String(record.seo_strategy ?? ''), aiCitationStrategy: String(record.ai_citation_strategy ?? ''), aiTargetQuestions: strings(record.ai_target_questions), aiSourceTargets: strings(record.ai_source_targets), socialStrategy: String(record.social_strategy ?? ''), socialPlatforms: strings(record.social_platforms), socialContentPillars: strings(record.social_content_pillars), socialCadence: String(record.social_cadence ?? ''), kpis: strings(record.kpis), notes: String(record.notes ?? ''), updatedByUserId: new Types.ObjectId(input.userId) }, $inc: { revision: 1 }, $unset: { approvedAt: 1, approvedByUserId: 1 } },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function createProposedJobs(viewer: CompanyViewer, plan: MarketingPlanView): Promise<void> {
  const companyId = new Types.ObjectId(plan.companyId);
  const level = (await readEngineSettings(String(viewer.organizationId))).defaultCostLevel;
  const projects = await Project.find({ clientId: companyId }).sort({ updatedAt: -1 }).select('_id name category url urls liveUrl').lean<{ _id: Types.ObjectId; name: string; category?: string; url?: string; urls?: string[]; liveUrl?: string }[]>();
  const targetHost = (() => { try { return new URL(plan.priorityPages[0]?.url ?? '').hostname.replace(/^www\./, ''); } catch { return null; } })();
  const project = projects.find((item) => [item.liveUrl, item.url, ...(item.urls ?? [])].some((value) => {
    try { return Boolean(targetHost) && new URL(value ?? '').hostname.replace(/^www\./, '') === targetHost; } catch { return false; }
  })) ?? projects.find((item) => item.category === 'website') ?? projects[0];
  const candidates = [
    ...(project ? [{ skill: 'link_building', projectId: project._id, request: `Run the approved link-building strategy for ${plan.companyName}.`, design: linkBuildingDesign({ projectId: String(project._id), schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' }, recordsPerRun: 1, country: plan.geographicTargets.find((value) => !/not established/i.test(value)) ?? 'United States', language: 'English', exclusions: plan.excludedTopics.join(', ') }) }] : []),
    { skill: 'social_media', request: `Create daily social media drafts for ${plan.companyName}.`, design: socialMediaDesign(plan.socialPlatforms) },
    { skill: 'ai_citations', request: `Find daily AI citation opportunities for ${plan.companyName}.`, design: aiCitationDesign() },
  ];
  for (const candidate of candidates) {
    const exists = await Job.exists({ organizationId: viewer.organizationId, companyId, 'design.skill': candidate.skill, status: { $nin: ['rejected', 'archived', 'done'] } });
    if (exists) continue;
    await Job.create({ organizationId: viewer.organizationId, companyId, ...('projectId' in candidate ? { projectId: candidate.projectId } : {}), createdByUserId: new Types.ObjectId(viewer.userId), status: 'proposed', request: candidate.request, design: candidate.design, level, designCostMicros: 0, events: [{ at: new Date(), userId: new Types.ObjectId(viewer.userId), action: 'generated_from_plan', note: `Marketing Plan revision ${plan.revision}` }] });
  }
}

export async function updateMarketingPlan(viewer: CompanyViewer, companyId: string, input: Record<string, unknown>): Promise<{ ok: true; plan: MarketingPlanView } | { ok: false; status: 400 | 403 | 404; error: string }> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can edit Marketing Plans.' };
  if (!Types.ObjectId.isValid(companyId)) return { ok: false, status: 404, error: 'Company not found.' };
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return { ok: false, status: 404, error: 'Company not found.' };
  const summary = String(input.summary ?? '').trim(); const audience = String(input.audience ?? '').trim();
  if (!summary || !audience) return { ok: false, status: 400, error: 'Company summary and target audience are required.' };
  const approve = input.status === 'approved';
  const row = await MarketingPlan.findOneAndUpdate(
    { organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId) },
    { $set: { companyName: profile.name, status: approve ? 'approved' : 'draft', summary: summary.slice(0, 5000), audience: audience.slice(0, 5000), goals: strings(input.goals), positioning: String(input.positioning ?? '').slice(0, 5000), messagingPillars: strings(input.messagingPillars), primaryTopics: strings(input.primaryTopics), competitors: strings(input.competitors), excludedTopics: strings(input.excludedTopics), geographicTargets: strings(input.geographicTargets), priorityPages: pages(input.priorityPages), seoStrategy: String(input.seoStrategy ?? '').slice(0, 6000), aiCitationStrategy: String(input.aiCitationStrategy ?? '').slice(0, 6000), aiTargetQuestions: strings(input.aiTargetQuestions), aiSourceTargets: strings(input.aiSourceTargets), socialStrategy: String(input.socialStrategy ?? '').slice(0, 6000), socialPlatforms: strings(input.socialPlatforms), socialContentPillars: strings(input.socialContentPillars), socialCadence: String(input.socialCadence ?? '').slice(0, 2000), kpis: strings(input.kpis), notes: String(input.notes ?? '').slice(0, 5000), updatedByUserId: new Types.ObjectId(viewer.userId), ...(approve ? { approvedAt: new Date(), approvedByUserId: new Types.ObjectId(viewer.userId) } : {}) }, $inc: { revision: 1 }, ...(!approve ? { $unset: { approvedAt: 1, approvedByUserId: 1 } } : {}) },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean<MarketingPlanLean>();
  if (!row) return { ok: false, status: 404, error: 'Marketing Plan could not be saved.' };
  const plan = view(row);
  if (approve) await createProposedJobs(viewer, plan);
  return { ok: true, plan };
}
