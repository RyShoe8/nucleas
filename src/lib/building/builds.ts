import 'server-only';
import { Types } from 'mongoose';
import { BuildRequest, type BuildStatus } from '@/lib/models/BuildRequest';
import { AiIdeExecutionArtifact } from '@/lib/models/AiIdeExecutionArtifact';
import { AiProjectRepository } from '@/lib/models/AiProjectRepository';
import { getCompanyProfile, isCompanyManager, listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import { attemptOrchestratedIdeReply, BUILD_METHOD } from '@/lib/ai/teamChat';
import { getRepoSnapshot } from '@/lib/ai/repo/snapshot';
import { projectGuide } from '@/lib/ai/repo/projectGuide';
import { executeInRemoteSandbox } from '@/lib/ai/executionWorkerClient';
import { createInstallationOctokit } from '@/lib/ai/githubAppClient';
import { readEngineSettings, selectModel, type CostLevel, type ModelChoice } from '@/lib/ai/engine/select';
import { listAvailableModels, priceTokens } from '@/lib/ai/engine/catalog';
import { gatewayFromModelProfile } from '@/lib/ai/rolePipeline/profiles';
import { AiRun } from '@/lib/models/AiControl';
import { resolveCompanyRepository } from './companyCode';
import { applyFilePatch, parsePatch, PatchError } from './applyPatch';

/**
 * Building: code changes from plan to pull request, across every company.
 * Ask proposes a plan; a manager approves (optionally after editing), rejects or discards it;
 * approved plans queue and build in the isolated build service; a manager opens the pull request.
 */

const OPEN_STATUSES: BuildStatus[] = ['proposed', 'queued', 'building', 'ready', 'failed'];
/** Longest a build may run before the sweep marks it failed (the build service stops at 4 minutes). */
const BUILD_TIMEOUT_MS = 12 * 60 * 1000;

export interface BuildView {
  id: string;
  companyId: string;
  companyName: string;
  status: BuildStatus;
  request: string;
  title: string;
  summary: string;
  steps: string[];
  planMarkdown: string;
  repository: { owner: string; repo: string; defaultBranch: string; fullName: string };
  level: CostLevel | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: number;
  result: {
    outcome: 'completed' | 'blocked' | 'failed' | null;
    summary: string | null;
    changedFiles: string[];
    checks: { command: string; exitCode: number | null; timedOut: boolean }[];
    limitations: string[];
    model: string | null;
    engineModel: boolean;
    costMicros: number | null;
  } | null;
  error: string | null;
  pullRequest: { url: string; number: number; branch: string } | null;
  canManage: boolean;
}

type BuildDoc = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  companyId: Types.ObjectId;
  projectId: Types.ObjectId;
  createdByUserId: Types.ObjectId;
  approvedByUserId?: Types.ObjectId;
  status: BuildStatus;
  request: string;
  title: string;
  summary?: string;
  steps?: string[];
  events?: { at: Date; action: string; note?: string }[];
  planMarkdown: string;
  repository: { owner: string; repo: string; defaultBranch: string };
  level?: CostLevel;
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  attempts?: number;
  result?: {
    artifactId?: Types.ObjectId;
    outcome?: 'completed' | 'blocked' | 'failed';
    summary?: string;
    baseCommit?: string;
    changedFiles?: string[];
    checks?: { command: string; exitCode: number | null; timedOut: boolean }[];
    limitations?: string[];
    model?: string;
    engineModel?: boolean;
    costMicros?: number;
  };
  error?: string;
  pullRequest?: { url?: string; number?: number; branch?: string };
};

function toView(doc: BuildDoc, companyName: string, canManage: boolean): BuildView {
  const r = doc.result;
  return {
    id: String(doc._id),
    companyId: String(doc.companyId),
    companyName,
    status: doc.status,
    request: doc.request,
    title: doc.title,
    summary: doc.summary ?? '',
    steps: doc.steps ?? [],
    planMarkdown: doc.planMarkdown,
    repository: { ...doc.repository, fullName: `${doc.repository.owner}/${doc.repository.repo}` },
    level: doc.level ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    approvedAt: doc.approvedAt?.toISOString() ?? null,
    startedAt: doc.startedAt?.toISOString() ?? null,
    finishedAt: doc.finishedAt?.toISOString() ?? null,
    attempts: doc.attempts ?? 0,
    result: r?.outcome || r?.summary
      ? {
          outcome: r.outcome ?? null,
          summary: r.summary ?? null,
          changedFiles: r.changedFiles ?? [],
          checks: r.checks ?? [],
          limitations: r.limitations ?? [],
          model: r.model ?? null,
          engineModel: Boolean(r.engineModel),
          costMicros: r.costMicros ?? null,
        }
      : null,
    error: doc.error ?? null,
    pullRequest: doc.pullRequest?.url ? { url: doc.pullRequest.url, number: doc.pullRequest.number ?? 0, branch: doc.pullRequest.branch ?? '' } : null,
    canManage,
  };
}

function event(viewer: CompanyViewer | null, action: string, note?: string) {
  return { at: new Date(), userId: viewer ? new Types.ObjectId(viewer.userId) : undefined, action, ...(note ? { note: note.slice(0, 500) } : {}) };
}

// ---------- Reading ----------

export async function listBuilds(viewer: CompanyViewer, options: { includeClosed?: boolean } = {}): Promise<BuildView[]> {
  const companies = await listCompanyProfiles(viewer);
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const rows = await BuildRequest.find({
    organizationId: viewer.organizationId,
    companyId: { $in: companies.map((c) => new Types.ObjectId(c.id)) },
    ...(options.includeClosed ? {} : { status: { $in: [...OPEN_STATUSES, 'pr_opened'] } }),
  })
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean<BuildDoc[]>();
  const canManage = isCompanyManager(viewer);
  return rows.map((r) => toView(r, names.get(String(r.companyId)) ?? 'Company', canManage));
}

export async function getBuild(viewer: CompanyViewer, id: string): Promise<BuildView | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await BuildRequest.findOne({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }).lean<BuildDoc>();
  if (!doc) return null;
  const profile = await getCompanyProfile(viewer, String(doc.companyId));
  if (!profile) return null;
  return toView(doc, profile.name, isCompanyManager(viewer));
}

// ---------- Proposing (from Ask) ----------

/** Earlier plans people turned down, with why, so the next plan does not simply repeat them. */
export function renderRejectedPlans(rows: Pick<BuildDoc, 'title' | 'summary' | 'request' | 'events'>[]): string {
  if (!rows.length) return '';
  const lines = rows.map((row) => {
    const reason = [...(row.events ?? [])].reverse().find((e) => e.action === 'rejected' && e.note)?.note;
    return `- "${row.title}" (${(row.summary || row.request).replace(/\s+/g, ' ').slice(0, 200)})${reason ? ` — rejected because: ${reason}` : ' — rejected, no reason recorded'}`;
  });
  return ['Plans already rejected for this company. Do not propose the same fix again unless your plan says what is different and why it now works:', ...lines].join('\n');
}

export type ProposeResult =
  | { ok: true; build: BuildView; costMicros: number }
  | { ok: false; reason: 'no_repository' | 'no_plan'; message: string; costMicros: number };

/**
 * Plans a code change for a company by reading its repository (the same planner → worker →
 * reviewer run the IDE uses in Plan mode), and records the plan for approval.
 */
export async function proposeCodeChange(
  viewer: CompanyViewer,
  input: { companyId: string; request: string; level: CostLevel; signal?: AbortSignal; onProgress?: (text: string) => void }
): Promise<ProposeResult> {
  const target = await resolveCompanyRepository(viewer, input.companyId);
  if (!target) {
    return { ok: false, reason: 'no_repository', costMicros: 0, message: 'This company has no GitHub repository connected. Connect one in its Integrations window (Code repository), then ask again.' };
  }
  // The planner also sees what changed recently for the company (commits, builds, actions).
  const { companyTimeline, renderTimeline } = await import('@/lib/companies/activityLog');
  const recent = await companyTimeline(viewer, input.companyId, { limit: 15 }).catch(() => null);
  const rejected = renderRejectedPlans(
    await BuildRequest.find({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(input.companyId), status: { $in: ['rejected', 'discarded'] } })
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean<BuildDoc[]>()
      .catch(() => [] as BuildDoc[])
  );
  const background = [recent?.length ? renderTimeline(recent) : '', rejected].filter(Boolean).join('\n\n');
  // With a test account for the site the request names, look at the page as it is now (read-only, time-boxed).
  const startedAt = Date.now();
  const { observePageForRequest } = await import('@/lib/companies/testAccount');
  const observedPage = await observePageForRequest(viewer, input.companyId, input.request, { signal: input.signal, onProgress: input.onProgress }).catch(() => null);
  const turn = await attemptOrchestratedIdeReply({
    projectName: target.projectName,
    ...(background ? { contextBlock: background } : {}),
    onProgress: input.onProgress,
    organizationId: String(viewer.organizationId),
    projectId: target.projectId,
    userId: viewer.userId,
    userText: input.request,
    priorTurns: [],
    interactionMode: 'plan',
    level: input.level,
    signal: input.signal,
    // The Ask route is cut off at 300 s; leave time for classifying the request and saving the result.
    budgetMs: 225_000 - (Date.now() - startedAt),
    ...(observedPage ? { observedPage } : {}),
  });
  const costMicros = turn.costMicros ?? 0;
  if (!turn.plan) {
    return { ok: false, reason: 'no_plan', costMicros, message: turn.text || 'The planner did not produce a plan.' };
  }
  const doc = await BuildRequest.create({
    organizationId: viewer.organizationId,
    companyId: new Types.ObjectId(input.companyId),
    projectId: target.projectId,
    createdByUserId: new Types.ObjectId(viewer.userId),
    status: 'proposed',
    request: input.request.slice(0, 6000),
    title: (turn.plan.title || 'Code change').slice(0, 200),
    summary: (turn.plan.summary || '').slice(0, 2000),
    steps: turn.plan.steps.slice(0, 40).map((s) => s.slice(0, 500)),
    planMarkdown: turn.plan.markdown.slice(0, 40_000),
    repository: { owner: target.repository.owner, repo: target.repository.repo, defaultBranch: target.repository.defaultBranch },
    level: input.level,
    planCostMicros: costMicros,
    events: [event(viewer, 'proposed')],
  });
  const profile = await getCompanyProfile(viewer, input.companyId);
  return { ok: true, costMicros, build: toView(doc.toObject() as unknown as BuildDoc, profile?.name ?? 'Company', isCompanyManager(viewer)) };
}

export async function linkAssistantTurn(buildId: string, turnId: Types.ObjectId): Promise<void> {
  await BuildRequest.updateOne({ _id: new Types.ObjectId(buildId) }, { $set: { assistantTurnId: turnId } });
}

// ---------- Human decisions ----------

export type ActionResult = { ok: true; build: BuildView } | { ok: false; status: 400 | 403 | 404 | 409 | 502; error: string };

async function managed(viewer: CompanyViewer, id: string): Promise<{ ok: true; doc: BuildDoc } | { ok: false; status: 403 | 404; error: string }> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can act on builds.' };
  if (!Types.ObjectId.isValid(id)) return { ok: false, status: 404, error: 'Build not found.' };
  const doc = await BuildRequest.findOne({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }).lean<BuildDoc>();
  if (!doc || !(await getCompanyProfile(viewer, String(doc.companyId)))) return { ok: false, status: 404, error: 'Build not found.' };
  return { ok: true, doc };
}

/** Moves a build between states only from the expected ones, so double clicks and races do nothing. */
async function transition(
  viewer: CompanyViewer,
  id: string,
  from: BuildStatus[],
  set: Record<string, unknown>,
  action: string,
  note?: string
): Promise<ActionResult> {
  const found = await managed(viewer, id);
  if (!found.ok) return found;
  const updated = await BuildRequest.findOneAndUpdate(
    { _id: found.doc._id, status: { $in: from } },
    { $set: set, $push: { events: event(viewer, action, note) } },
    { new: true }
  ).lean<BuildDoc>();
  if (!updated) return { ok: false, status: 409, error: `This build is ${found.doc.status.replace('_', ' ')}; it cannot be ${action} now.` };
  const view = await getBuild(viewer, id);
  return view ? { ok: true, build: view } : { ok: false, status: 404, error: 'Build not found.' };
}

export function editPlan(viewer: CompanyViewer, id: string, input: { title?: string; planMarkdown: string }): Promise<ActionResult> {
  const plan = input.planMarkdown.trim();
  if (plan.length < 10 || plan.length > 40_000) return Promise.resolve({ ok: false, status: 400, error: 'The plan must be 10–40,000 characters.' });
  return transition(viewer, id, ['proposed'], { planMarkdown: plan, ...(input.title?.trim() ? { title: input.title.trim().slice(0, 200) } : {}) }, 'edited');
}

/** Approve (optionally with an edited plan) into the build queue. */
export function approveBuild(viewer: CompanyViewer, id: string, input: { planMarkdown?: string } = {}): Promise<ActionResult> {
  const plan = input.planMarkdown?.trim();
  if (plan !== undefined && (plan.length < 10 || plan.length > 40_000)) return Promise.resolve({ ok: false, status: 400, error: 'The plan must be 10–40,000 characters.' });
  return transition(
    viewer,
    id,
    ['proposed'],
    { status: 'queued', approvedByUserId: new Types.ObjectId(viewer.userId), approvedAt: new Date(), ...(plan ? { planMarkdown: plan } : {}) },
    'approved'
  );
}

export function rejectBuild(viewer: CompanyViewer, id: string, reason?: string): Promise<ActionResult> {
  return transition(viewer, id, ['proposed'], { status: 'rejected', finishedAt: new Date() }, 'rejected', reason);
}

export function retryBuild(viewer: CompanyViewer, id: string): Promise<ActionResult> {
  return transition(viewer, id, ['failed', 'ready'], { status: 'queued', error: null, startedAt: null, finishedAt: null }, 'retried');
}

export function discardBuild(viewer: CompanyViewer, id: string): Promise<ActionResult> {
  return transition(viewer, id, ['queued', 'failed', 'ready'], { status: 'discarded', finishedAt: new Date() }, 'discarded');
}

// ---------- Running ----------

export function buildTask(doc: Pick<BuildDoc, 'title' | 'planMarkdown'>, guide = ''): string {
  const header = `Approved plan: "${doc.title}"\nBuild this plan in the isolated disposable repository, run focused verification, and return the proposed patch and evidence. Never commit, push, or deploy; publishing requires separate review and approval.\n\n${BUILD_METHOD}`;
  // The build service takes up to 12,000 characters: the plan comes first, the guide fills what is left.
  const planRoom = 11_800 - header.length;
  const plan = doc.planMarkdown.length > planRoom ? `${doc.planMarkdown.slice(0, planRoom - 40)}\n\n[...plan continues...]` : doc.planMarkdown;
  const guideRoom = 11_800 - header.length - plan.length - 40;
  const guideText = guide && guideRoom > 500 ? `\n\nProject guide (excerpt):\n${guide.slice(0, guideRoom)}` : '';
  return `${header}\n\n${plan}${guideText}`;
}

/**
 * The model a build uses: the AI engine's code pick at the plan's cost level (the organization
 * default when unset). A rebuild at medium moves to the level's paid retry model, as medium does
 * everywhere else when the free model fails.
 */
async function buildModel(doc: BuildDoc): Promise<{ choice: ModelChoice; provider?: string; inference: { endpoint: string; bearerToken: string; model: string } } | null> {
  const org = String(doc.organizationId);
  const [models, settings] = await Promise.all([listAvailableModels(), readEngineSettings(org)]);
  const pick = await selectModel(org, 'code', doc.level ?? settings.defaultCostLevel, { models, settings });
  const choice = (doc.attempts ?? 0) >= 2 && pick.fallback ? pick.fallback : pick.primary;
  if (!choice) return null;
  const { gateway } = await gatewayFromModelProfile(choice.profileId, choice.model);
  const provider = models.find((m) => m.profileId === choice.profileId && m.model === choice.model)?.provider;
  return { choice, provider, inference: { endpoint: gateway.endpoint, bearerToken: gateway.bearerToken ?? '', model: choice.model } };
}

/** Records a build in the AI run ledger so it counts in AI Spend (by project). */
async function recordBuildRun(doc: BuildDoc, input: { model: string; ok: boolean; inputTokens?: number; outputTokens?: number; costMicros: number | null }) {
  await AiRun.create({
    organizationId: String(doc.organizationId),
    projectId: doc.projectId,
    role: 'worker',
    status: input.ok ? 'completed' : 'failed',
    model: input.model,
    inputDigest: `build:${String(doc._id)}:${doc.attempts ?? 1}`,
    policyDigest: 'building',
    createdByUserId: doc.approvedByUserId ?? doc.createdByUserId,
    startedAt: doc.startedAt,
    completedAt: new Date(),
    ...(input.inputTokens !== undefined ? { inputTokens: input.inputTokens, outputTokens: input.outputTokens } : {}),
    ...(input.costMicros !== null ? { costMicros: input.costMicros } : {}),
  }).catch(() => undefined);
}

/** Claims a queued build and runs it in the build service. Safe to call more than once. */
export async function runBuild(id: string): Promise<void> {
  const doc = await BuildRequest.findOneAndUpdate(
    { _id: new Types.ObjectId(id), status: 'queued' },
    { $set: { status: 'building', startedAt: new Date(), error: null }, $inc: { attempts: 1 }, $push: { events: event(null, 'started') } },
    { new: true }
  ).lean<BuildDoc>();
  if (!doc) return;
  const fail = (message: string) =>
    BuildRequest.updateOne(
      { _id: doc._id, status: 'building' },
      { $set: { status: 'failed', error: message.slice(0, 1000), finishedAt: new Date() }, $push: { events: event(null, 'failed', message) } }
    );
  try {
    const model = await buildModel(doc).catch(() => null);
    const snap = await getRepoSnapshot(String(doc.organizationId), doc.projectId).catch(() => null);
    const result = await executeInRemoteSandbox({
      organizationId: String(doc.organizationId),
      projectId: doc.projectId,
      userId: String(doc.approvedByUserId ?? doc.createdByUserId),
      task: buildTask(doc, snap?.ok ? projectGuide(snap.snapshot, 4000) : ''),
      ...(model ? { inference: model.inference } : {}),
    });
    if (!result) {
      await fail('The build service is not configured on the server (execution worker URL and token).');
      return;
    }
    const succeeded = result.status === 'completed' && result.changedFiles.length > 0;
    const engineModel = Boolean(result.usedEngineModel && model);
    const costMicros =
      engineModel && model && result.usage
        ? await priceTokens({ model: model.choice.model, provider: model.provider, free: model.choice.free, ...result.usage })
        : null;
    await recordBuildRun(doc, { model: result.routing.requestedModel, ok: succeeded, ...(result.usage ?? {}), costMicros });
    await BuildRequest.updateOne(
      { _id: doc._id, status: 'building' },
      {
        $set: {
          status: succeeded ? 'ready' : 'failed',
          finishedAt: new Date(),
          error: succeeded ? null : result.status === 'completed' ? 'The build finished without changing any files.' : `The build ${result.status}.`,
          result: {
            artifactId: new Types.ObjectId(result.artifactId),
            outcome: result.status,
            summary: result.summary,
            baseCommit: result.baseCommit,
            changedFiles: result.changedFiles,
            checks: result.evidence.map((e) => ({ command: e.command.join(' ').slice(0, 300), exitCode: e.exitCode, timedOut: e.timedOut })),
            limitations: result.limitations,
            model: result.routing.requestedModel,
            engineModel,
            ...(result.usage ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } : {}),
            ...(costMicros !== null ? { costMicros } : {}),
          },
        },
        $push: { events: event(null, succeeded ? 'built' : 'failed') },
      }
    );
  } catch (error) {
    await fail(error instanceof Error ? error.message : 'The build failed.');
  }
}

/** Cron: starts builds that are still waiting (e.g. the approving request ended early) and times out stuck ones. */
export async function sweepBuilds(options: { maxToStart?: number } = {}): Promise<{ started: number; timedOut: number }> {
  const stuck = await BuildRequest.updateMany(
    { status: 'building', startedAt: { $lt: new Date(Date.now() - BUILD_TIMEOUT_MS) } },
    { $set: { status: 'failed', error: 'The build timed out.', finishedAt: new Date() }, $push: { events: event(null, 'timed_out') } }
  );
  const waiting = await BuildRequest.find({ status: 'queued', updatedAt: { $lt: new Date(Date.now() - 60_000) } })
    .sort({ approvedAt: 1 })
    .limit(options.maxToStart ?? 1)
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>();
  for (const w of waiting) await runBuild(String(w._id));
  return { started: waiting.length, timedOut: stuck.modifiedCount ?? 0 };
}

// ---------- Pull request ----------

/** Stored patches come back from lean queries as BSON Binary, not Buffer. */
function patchText(stored: unknown): string {
  if (Buffer.isBuffer(stored)) return stored.toString('utf8');
  const binary = stored as { buffer?: Uint8Array } | null;
  return binary?.buffer ? Buffer.from(binary.buffer).toString('utf8') : '';
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'change';
}

function prBody(doc: BuildDoc): string {
  const checks = (doc.result?.checks ?? []).map((c) => `- \`${c.command}\` → ${c.timedOut ? 'timed out' : `exit ${c.exitCode}`}`).join('\n');
  return [
    doc.summary || doc.request,
    '',
    '## Plan',
    doc.planMarkdown.slice(0, 20_000),
    '',
    '## Build',
    doc.result?.summary ?? '',
    checks ? `\n### Checks\n${checks}` : '',
    doc.result?.limitations?.length ? `\n### Limitations\n${doc.result.limitations.map((l) => `- ${l}`).join('\n')}` : '',
    '',
    '_Opened by Nucleas from an approved plan. Review before merging._',
  ].join('\n');
}

/** Applies the build's patch on a new branch from its base commit and opens a pull request. */
export async function openPullRequest(viewer: CompanyViewer, id: string): Promise<ActionResult> {
  const found = await managed(viewer, id);
  if (!found.ok) return found;
  const doc = found.doc;
  if (doc.status !== 'ready') return { ok: false, status: 409, error: 'Only a finished build can become a pull request.' };
  const binding = await AiProjectRepository.findOne({ organizationId: String(viewer.organizationId), projectId: doc.projectId })
    .select('installationId')
    .lean<{ installationId?: string | null }>();
  if (!binding?.installationId) return { ok: false, status: 400, error: 'The GitHub App is not connected to this repository.' };
  const artifact = doc.result?.artifactId
    ? await AiIdeExecutionArtifact.findById(doc.result.artifactId).select('+patch baseCommit').lean<{ patch: unknown; baseCommit: string }>()
    : null;
  if (!artifact) return { ok: false, status: 409, error: 'The build result has expired. Retry the build.' };

  const { owner, repo, defaultBranch } = doc.repository;
  try {
    const octokit = createInstallationOctokit(binding.installationId);
    const files = parsePatch(patchText(artifact.patch));
    if (!files.length) return { ok: false, status: 409, error: 'The build produced no applicable changes.' };
    const base = await octokit.git.getCommit({ owner, repo, commit_sha: artifact.baseCommit });
    const baseTree = await octokit.git.getTree({ owner, repo, tree_sha: base.data.tree.sha, recursive: 'true' });
    const modes = new Map(baseTree.data.tree.map((t) => [t.path ?? '', t.mode ?? '100644']));

    const entries: { path: string; mode: '100644' | '100755'; type: 'blob'; sha: string | null }[] = [];
    for (const file of files) {
      let original: string | null = null;
      if (file.kind !== 'add') {
        const content = await octokit.repos.getContent({ owner, repo, path: file.path, ref: artifact.baseCommit });
        if (Array.isArray(content.data) || !('content' in content.data)) throw new PatchError(`${file.path} is not a file at the base commit.`);
        original = Buffer.from(content.data.content, 'base64').toString('utf8');
      }
      const next = applyFilePatch(original, file);
      const mode = modes.get(file.path) === '100755' ? '100755' : '100644';
      if (next === null) {
        entries.push({ path: file.path, mode, type: 'blob', sha: null });
      } else {
        const blob = await octokit.git.createBlob({ owner, repo, content: Buffer.from(next, 'utf8').toString('base64'), encoding: 'base64' });
        entries.push({ path: file.path, mode, type: 'blob', sha: blob.data.sha });
      }
    }
    const tree = await octokit.git.createTree({ owner, repo, base_tree: base.data.tree.sha, tree: entries });
    const commit = await octokit.git.createCommit({ owner, repo, message: `${doc.title}\n\nBuilt by Nucleas from an approved plan.`, tree: tree.data.sha, parents: [artifact.baseCommit] });
    const branch = `nucleas/${slug(doc.title)}-${String(doc._id).slice(-6)}`;
    await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.data.sha });
    const pr = await octokit.pulls.create({ owner, repo, head: branch, base: defaultBranch, title: doc.title, body: prBody(doc) });
    const updated = await BuildRequest.findOneAndUpdate(
      { _id: doc._id, status: 'ready' },
      { $set: { status: 'pr_opened', pullRequest: { url: pr.data.html_url, number: pr.data.number, branch } }, $push: { events: event(viewer, 'pr_opened', pr.data.html_url) } },
      { new: true }
    ).lean<BuildDoc>();
    if (!updated) return { ok: false, status: 409, error: 'This build changed while the pull request was being opened.' };
    const view = await getBuild(viewer, id);
    return view ? { ok: true, build: view } : { ok: false, status: 404, error: 'Build not found.' };
  } catch (error) {
    const message = error instanceof PatchError ? error.message : error instanceof Error ? `GitHub: ${error.message}` : 'Could not open the pull request.';
    await BuildRequest.updateOne({ _id: doc._id }, { $push: { events: event(viewer, 'pr_failed', message) } });
    return { ok: false, status: 502, error: message };
  }
}
