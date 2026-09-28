import 'server-only';
import { Types } from 'mongoose';
import Project from '@/lib/models/Project';
import { AiProjectRepository } from '@/lib/models/AiProjectRepository';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import { githubAppConfigured } from '@/lib/ai/githubPublish';
import { listAppRepositories } from '@/lib/ai/githubAppClient';

/**
 * A company's code: each of its projects and the GitHub repository it builds from. The repository
 * binding lives on the project (the build service and the IDE read it there); companies without a
 * project cannot hold code yet.
 */

export interface CodeRepository {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  /** The GitHub App can act on it (read, branch, open pull requests). */
  appConnected: boolean;
}

export interface CodeProject {
  projectId: string;
  projectName: string;
  repository: CodeRepository | null;
}

export interface CompanyCode {
  githubConfigured: boolean;
  canManage: boolean;
  projects: CodeProject[];
}

function repoView(row: { owner: string; repo: string; defaultBranch?: string | null; installationId?: string | null }): CodeRepository {
  return {
    owner: row.owner,
    repo: row.repo,
    fullName: `${row.owner}/${row.repo}`,
    defaultBranch: row.defaultBranch || 'main',
    appConnected: Boolean(row.installationId),
  };
}

export async function getCompanyCode(viewer: CompanyViewer, companyId: string): Promise<CompanyCode | null> {
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return null;
  const projects = await Project.find({ clientId: new Types.ObjectId(companyId) })
    .select('name')
    .sort({ name: 1 })
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  const repos = await AiProjectRepository.find({
    organizationId: String(viewer.organizationId),
    projectId: { $in: projects.map((p) => p._id) },
  })
    .select('projectId owner repo defaultBranch installationId')
    .lean<{ projectId: Types.ObjectId; owner: string; repo: string; defaultBranch: string; installationId?: string | null }[]>();
  const byProject = new Map(repos.map((r) => [String(r.projectId), r]));
  return {
    githubConfigured: githubAppConfigured(),
    canManage: isCompanyManager(viewer),
    projects: projects.map((p) => {
      const row = byProject.get(String(p._id));
      return { projectId: String(p._id), projectName: p.name, repository: row ? repoView(row) : null };
    }),
  };
}

export type CodeResult = { ok: true } | { ok: false; status: 400 | 403 | 404 | 503; error: string };

async function ownedProject(viewer: CompanyViewer, companyId: string, projectId: string) {
  if (!Types.ObjectId.isValid(projectId)) return null;
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return null;
  return Project.findOne({ _id: new Types.ObjectId(projectId), clientId: new Types.ObjectId(companyId) })
    .select('_id')
    .lean<{ _id: Types.ObjectId }>();
}

/** Point a company project at a repository the GitHub App can reach. Managers and admins only. */
export async function setProjectRepository(
  viewer: CompanyViewer,
  companyId: string,
  input: { projectId: string; fullName: string }
): Promise<CodeResult> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can connect repositories.' };
  if (!githubAppConfigured()) return { ok: false, status: 503, error: 'The GitHub App is not configured on the server.' };
  const project = await ownedProject(viewer, companyId, input.projectId);
  if (!project) return { ok: false, status: 404, error: 'Project not found for this company.' };
  const repo = (await listAppRepositories()).find((r) => r.fullName.toLowerCase() === input.fullName.trim().toLowerCase());
  if (!repo) return { ok: false, status: 400, error: 'The GitHub App cannot reach that repository. Install the App on it first.' };
  await AiProjectRepository.findOneAndUpdate(
    { organizationId: String(viewer.organizationId), projectId: project._id },
    {
      $set: {
        host: 'github',
        owner: repo.owner,
        repo: repo.repo,
        defaultBranch: repo.defaultBranch,
        publishMode: 'pull_request',
        installationId: repo.installationId,
        updatedByUserId: new Types.ObjectId(viewer.userId),
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
  return { ok: true };
}

export async function clearProjectRepository(viewer: CompanyViewer, companyId: string, projectId: string): Promise<CodeResult> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can disconnect repositories.' };
  const project = await ownedProject(viewer, companyId, projectId);
  if (!project) return { ok: false, status: 404, error: 'Project not found for this company.' };
  await AiProjectRepository.deleteOne({ organizationId: String(viewer.organizationId), projectId: project._id });
  return { ok: true };
}

/** The repository a company builds from: its first project with an App-connected repository. */
export async function resolveCompanyRepository(
  viewer: CompanyViewer,
  companyId: string
): Promise<{ projectId: Types.ObjectId; projectName: string; repository: CodeRepository } | null> {
  const code = await getCompanyCode(viewer, companyId);
  const hit = code?.projects.find((p) => p.repository?.appConnected);
  if (!hit?.repository) return null;
  return { projectId: new Types.ObjectId(hit.projectId), projectName: hit.projectName, repository: hit.repository };
}

/** Companies (by id) that have a buildable repository, for the Ask planner. */
export async function companiesWithRepositories(viewer: CompanyViewer, companyIds: string[]): Promise<Map<string, string>> {
  const ids = companyIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  const projects = await Project.find({ clientId: { $in: ids } })
    .select('clientId')
    .lean<{ _id: Types.ObjectId; clientId: Types.ObjectId }[]>();
  const repos = await AiProjectRepository.find({
    organizationId: String(viewer.organizationId),
    projectId: { $in: projects.map((p) => p._id) },
    installationId: { $nin: [null, ''] },
  })
    .select('projectId owner repo')
    .lean<{ projectId: Types.ObjectId; owner: string; repo: string }[]>();
  const companyOf = new Map(projects.map((p) => [String(p._id), String(p.clientId)]));
  const out = new Map<string, string>();
  for (const r of repos) {
    const companyId = companyOf.get(String(r.projectId));
    if (companyId && !out.has(companyId)) out.set(companyId, `${r.owner}/${r.repo}`);
  }
  return out;
}
