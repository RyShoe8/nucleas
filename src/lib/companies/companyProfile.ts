import { Types } from 'mongoose';
import Client, { type CompanyRelationship } from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import User from '@/lib/models/User';
import Employee from '@/lib/models/Employee';
import { canUserAccessClient } from '@/lib/utils/clientTeam';
import { getProjectTeamEmployeeIds } from '@/lib/utils/projectTeam';

/**
 * Company = Client document. For owned/internal companies the hub project is the source of truth
 * for profile fields (the legacy UI edits the project); for client companies the Client is.
 */

export const PROFILE_FIELDS = [
  'name',
  'description',
  'color',
  'logo',
  'url',
  'urls',
  'devUrl',
  'liveUrl',
  'socialLinks',
  'techStack',
  'marketingStack',
  'platformStacks',
  'colorPalette',
  'fontPalette',
  'actionButtons',
  'assignedToEmployeeId',
  'assignedToEmployeeIds',
] as const;

export interface CompanyProfile {
  id: string;
  relationship: CompanyRelationship;
  /** Production domain only; never a preview host. */
  domain?: string;
  hubProjectId?: string;
  status?: string;
  name: string;
  description?: string;
  color?: string;
  logo?: string;
  devUrl?: string;
  liveUrl?: string;
  urls: string[];
  socialLinks: { network: string; url: string }[];
  stackToolIds: string[];
  teamEmployeeIds: string[];
  profileSource: 'hub_project' | 'client';
}

type Doc = Record<string, unknown> & { _id: Types.ObjectId };

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function companyRelationship(client: Record<string, unknown>): CompanyRelationship {
  return client.relationship === 'owned' || client.relationship === 'internal' ? client.relationship : 'client';
}

/** Pure: builds the profile from the company and (for owned/internal) its hub project. */
export function resolveCompanyProfile(company: Doc, hubProject: Doc | null): CompanyProfile {
  const relationship = companyRelationship(company);
  const useHub = relationship !== 'client' && hubProject !== null;
  const src = useHub ? hubProject : company;

  const urls = [str(src.url), ...(Array.isArray(src.urls) ? src.urls.map(str) : [])].filter(
    (u): u is string => Boolean(u)
  );
  const stackToolIds = new Set<string>();
  for (const item of (src.techStack as { technologyId?: string }[] | undefined) ?? []) {
    if (item?.technologyId) stackToolIds.add(item.technologyId);
  }
  for (const item of (src.marketingStack as { toolId?: string }[] | undefined) ?? []) {
    if (item?.toolId) stackToolIds.add(item.toolId);
  }
  const platformStacks = (src.platformStacks as Record<string, { optionId?: string }[]> | undefined) ?? {};
  for (const items of Object.values(platformStacks)) {
    for (const item of Array.isArray(items) ? items : []) {
      if (item?.optionId) stackToolIds.add(item.optionId);
    }
  }

  return {
    id: String(company._id),
    relationship,
    domain: str(company.domain),
    hubProjectId: company.hubProjectId ? String(company.hubProjectId) : undefined,
    status: str(company.status),
    name: str(src.name) ?? str(company.name) ?? 'Untitled company',
    description: str(src.description),
    color: str(src.color),
    logo: str(src.logo),
    devUrl: str(src.devUrl),
    liveUrl: str(src.liveUrl),
    urls: [...new Set(urls)],
    socialLinks: ((src.socialLinks as { network: string; url: string }[] | undefined) ?? [])
      .filter((s) => s?.url)
      .map((s) => ({ network: s.network, url: s.url })),
    stackToolIds: [...stackToolIds],
    teamEmployeeIds: [...getProjectTeamEmployeeIds(src as Parameters<typeof getProjectTeamEmployeeIds>[0])],
    profileSource: useHub ? 'hub_project' : 'client',
  };
}

export interface CompanyViewer {
  userId: string;
  organizationId: Types.ObjectId;
  employeeId: string | null;
  role: 'Administrator' | 'Manager' | 'User';
}

export async function loadCompanyViewer(userId: string): Promise<CompanyViewer | null> {
  const user = await User.findById(userId).select('organizationId').lean<{ organizationId?: Types.ObjectId | string }>();
  if (!user?.organizationId) return null;
  const organizationId = new Types.ObjectId(String(user.organizationId));
  const employee = await Employee.findOne({ userId, organizationId }).select('_id role').lean<{
    _id: Types.ObjectId;
    role?: CompanyViewer['role'];
  }>();
  return {
    userId,
    organizationId,
    employeeId: employee ? String(employee._id) : null,
    role: employee?.role ?? 'User',
  };
}

export function isCompanyManager(viewer: CompanyViewer): boolean {
  return viewer.role === 'Administrator' || viewer.role === 'Manager';
}

function canView(viewer: CompanyViewer, profile: CompanyProfile): boolean {
  return canUserAccessClient(
    { assignedToEmployeeIds: profile.teamEmployeeIds },
    { userRole: viewer.role, employeeId: viewer.employeeId }
  );
}

async function hubProjectsFor(companies: Doc[]): Promise<Map<string, Doc>> {
  const ids = companies
    .filter((c) => companyRelationship(c) !== 'client' && c.hubProjectId)
    .map((c) => c.hubProjectId as Types.ObjectId);
  if (ids.length === 0) return new Map();
  const projects = (await Project.find({ _id: { $in: ids } })
    .select(PROFILE_FIELDS.join(' '))
    .lean()) as unknown as Doc[];
  return new Map(projects.map((p) => [String(p._id), p]));
}

/** Companies the viewer may see, with resolved profiles. Org boundary is mandatory. */
export async function listCompanyProfiles(viewer: CompanyViewer): Promise<CompanyProfile[]> {
  const companies = (await Client.find({ organizationId: viewer.organizationId }).lean()) as unknown as Doc[];
  const hubs = await hubProjectsFor(companies);
  return companies
    .map((c) => resolveCompanyProfile(c, c.hubProjectId ? hubs.get(String(c.hubProjectId)) ?? null : null))
    .filter((p) => canView(viewer, p))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCompanyProfile(viewer: CompanyViewer, companyId: string): Promise<CompanyProfile | null> {
  if (!Types.ObjectId.isValid(companyId)) return null;
  const company = (await Client.findOne({ _id: companyId, organizationId: viewer.organizationId }).lean()) as unknown as Doc | null;
  if (!company) return null;
  const hubs = await hubProjectsFor([company]);
  const profile = resolveCompanyProfile(company, company.hubProjectId ? hubs.get(String(company.hubProjectId)) ?? null : null);
  return canView(viewer, profile) ? profile : null;
}
