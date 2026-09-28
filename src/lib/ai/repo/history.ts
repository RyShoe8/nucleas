import 'server-only';
import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { getIdeRepositoryAccess } from '@/lib/ai/ideCommitPush';

/**
 * What changed recently in a project's repository: commits with their messages, authors and files,
 * and any commit's diff. Commits never change, so each is fetched from GitHub once and kept.
 */

const commitSchema = new Schema(
  {
    owner: { type: String, required: true },
    repo: { type: String, required: true },
    sha: { type: String, required: true },
    message: { type: String, default: '' },
    author: { type: String, default: '' },
    date: { type: Date },
    files: {
      type: [{ path: String, status: String, additions: Number, deletions: Number, patch: String, _id: false }],
      default: [],
    },
  },
  { timestamps: false }
);
commitSchema.index({ owner: 1, repo: 1, sha: 1 }, { unique: true });
type CommitDoc = InferSchemaType<typeof commitSchema>;
export const RepoCommit: Model<CommitDoc> =
  (mongoose.models.RepoCommit as Model<CommitDoc> | undefined) ?? mongoose.model<CommitDoc>('RepoCommit', commitSchema);

export interface CommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface CommitView {
  sha: string;
  message: string;
  author: string;
  date: string | null;
  files: CommitFile[];
}

type Access = Extract<Awaited<ReturnType<typeof getIdeRepositoryAccess>>, { ok: true }>;

async function commitDetail(access: Access, sha: string): Promise<CommitView> {
  const { owner, repo, octokit } = access;
  const cached = mongoose.connection.readyState === 1 ? await RepoCommit.findOne({ owner, repo, sha }).lean<CommitDoc>() : null;
  if (cached) {
    return { sha, message: cached.message, author: cached.author, date: cached.date ? new Date(cached.date).toISOString() : null, files: (cached.files ?? []) as CommitFile[] };
  }
  const { data } = await octokit.repos.getCommit({ owner, repo, ref: sha });
  const view: CommitView = {
    sha: data.sha,
    message: data.commit.message.slice(0, 4000),
    author: data.commit.author?.name ?? data.author?.login ?? '',
    date: data.commit.author?.date ?? null,
    files: (data.files ?? []).slice(0, 300).map((f) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      ...(f.patch ? { patch: f.patch.slice(0, 60_000) } : {}),
    })),
  };
  if (mongoose.connection.readyState === 1) {
    await RepoCommit.updateOne(
      { owner, repo, sha: view.sha },
      { $setOnInsert: { message: view.message, author: view.author, date: view.date ? new Date(view.date) : undefined, files: view.files } },
      { upsert: true }
    ).catch(() => undefined);
  }
  return view;
}

export type HistoryResult = { ok: true; branch: string; commits: CommitView[] } | { ok: false; reason: string };

/** The newest commits on the default branch (optionally only those touching a path), with changed files. */
export async function recentCommits(
  organizationId: string,
  projectId: Types.ObjectId,
  input: { count?: number; path?: string; withPatches?: boolean }
): Promise<HistoryResult> {
  const access = await getIdeRepositoryAccess(organizationId, projectId);
  if (!access.ok) return { ok: false, reason: access.reason };
  const count = Math.min(Math.max(input.count ?? 20, 1), 50);
  try {
    const { data } = await access.octokit.repos.listCommits({
      owner: access.owner,
      repo: access.repo,
      sha: access.defaultBranch,
      per_page: count,
      ...(input.path ? { path: input.path } : {}),
    });
    const commits: CommitView[] = [];
    for (const c of data) {
      const detail = await commitDetail(access, c.sha);
      commits.push(input.withPatches ? detail : { ...detail, files: detail.files.map(({ patch: _patch, ...f }) => f) });
    }
    return { ok: true, branch: access.defaultBranch, commits };
  } catch {
    return { ok: false, reason: 'Unable to read the commit history from GitHub.' };
  }
}

/** One commit's diff. */
export async function commitWithDiff(organizationId: string, projectId: Types.ObjectId, sha: string): Promise<{ ok: true; commit: CommitView } | { ok: false; reason: string }> {
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) return { ok: false, reason: 'Give a commit SHA from repo_history.' };
  const access = await getIdeRepositoryAccess(organizationId, projectId);
  if (!access.ok) return { ok: false, reason: access.reason };
  try {
    return { ok: true, commit: await commitDetail(access, sha) };
  } catch {
    return { ok: false, reason: 'Commit not found.' };
  }
}
