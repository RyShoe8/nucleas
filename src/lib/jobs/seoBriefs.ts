import 'server-only';
import { Types } from 'mongoose';
import Project from '@/lib/models/Project';
import { SeoBrief } from '@/lib/models/SeoBrief';
import { isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import type { JobRunOutput } from './schema';

export interface SeoBriefView {
  projectId: string;
  projectName: string;
  status: 'draft' | 'approved';
  summary: string;
  audience: string;
  goals: string[];
  primaryTopics: string[];
  competitors: string[];
  excludedTopics: string[];
  geographicTargets: string[];
  positioning: string;
  priorityPages: { url: string; purpose: string; keywords: string[] }[];
  notes: string;
  revision: number;
  approvedAt: string | null;
  updatedAt: string;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value : String(value ?? '').split(/[,\n]/)).map(String).map((v) => v.trim()).filter(Boolean).slice(0, 100);
function pages(value: unknown): SeoBriefView['priorityPages'] {
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
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

function view(row: { projectId: Types.ObjectId; projectName: string; status: 'draft' | 'approved'; summary: string; audience: string; goals?: string[]; primaryTopics?: string[]; competitors?: string[]; excludedTopics?: string[]; geographicTargets?: string[]; positioning?: string; priorityPages?: SeoBriefView['priorityPages']; notes?: string; revision: number; approvedAt?: Date; updatedAt: Date }): SeoBriefView {
  return { projectId: String(row.projectId), projectName: row.projectName, status: row.status, summary: row.summary, audience: row.audience, goals: row.goals ?? [], primaryTopics: row.primaryTopics ?? [], competitors: row.competitors ?? [], excludedTopics: row.excludedTopics ?? [], geographicTargets: row.geographicTargets ?? [], positioning: row.positioning ?? '', priorityPages: row.priorityPages ?? [], notes: row.notes ?? '', revision: row.revision, approvedAt: row.approvedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() };
}

async function ownedProject(viewer: CompanyViewer, companyId: string, projectId: string) {
  if (!Types.ObjectId.isValid(companyId) || !Types.ObjectId.isValid(projectId)) return null;
  return Project.findOne({ _id: new Types.ObjectId(projectId), clientId: new Types.ObjectId(companyId) }).select('name').lean<{ _id: Types.ObjectId; name: string }>();
}

export async function getSeoBrief(viewer: CompanyViewer, companyId: string, projectId: string): Promise<SeoBriefView | null> {
  if (!(await ownedProject(viewer, companyId, projectId))) return null;
  const row = await SeoBrief.findOne({ organizationId: viewer.organizationId, companyId, projectId }).lean<any>();
  return row ? view(row) : null;
}

export async function approvedSeoBrief(organizationId: Types.ObjectId, companyId: Types.ObjectId, projectId?: Types.ObjectId): Promise<SeoBriefView | null> {
  const row = await SeoBrief.findOne({ organizationId, companyId, status: 'approved', ...(projectId ? { projectId } : {}) }).sort({ updatedAt: -1 }).lean<any>();
  return row ? view(row) : null;
}

export async function saveGeneratedSeoBrief(input: { organizationId: Types.ObjectId; companyId: Types.ObjectId; projectId: Types.ObjectId; userId: string; output: JobRunOutput }): Promise<void> {
  const record = input.output.records[0]?.values;
  if (!record) return;
  const project = await Project.findOne({ _id: input.projectId, clientId: input.companyId }).select('name').lean<{ name: string }>();
  if (!project) return;
  await SeoBrief.findOneAndUpdate(
    { organizationId: input.organizationId, projectId: input.projectId },
    {
      $set: { companyId: input.companyId, projectName: project.name, status: 'draft', summary: String(record.summary ?? ''), audience: String(record.audience ?? ''), goals: strings(record.goals), primaryTopics: strings(record.primary_topics), competitors: strings(record.competitors), excludedTopics: strings(record.excluded_topics), geographicTargets: strings(record.geographic_targets), positioning: String(record.positioning ?? ''), priorityPages: pages(record.priority_pages), notes: String(record.notes ?? ''), updatedByUserId: new Types.ObjectId(input.userId) },
      $inc: { revision: 1 }, $unset: { approvedAt: 1, approvedByUserId: 1 },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

export async function updateSeoBrief(viewer: CompanyViewer, companyId: string, projectId: string, input: Record<string, unknown>): Promise<{ ok: true; brief: SeoBriefView } | { ok: false; status: 400 | 403 | 404; error: string }> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can edit SEO briefs.' };
  const project = await ownedProject(viewer, companyId, projectId);
  if (!project) return { ok: false, status: 404, error: 'Project not found.' };
  const summary = String(input.summary ?? '').trim(); const audience = String(input.audience ?? '').trim();
  if (!summary || !audience) return { ok: false, status: 400, error: 'Property summary and target audience are required.' };
  const approve = input.status === 'approved';
  const row = await SeoBrief.findOneAndUpdate(
    { organizationId: viewer.organizationId, projectId: project._id },
    { $set: { companyId: new Types.ObjectId(companyId), projectName: project.name, status: approve ? 'approved' : 'draft', summary: summary.slice(0, 4000), audience: audience.slice(0, 4000), goals: strings(input.goals), primaryTopics: strings(input.primaryTopics), competitors: strings(input.competitors), excludedTopics: strings(input.excludedTopics), geographicTargets: strings(input.geographicTargets), positioning: String(input.positioning ?? '').slice(0, 4000), priorityPages: pages(input.priorityPages), notes: String(input.notes ?? '').slice(0, 4000), updatedByUserId: new Types.ObjectId(viewer.userId), ...(approve ? { approvedAt: new Date(), approvedByUserId: new Types.ObjectId(viewer.userId) } : {}) }, $inc: { revision: 1 }, ...(!approve ? { $unset: { approvedAt: 1, approvedByUserId: 1 } } : {}) },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean<any>();
  return { ok: true, brief: view(row) };
}

export function seoBriefContext(brief: SeoBriefView): string {
  return JSON.stringify({ project: brief.projectName, summary: brief.summary, audience: brief.audience, goals: brief.goals, primaryTopics: brief.primaryTopics, competitors: brief.competitors, excludedTopics: brief.excludedTopics, geographicTargets: brief.geographicTargets, positioning: brief.positioning, priorityPages: brief.priorityPages });
}
