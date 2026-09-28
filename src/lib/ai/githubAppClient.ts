import 'server-only';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { githubAppConfigured } from '@/lib/ai/githubPublish';

function normalizePrivateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

/** Build an Octokit client for a GitHub App installation. Fail-closed when env/install missing. */
export function createInstallationOctokit(installationId: string): Octokit {
  if (!githubAppConfigured()) {
    throw new Error('GitHub App credentials are not configured.');
  }
  const appId = process.env.GITHUB_APP_ID!.trim();
  const privateKey = normalizePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY!.trim());
  const installationIdNumber = Number(installationId);
  if (!Number.isFinite(installationIdNumber) || installationIdNumber <= 0) {
    throw new Error('Invalid GitHub App installation id.');
  }
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId: installationIdNumber,
    },
  });
}

/** Mint a short-lived installation token for an isolated execution worker. Never persist or log it. */
export async function createInstallationAccessToken(installationId: string): Promise<string> {
  if (!githubAppConfigured()) throw new Error('GitHub App credentials are not configured.');
  const installationIdNumber = Number(installationId);
  if (!Number.isFinite(installationIdNumber) || installationIdNumber <= 0) throw new Error('Invalid GitHub App installation id.');
  const auth = createAppAuth({
    appId: process.env.GITHUB_APP_ID!.trim(),
    privateKey: normalizePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY!.trim()),
    installationId: installationIdNumber,
  });
  const result = await auth({ type: 'installation' });
  if (!('token' in result) || typeof result.token !== 'string' || !result.token) throw new Error('Unable to mint GitHub installation token.');
  return result.token;
}

/** Verify that the specified installation has access to owner/repo. */
export async function verifyInstallationRepositoryAccess(
  installationId: string,
  owner: string,
  repo: string
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const octokit = createInstallationOctokit(installationId);
    const { data } = await octokit.repos.get({ owner, repo });
    if (!data) {
      return { ok: false, reason: 'Repository not accessible with this GitHub installation.' };
    }
    return { ok: true };
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
    if (status === 404) {
      return { ok: false, reason: 'Repository not found or GitHub App is not installed on this repository.' };
    }
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Failed to verify GitHub installation repository access.',
    };
  }
}

export interface AppRepository {
  installationId: string;
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

let repoCache: { at: number; repos: AppRepository[] } | null = null;
const REPO_CACHE_MS = 5 * 60 * 1000;

/**
 * Every repository the GitHub App can reach, across all its installations (our account and any
 * client account that installed it). Cached for five minutes.
 */
export async function listAppRepositories(options: { force?: boolean } = {}): Promise<AppRepository[]> {
  if (!githubAppConfigured()) throw new Error('GitHub App credentials are not configured.');
  if (!options.force && repoCache && Date.now() - repoCache.at < REPO_CACHE_MS) return repoCache.repos;
  const app = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: process.env.GITHUB_APP_ID!.trim(), privateKey: normalizePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY!.trim()) },
  });
  const installations = await app.paginate(app.apps.listInstallations, { per_page: 100 });
  const repos: AppRepository[] = [];
  for (const installation of installations) {
    const octokit = createInstallationOctokit(String(installation.id));
    const list = await octokit.paginate(octokit.apps.listReposAccessibleToInstallation, { per_page: 100 });
    for (const r of list) {
      repos.push({
        installationId: String(installation.id),
        owner: r.owner.login,
        repo: r.name,
        fullName: r.full_name,
        defaultBranch: r.default_branch ?? 'main',
        private: r.private,
      });
    }
  }
  repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
  repoCache = { at: Date.now(), repos };
  return repos;
}
