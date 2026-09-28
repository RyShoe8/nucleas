import 'server-only';
import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { getIdeRepositoryAccess } from '@/lib/ai/ideCommitPush';
import { readTarGz } from './tar';

/**
 * A local copy of a project's repository at one commit: every text file, kept in our database so
 * the AI can search and read the whole codebase without a GitHub call per file (and without
 * GitHub search limits). Rebuilt when the default branch moves; the two newest copies are kept.
 */

/** Files bigger than this are listed but not stored (generated bundles, lockfiles, data dumps). */
const MAX_FILE_BYTES = 1024 * 1024;
/** How long a branch-head check is trusted before asking GitHub again. */
const HEAD_TTL_MS = 60_000;
const KEEP_SNAPSHOTS = 2;

const snapshotSchema = new Schema(
  {
    owner: { type: String, required: true },
    repo: { type: String, required: true },
    commit: { type: String, required: true },
    status: { type: String, enum: ['building', 'ready', 'failed'], required: true },
    fileCount: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    /** Paths present but not stored (binary or too large). */
    skipped: { type: [String], default: [] },
    error: { type: String },
  },
  { timestamps: true }
);
snapshotSchema.index({ owner: 1, repo: 1, commit: 1 }, { unique: true });

const fileSchema = new Schema(
  {
    snapshotId: { type: Schema.Types.ObjectId, required: true },
    path: { type: String, required: true },
    content: { type: String, required: true },
  },
  { timestamps: false }
);
fileSchema.index({ snapshotId: 1, path: 1 }, { unique: true });

type SnapshotDoc = InferSchemaType<typeof snapshotSchema>;
type FileDoc = InferSchemaType<typeof fileSchema>;
export const RepoSnapshot: Model<SnapshotDoc> =
  (mongoose.models.RepoSnapshot as Model<SnapshotDoc> | undefined) ?? mongoose.model<SnapshotDoc>('RepoSnapshot', snapshotSchema);
export const RepoSnapshotFile: Model<FileDoc> =
  (mongoose.models.RepoSnapshotFile as Model<FileDoc> | undefined) ?? mongoose.model<FileDoc>('RepoSnapshotFile', fileSchema);

export interface LoadedSnapshot {
  owner: string;
  repo: string;
  commit: string;
  branch: string;
  /** path → content, sorted by path. */
  files: Map<string, string>;
  skipped: string[];
}

// Per-instance caches: loaded file contents by snapshot, and the last known branch head.
const loaded = new Map<string, LoadedSnapshot>();
const heads = new Map<string, { commit: string; at: number }>();

function isText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8000));
  return !sample.includes(0);
}

async function loadFromDb(id: Types.ObjectId, meta: { owner: string; repo: string; commit: string; branch: string; skipped: string[] }): Promise<LoadedSnapshot> {
  const key = String(id);
  const cached = loaded.get(key);
  if (cached) return cached;
  const rows = await RepoSnapshotFile.find({ snapshotId: id }).select('path content').sort({ path: 1 }).lean<{ path: string; content: string }[]>();
  const snapshot: LoadedSnapshot = { ...meta, files: new Map(rows.map((r) => [r.path, r.content])) };
  // Keep a few repositories in memory at most.
  if (loaded.size >= 4) loaded.delete(loaded.keys().next().value!);
  loaded.set(key, snapshot);
  return snapshot;
}

export type SnapshotResult = { ok: true; snapshot: LoadedSnapshot } | { ok: false; reason: string };

/** The project's repository at the current default-branch commit, building the local copy if needed. */
export async function getRepoSnapshot(organizationId: string, projectId: Types.ObjectId): Promise<SnapshotResult> {
  if (mongoose.connection.readyState !== 1) return { ok: false, reason: 'No database connection for the local repository copy.' };
  const access = await getIdeRepositoryAccess(organizationId, projectId);
  if (!access.ok) return { ok: false, reason: access.reason };
  const { octokit, owner, repo, defaultBranch } = access;
  const repoKey = `${owner}/${repo}@${defaultBranch}`;

  let commit = heads.get(repoKey);
  if (!commit || Date.now() - commit.at > HEAD_TTL_MS) {
    try {
      const branch = await octokit.repos.getBranch({ owner, repo, branch: defaultBranch });
      commit = { commit: branch.data.commit.sha, at: Date.now() };
      heads.set(repoKey, commit);
    } catch {
      return { ok: false, reason: 'Unable to read the repository branch from GitHub.' };
    }
  }

  const existing = await RepoSnapshot.findOne({ owner, repo, commit: commit.commit }).lean<{ _id: Types.ObjectId; status: string; skipped?: string[]; updatedAt: Date }>();
  if (existing?.status === 'ready') {
    return { ok: true, snapshot: await loadFromDb(existing._id, { owner, repo, commit: commit.commit, branch: defaultBranch, skipped: existing.skipped ?? [] }) };
  }
  // Another request is building this commit: wait for it rather than downloading twice.
  if (existing?.status === 'building' && Date.now() - new Date(existing.updatedAt).getTime() < 5 * 60_000) {
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      const again = await RepoSnapshot.findById(existing._id).lean<{ status: string; skipped?: string[] }>();
      if (again?.status === 'ready') {
        return { ok: true, snapshot: await loadFromDb(existing._id, { owner, repo, commit: commit.commit, branch: defaultBranch, skipped: again.skipped ?? [] }) };
      }
      if (again?.status !== 'building') break;
    }
  }

  // Build: download the commit's archive once and store every text file.
  const snapshotDoc = await RepoSnapshot.findOneAndUpdate(
    { owner, repo, commit: commit.commit },
    { $set: { status: 'building', error: null } },
    { upsert: true, new: true }
  ).lean<{ _id: Types.ObjectId }>();
  try {
    const archive = await octokit.repos.downloadTarballArchive({ owner, repo, ref: commit.commit });
    const entries = readTarGz(new Uint8Array(archive.data as ArrayBuffer));
    const files: { path: string; content: string }[] = [];
    const skipped: string[] = [];
    let bytes = 0;
    for (const entry of entries) {
      if (entry.bytes.length > MAX_FILE_BYTES || !isText(entry.bytes)) {
        skipped.push(entry.path);
        continue;
      }
      const content = Buffer.from(entry.bytes).toString('utf8');
      files.push({ path: entry.path, content });
      bytes += entry.bytes.length;
    }
    await RepoSnapshotFile.deleteMany({ snapshotId: snapshotDoc!._id });
    for (let i = 0; i < files.length; i += 500) {
      await RepoSnapshotFile.insertMany(files.slice(i, i + 500).map((f) => ({ snapshotId: snapshotDoc!._id, ...f })), { ordered: false });
    }
    await RepoSnapshot.updateOne({ _id: snapshotDoc!._id }, { $set: { status: 'ready', fileCount: files.length, bytes, skipped: skipped.slice(0, 5000) } });
    // Drop older copies of this repository.
    const old = await RepoSnapshot.find({ owner, repo, _id: { $ne: snapshotDoc!._id } }).sort({ updatedAt: -1 }).skip(KEEP_SNAPSHOTS - 1).select('_id').lean<{ _id: Types.ObjectId }[]>();
    if (old.length) {
      await RepoSnapshotFile.deleteMany({ snapshotId: { $in: old.map((o) => o._id) } });
      await RepoSnapshot.deleteMany({ _id: { $in: old.map((o) => o._id) } });
      for (const o of old) loaded.delete(String(o._id));
    }
    const snapshot: LoadedSnapshot = {
      owner,
      repo,
      commit: commit.commit,
      branch: defaultBranch,
      files: new Map(files.sort((a, b) => a.path.localeCompare(b.path)).map((f) => [f.path, f.content])),
      skipped,
    };
    loaded.set(String(snapshotDoc!._id), snapshot);
    return { ok: true, snapshot };
  } catch (error) {
    await RepoSnapshot.updateOne({ _id: snapshotDoc!._id }, { $set: { status: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'failed' } });
    return { ok: false, reason: 'Unable to download the repository from GitHub.' };
  }
}

// ---------- Queries over a snapshot ----------

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
  before: string[];
  after: string[];
}

export interface SearchResult {
  matches: SearchMatch[];
  totalMatches: number;
  filesMatched: string[];
  truncated: boolean;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

/** Finds text (or a regular expression) across the repository, with line numbers and context. */
export function searchSnapshot(
  snapshot: LoadedSnapshot,
  input: { query: string; regex?: boolean; caseSensitive?: boolean; path?: string; glob?: string; maxResults?: number; contextLines?: number }
): SearchResult | { error: string } {
  const query = input.query;
  if (!query) return { error: 'query is required.' };
  let pattern: RegExp;
  try {
    pattern = input.regex
      ? new RegExp(query, input.caseSensitive ? '' : 'i')
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), input.caseSensitive ? '' : 'i');
  } catch {
    return { error: 'Invalid regular expression.' };
  }
  const prefix = (input.path ?? '').replace(/^\/+|\/+$/g, '');
  const glob = input.glob ? globToRegex(input.glob) : null;
  const max = Math.min(Math.max(input.maxResults ?? 40, 1), 200);
  const context = Math.min(Math.max(input.contextLines ?? 2, 0), 8);
  const matches: SearchMatch[] = [];
  const filesMatched: string[] = [];
  let total = 0;
  for (const [path, content] of snapshot.files) {
    if (prefix && !(path === prefix || path.startsWith(`${prefix}/`))) continue;
    if (glob && !glob.test(path) && !glob.test(path.split('/').pop() ?? '')) continue;
    if (!pattern.test(content)) continue;
    const lines = content.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    let inFile = 0;
    lines.forEach((text, i) => {
      if (!pattern.test(text)) return;
      total += 1;
      inFile += 1;
      if (matches.length < max) {
        matches.push({
          path,
          line: i + 1,
          text: text.slice(0, 400),
          before: lines.slice(Math.max(0, i - context), i).map((l) => l.slice(0, 400)),
          after: lines.slice(i + 1, i + 1 + context).map((l) => l.slice(0, 400)),
        });
      }
    });
    if (inFile) filesMatched.push(path);
  }
  return { matches, totalMatches: total, filesMatched: filesMatched.slice(0, 200), truncated: total > matches.length };
}

/** Immediate children of a folder ('' = root). */
export function listSnapshotDir(snapshot: LoadedSnapshot, dir: string): { path: string; type: 'file' | 'dir' }[] {
  const base = dir.replace(/^\/+|\/+$/g, '');
  const prefix = base ? `${base}/` : '';
  const seen = new Map<string, 'file' | 'dir'>();
  for (const path of [...snapshot.files.keys(), ...snapshot.skipped]) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    const name = slash === -1 ? rest : rest.slice(0, slash);
    if (!name) continue;
    const full = `${prefix}${name}`;
    if (slash !== -1) seen.set(full, 'dir');
    else if (!seen.has(full)) seen.set(full, 'file');
  }
  return [...seen.entries()]
    .map(([path, type]) => ({ path, type }))
    .sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.path.localeCompare(b.path)));
}
