import { Types } from 'mongoose';
import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import User from '@/lib/models/User';
import type { CompanyRelationship } from '@/lib/models/Client';

/**
 * Converts top-level property projects into `owned` Companies (Client documents).
 *
 * The project itself is never rewritten beyond gaining `clientId`: its _id, tasks,
 * content, assets, comments, AI runs and repository bindings stay where they are.
 * Safe to re-run: a company is found again through `hubProjectId`.
 */

export type OwnedCompanyAction =
  | 'create_company_and_attach'
  | 'attach_existing_company'
  | 'already_converted'
  | 'skip_has_other_client'
  | 'skip_no_organization'
  | 'skip_not_found';

export interface ConversionOverrides {
  /** Per project id; defaults to 'owned'. */
  relationships?: Record<string, Exclude<CompanyRelationship, 'client'>>;
  /** Per project id; used when the project has no URL recorded. */
  domains?: Record<string, string>;
}

export interface OwnedCompanyPlanItem {
  projectId: string;
  projectName: string;
  projectType?: string;
  action: OwnedCompanyAction;
  relationship: Exclude<CompanyRelationship, 'client'>;
  organizationId?: string;
  companyId?: string;
  domain?: string;
  copiedFields: string[];
  notes: string[];
}

/** Operational fields copied from the property project. Portal slug/token are not copied (they must stay unique). */
const COPIED_FIELDS = [
  'url',
  'urls',
  'devUrl',
  'liveUrl',
  'socialLinks',
  'socialsToolbarVisible',
  'techStack',
  'marketingStack',
  'platformStacks',
  'colorPalette',
  'fontPalette',
  'actionButtons',
  'logo',
  'color',
  'description',
  'assignedToEmployeeId',
  'assignedToEmployeeIds',
] as const;

export function domainFromProject(project: { liveUrl?: string; url?: string; urls?: string[] }): string | undefined {
  const raw = project.liveUrl || project.url || project.urls?.find(Boolean);
  if (!raw) return undefined;
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
    return host.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

type LeanProject = Record<string, unknown> & {
  _id: Types.ObjectId;
  name: string;
  projectType?: string;
  userId?: Types.ObjectId;
  clientId?: Types.ObjectId | string | null;
};

export async function planOwnedCompanyConversion(
  projectIds: string[],
  overrides: ConversionOverrides = {}
): Promise<OwnedCompanyPlanItem[]> {
  const plan: OwnedCompanyPlanItem[] = [];
  for (const id of projectIds) {
    if (!Types.ObjectId.isValid(id)) {
      plan.push({ projectId: id, projectName: '', action: 'skip_not_found', relationship: 'owned', copiedFields: [], notes: ['Invalid id'] });
      continue;
    }
    const project = (await Project.findById(id).select('-tasks -stages').lean()) as LeanProject | null;
    if (!project) {
      plan.push({ projectId: id, projectName: '', action: 'skip_not_found', relationship: 'owned', copiedFields: [], notes: [] });
      continue;
    }
    const base = {
      projectId: String(project._id),
      projectName: project.name,
      projectType: project.projectType,
      relationship: overrides.relationships?.[id] ?? ('owned' as const),
      domain:
        domainFromProject(project as { liveUrl?: string; url?: string; urls?: string[] }) ??
        (overrides.domains?.[id] ? domainFromProject({ url: overrides.domains[id] }) : undefined),
      copiedFields: COPIED_FIELDS.filter((f) => hasValue(project[f])),
      notes: [] as string[],
    };
    if (project.projectType && project.projectType !== 'internal') {
      base.notes.push(`projectType is '${project.projectType}' (left unchanged)`);
    }
    if (!base.domain) base.notes.push('No URL on project; company has no domain yet');

    const existing = await Client.findOne({ hubProjectId: project._id }).select('_id organizationId').lean();
    if (project.clientId) {
      const same = existing && String(existing._id) === String(project.clientId);
      plan.push({
        ...base,
        action: same ? 'already_converted' : 'skip_has_other_client',
        companyId: String(project.clientId),
        organizationId: existing ? String(existing.organizationId) : undefined,
      });
      continue;
    }
    if (existing) {
      plan.push({ ...base, action: 'attach_existing_company', companyId: String(existing._id), organizationId: String(existing.organizationId) });
      continue;
    }
    const owner = project.userId
      ? await User.findById(project.userId).select('organizationId').lean<{ organizationId?: Types.ObjectId }>()
      : null;
    if (!owner?.organizationId) {
      plan.push({ ...base, action: 'skip_no_organization', notes: [...base.notes, 'Project owner has no organization'] });
      continue;
    }
    plan.push({ ...base, action: 'create_company_and_attach', organizationId: String(owner.organizationId) });
  }
  return plan;
}

export interface OwnedCompanyApplyResult {
  created: number;
  attached: number;
  unchanged: number;
  skipped: number;
  items: OwnedCompanyPlanItem[];
}

/** Applies a plan produced by planOwnedCompanyConversion. Re-plans each item first so a stale plan cannot double-create. */
export async function applyOwnedCompanyConversion(
  projectIds: string[],
  overrides: ConversionOverrides = {}
): Promise<OwnedCompanyApplyResult> {
  const plan = await planOwnedCompanyConversion(projectIds, overrides);
  const result: OwnedCompanyApplyResult = { created: 0, attached: 0, unchanged: 0, skipped: 0, items: plan };

  for (const item of plan) {
    if (item.action === 'already_converted') {
      result.unchanged += 1;
      continue;
    }
    if (item.action !== 'create_company_and_attach' && item.action !== 'attach_existing_company') {
      result.skipped += 1;
      continue;
    }

    let companyId = item.companyId;
    if (item.action === 'create_company_and_attach') {
      const project = (await Project.findById(item.projectId).select('-tasks -stages').lean()) as LeanProject | null;
      if (!project) {
        result.skipped += 1;
        continue;
      }
      const copied: Record<string, unknown> = {};
      for (const field of COPIED_FIELDS) {
        if (hasValue(project[field])) copied[field] = project[field];
      }
      try {
        const company = await Client.create({
          ...copied,
          organizationId: new Types.ObjectId(item.organizationId),
          userIds: project.userId ? [project.userId] : [],
          name: project.name,
          domain: item.domain,
          status: 'active',
          relationship: item.relationship,
          hubProjectId: project._id,
        });
        companyId = String(company._id);
        result.created += 1;
      } catch (err) {
        // Unique hubProjectId: a concurrent run created it first; reuse that company.
        if ((err as { code?: number }).code !== 11000) throw err;
        const winner = await Client.findOne({ hubProjectId: project._id }).select('_id').lean();
        if (!winner) throw err;
        companyId = String(winner._id);
      }
      item.companyId = companyId;
    }

    const update = await Project.updateOne(
      { _id: item.projectId, $or: [{ clientId: { $exists: false } }, { clientId: null }] },
      { $set: { clientId: new Types.ObjectId(companyId) } }
    );
    if (update.modifiedCount === 1) result.attached += 1;
    else result.unchanged += 1;
  }
  return result;
}
