import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  execute: vi.fn(),
  octokit: vi.fn(),
}));
vi.mock('@/lib/ai/teamChat', () => ({ attemptOrchestratedIdeReply: (...args: unknown[]) => mocks.plan(...args), BUILD_METHOD: 'How to work.' }));
vi.mock('@/lib/ai/executionWorkerClient', () => ({ executeInRemoteSandbox: (...args: unknown[]) => mocks.execute(...args) }));
vi.mock('@/lib/ai/githubAppClient', () => ({
  createInstallationOctokit: () => mocks.octokit(),
  listAppRepositories: async () => [
    { installationId: '42', owner: 'RyShoe8', repo: 'playbound', fullName: 'RyShoe8/playbound', defaultBranch: 'main', private: true },
  ],
}));
vi.mock('@/lib/ai/githubPublish', () => ({ githubAppConfigured: () => true }));

import Client from '@/lib/models/Client';
import Project from '@/lib/models/Project';
import { AiProjectRepository } from '@/lib/models/AiProjectRepository';
import { AiIdeExecutionArtifact } from '@/lib/models/AiIdeExecutionArtifact';
import { BuildRequest } from '@/lib/models/BuildRequest';
import { AiModelProfile } from '@/lib/models/AiModelProfile';
import { AiRun } from '@/lib/models/AiControl';
import { AiModelCatalogSnapshot, AiPricingRegistryCache } from '@/lib/ai/engine/catalog';
import { encryptModelSecret } from '@/lib/ai/modelSecrets';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { getCompanyCode, setProjectRepository } from './companyCode';
import { approveBuild, editPlan, getBuild, listBuilds, openPullRequest, proposeCodeChange, rejectBuild, runBuild, sweepBuilds } from './builds';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
const admin: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: org, employeeId: null, role: 'Administrator' };
const member: CompanyViewer = { ...admin, userId: String(new Types.ObjectId()), role: 'User' };
let companyId: string;
let projectId: Types.ObjectId;

const PLAN = { title: 'Add a FAQ page', summary: 'A static FAQ page linked from the footer.', steps: ['Add route', 'Link footer'], markdown: '## Plan\n1. Add route\n2. Link footer', status: 'ready_for_review' };

beforeAll(async () => {
  process.env.AI_MODEL_SECRETS_KEY ??= 'test-secret';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_building_test'));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([Client.deleteMany({}), Project.deleteMany({}), AiProjectRepository.deleteMany({}), BuildRequest.deleteMany({}), AiIdeExecutionArtifact.deleteMany({}), AiModelProfile.deleteMany({}), AiModelCatalogSnapshot.deleteMany({}), AiRun.deleteMany({})]);
  const project = await Project.create({ name: 'Playbound.club', projectType: 'internal', category: 'website', status: 'launched', color: '#222', userId: new Types.ObjectId() });
  const company = await Client.create({ organizationId: org, name: 'Playbound.club', color: '#222', relationship: 'owned', domain: 'playbound.club', hubProjectId: project._id });
  await Project.updateOne({ _id: project._id }, { $set: { clientId: company._id } });
  companyId = String(company._id);
  projectId = project._id;
  mocks.plan.mockResolvedValue({ requestId: 'p', role: 'assistant', text: 'Planned.', costMicros: 1200, plan: PLAN });
});

async function connectRepo() {
  const result = await setProjectRepository(admin, companyId, { projectId: String(projectId), fullName: 'RyShoe8/playbound' });
  expect(result).toEqual({ ok: true });
}

async function proposed() {
  await connectRepo();
  const result = await proposeCodeChange(admin, { companyId, request: 'Add a FAQ page', level: 'low' });
  if (!result.ok) throw new Error(result.message);
  return result.build;
}

describe('company code repositories', () => {
  it('connects only repositories the GitHub App can reach, and only for managers', async () => {
    expect((await getCompanyCode(admin, companyId))?.projects[0].repository).toBeNull();
    expect(await setProjectRepository(member, companyId, { projectId: String(projectId), fullName: 'RyShoe8/playbound' })).toMatchObject({ ok: false, status: 403 });
    expect(await setProjectRepository(admin, companyId, { projectId: String(projectId), fullName: 'someone/else' })).toMatchObject({ ok: false, status: 400 });
    await connectRepo();
    const code = await getCompanyCode(admin, companyId);
    expect(code?.projects[0].repository).toEqual({ owner: 'RyShoe8', repo: 'playbound', fullName: 'RyShoe8/playbound', defaultBranch: 'main', appConnected: true });
  });
});

describe('proposing and deciding', () => {
  it('needs a connected repository, and records a plan read from it', async () => {
    const none = await proposeCodeChange(admin, { companyId, request: 'Add a FAQ page', level: 'low' });
    expect(none).toMatchObject({ ok: false, reason: 'no_repository' });
    expect(mocks.plan).not.toHaveBeenCalled();

    const build = await proposed();
    expect(build).toMatchObject({ status: 'proposed', title: 'Add a FAQ page', companyName: 'Playbound.club', repository: { fullName: 'RyShoe8/playbound' } });
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({ interactionMode: 'plan', projectId, level: 'low' }));
  });

  it('persists a Free Orchestrated proposal after the planner succeeds', async () => {
    await connectRepo();
    const result = await proposeCodeChange(admin, { companyId, request: 'Remove a duplicate game listing', level: 'free' });

    expect(result).toMatchObject({ ok: true, build: { status: 'proposed', level: 'free' } });
    expect(await BuildRequest.findById(result.ok ? result.build.id : null).lean()).toMatchObject({ level: 'free' });
  });

  it('reports planner failures instead of creating a build', async () => {
    await connectRepo();
    mocks.plan.mockResolvedValue({ requestId: 'p', role: 'status', text: 'Repository is unavailable.', costMicros: 0 });
    expect(await proposeCodeChange(admin, { companyId, request: 'x change', level: 'low' })).toMatchObject({ ok: false, reason: 'no_plan', message: 'Repository is unavailable.' });
    expect(await BuildRequest.countDocuments()).toBe(0);
  });

  it('only managers decide; approve (with edits) queues once; rejected plans stay rejected', async () => {
    const build = await proposed();
    expect(await approveBuild(member, build.id)).toMatchObject({ ok: false, status: 403 });
    expect(await editPlan(admin, build.id, { planMarkdown: '## Edited plan\nOnly the footer link.' })).toMatchObject({ ok: true, build: { status: 'proposed', planMarkdown: '## Edited plan\nOnly the footer link.' } });
    const [first, second] = await Promise.all([approveBuild(admin, build.id), approveBuild(admin, build.id)]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect((await getBuild(admin, build.id))?.status).toBe('queued');

    const other = await proposed();
    expect(await rejectBuild(admin, other.id, 'not now')).toMatchObject({ ok: true, build: { status: 'rejected' } });
    expect(await approveBuild(admin, other.id)).toMatchObject({ ok: false, status: 409 });
    expect((await listBuilds(admin)).map((b) => b.id)).toEqual([build.id]);
    expect((await listBuilds(admin, { includeClosed: true })).length).toBe(2);
  });
});

describe('running builds', () => {
  async function queued() {
    const build = await proposed();
    await approveBuild(admin, build.id);
    return build.id;
  }

  it('runs once, records the result and marks it ready for review', async () => {
    const id = await queued();
    const artifact = await AiIdeExecutionArtifact.create({
      organizationId: String(org), projectId, createdByUserId: new Types.ObjectId(admin.userId), requestId: 'r', requestedModel: 'coder',
      providerReportedModels: ['coder'], status: 'completed', summary: 'Added FAQ.', baseCommit: 'a'.repeat(40), patch: Buffer.from('diff'), changedFiles: ['app/faq/page.tsx'],
      evidence: [], limitations: [], expiresAt: new Date(Date.now() + 86_400_000),
    });
    mocks.execute.mockResolvedValue({
      status: 'completed', summary: 'Added FAQ.', baseCommit: 'a'.repeat(40), changedFiles: ['app/faq/page.tsx'],
      evidence: [{ command: ['npm', 'test'], exitCode: 0, timedOut: false, output: 'ok' }], limitations: [], routing: { requestedModel: 'coder', providerReportedModels: ['coder'] },
      artifactId: String(artifact._id), patch: '', requestId: 'r', protocolVersion: 1,
    });
    await Promise.all([runBuild(id), runBuild(id)]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0].task).toContain('Approved plan: "Add a FAQ page"');
    expect(await getBuild(admin, id)).toMatchObject({ status: 'ready', attempts: 1, result: { outcome: 'completed', changedFiles: ['app/faq/page.tsx'], checks: [{ command: 'npm test', exitCode: 0 }] } });
  });

  it('fails clearly when the build service is missing, throws, or changes nothing', async () => {
    const a = await queued();
    mocks.execute.mockResolvedValueOnce(null);
    await runBuild(a);
    expect((await getBuild(admin, a))?.error).toMatch(/not configured/);

    const b = await queued();
    mocks.execute.mockRejectedValueOnce(new Error('Execution worker returned HTTP 502.'));
    await runBuild(b);
    expect(await getBuild(admin, b)).toMatchObject({ status: 'failed', error: 'Execution worker returned HTTP 502.' });

    const c = await queued();
    mocks.execute.mockResolvedValueOnce({ status: 'completed', summary: 'Nothing to do.', baseCommit: 'b'.repeat(40), changedFiles: [], evidence: [], limitations: [], routing: { requestedModel: 'coder', providerReportedModels: [] }, artifactId: String(new Types.ObjectId()) });
    await runBuild(c);
    expect((await getBuild(admin, c))?.error).toMatch(/without changing any files/);
  });

  it('the sweep times out stuck builds and starts ones left waiting', async () => {
    const stuck = await queued();
    await BuildRequest.updateOne({ _id: stuck }, { $set: { status: 'building', startedAt: new Date(Date.now() - 60 * 60_000) } });
    const waiting = await queued();
    await BuildRequest.collection.updateOne({ _id: new Types.ObjectId(waiting) }, { $set: { updatedAt: new Date(Date.now() - 5 * 60_000) } });
    mocks.execute.mockResolvedValue(null);
    expect(await sweepBuilds()).toEqual({ started: 1, timedOut: 1 });
    expect((await getBuild(admin, stuck))?.error).toBe('The build timed out.');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});

describe('opening the pull request', () => {
  const ORIGINAL = 'export const links = [\n  "/about",\n];\n';
  const PATCH = `diff --git a/app/links.ts b/app/links.ts
index 1..2 100644
--- a/app/links.ts
+++ b/app/links.ts
@@ -1,3 +1,4 @@
 export const links = [
   "/about",
+  "/faq",
 ];
diff --git a/app/faq/page.tsx b/app/faq/page.tsx
new file mode 100644
index 0000000..3
--- /dev/null
+++ b/app/faq/page.tsx
@@ -0,0 +1 @@
+export default function Faq() { return null; }
`;

  function fakeGitHub(original = ORIGINAL) {
    const calls: Record<string, unknown[]> = {};
    const record = (name: string, value: unknown) => ((calls[name] ??= []).push(value), value);
    const api = {
      git: {
        getCommit: async () => ({ data: { tree: { sha: 'basetree' } } }),
        getTree: async () => ({ data: { tree: [{ path: 'app/links.ts', mode: '100644' }] } }),
        createBlob: async (a: { content: string }) => ({ data: { sha: `blob-${record('blob', Buffer.from(a.content, 'base64').toString('utf8'))}`.slice(0, 20) } }),
        createTree: async (a: unknown) => (record('tree', a), { data: { sha: 'newtree' } }),
        createCommit: async (a: unknown) => (record('commit', a), { data: { sha: 'newcommit' } }),
        createRef: async (a: unknown) => (record('ref', a), { data: {} }),
      },
      repos: { getContent: async () => ({ data: { content: Buffer.from(original).toString('base64') } }) },
      pulls: { create: async (a: unknown) => (record('pr', a), { data: { html_url: 'https://github.com/RyShoe8/playbound/pull/7', number: 7 } }) },
    };
    mocks.octokit.mockReturnValue(api);
    return calls;
  }

  async function ready(patch = PATCH) {
    const build = await proposed();
    await approveBuild(admin, build.id);
    const artifact = await AiIdeExecutionArtifact.create({
      organizationId: String(org), projectId, createdByUserId: new Types.ObjectId(admin.userId), requestId: 'r', requestedModel: 'coder',
      providerReportedModels: [], status: 'completed', summary: 'Added FAQ.', baseCommit: 'c'.repeat(40), patch: Buffer.from(patch), changedFiles: ['app/links.ts', 'app/faq/page.tsx'],
      evidence: [], limitations: [], expiresAt: new Date(Date.now() + 86_400_000),
    });
    await BuildRequest.updateOne({ _id: build.id }, { $set: { status: 'ready', result: { artifactId: artifact._id, outcome: 'completed', summary: 'Added FAQ.', baseCommit: 'c'.repeat(40), changedFiles: ['app/links.ts', 'app/faq/page.tsx'] } } });
    return build.id;
  }

  it('applies the patch on a new branch from the base commit and opens a PR to the default branch', async () => {
    const calls = fakeGitHub();
    const id = await ready();
    expect(await openPullRequest(member, id)).toMatchObject({ ok: false, status: 403 });
    const result = await openPullRequest(admin, id);
    expect(result).toMatchObject({ ok: true, build: { status: 'pr_opened', pullRequest: { url: 'https://github.com/RyShoe8/playbound/pull/7', number: 7 } } });
    expect(calls.blob).toEqual(['export const links = [\n  "/about",\n  "/faq",\n];\n', 'export default function Faq() { return null; }\n']);
    expect(calls.commit?.[0]).toMatchObject({ parents: ['c'.repeat(40)], tree: 'newtree' });
    expect(calls.ref?.[0]).toMatchObject({ ref: expect.stringMatching(/^refs\/heads\/nucleas\/add-a-faq-page-/), sha: 'newcommit' });
    expect(calls.pr?.[0]).toMatchObject({ base: 'main', title: 'Add a FAQ page' });
    expect(await openPullRequest(admin, id)).toMatchObject({ ok: false, status: 409 });
  });

  it('refuses when the file no longer matches, leaving the build ready', async () => {
    fakeGitHub('export const links = [\n  "/changed-by-someone",\n];\n');
    const id = await ready();
    const result = await openPullRequest(admin, id);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(result.ok ? '' : result.error).toMatch(/no longer applies/);
    expect((await getBuild(admin, id))?.status).toBe('ready');
  });
});

describe('builds run on the AI engine', () => {
  const CODER = 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ';
  const PAID = 'anthropic/claude-sonnet-5';

  async function seedEngine() {
    const rogly = await AiModelProfile.create({ key: 'rogly', label: 'Rogly', provider: 'custom', tier: 'local_remote', protocol: 'openai-chat', endpoint: 'https://rogly.test/v1/chat/completions', secretCiphertext: encryptModelSecret('rogly-key'), secretLast4: 'key1', enabled: true });
    const paid = await AiModelProfile.create({ key: 'openrouter', label: 'OpenRouter', provider: 'openrouter', tier: 'commercial', protocol: 'openai-chat', endpoint: 'https://openrouter.test/v1/chat/completions', secretCiphertext: encryptModelSecret('paid-key'), secretLast4: 'key2', enabled: true });
    await AiModelCatalogSnapshot.create([
      { profileId: rogly._id, modelIds: [CODER], fetchedAt: new Date() },
      { profileId: paid._id, modelIds: [PAID], fetchedAt: new Date() },
    ]);
    // $3 in / $15 out per 1M tokens; fresh so no network fetch happens.
    await AiPricingRegistryCache.updateOne(
      { key: 'litellm' },
      { $set: { rows: [{ id: PAID, provider: 'openrouter', mode: 'chat', input: 3, output: 15, cacheRead: null, variable: false, supportsTools: true }], fetchedAt: new Date() } },
      { upsert: true }
    );
  }

  function workerReply(input: { inference?: { model: string } }, usage = { inputTokens: 1000, outputTokens: 500 }) {
    return {
      status: 'completed', summary: 'Done.', baseCommit: 'a'.repeat(40), changedFiles: ['a.ts'], evidence: [], limitations: [],
      routing: { requestedModel: input.inference?.model ?? 'service-default', providerReportedModels: [] },
      artifactId: String(new Types.ObjectId()), usage, usedEngineModel: Boolean(input.inference),
    };
  }

  async function queuedAt(level: 'low' | 'medium') {
    await connectRepo();
    const result = await proposeCodeChange(admin, { companyId, request: 'Add a FAQ page', level });
    if (!result.ok) throw new Error(result.message);
    await approveBuild(admin, result.build.id);
    return result.build.id;
  }

  it('low: builds on the free coder with its credential, costs nothing, and is recorded for AI Spend', async () => {
    await seedEngine();
    mocks.execute.mockImplementation(async (input) => workerReply(input));
    const id = await queuedAt('low');
    await runBuild(id);
    expect(mocks.execute.mock.calls[0][0].inference).toEqual({ endpoint: 'https://rogly.test/v1/chat/completions', bearerToken: 'rogly-key', model: CODER });
    expect(await getBuild(admin, id)).toMatchObject({ status: 'ready', result: { model: CODER, engineModel: true, costMicros: 0 } });
    expect(await AiRun.findOne({ projectId }).lean()).toMatchObject({ model: CODER, status: 'completed', inputTokens: 1000, outputTokens: 500, costMicros: 0 });
  });

  it('medium: a rebuild moves to the paid retry model, priced from its token usage', async () => {
    await seedEngine();
    mocks.execute.mockImplementation(async (input) => ({ ...workerReply(input), status: 'failed', changedFiles: [] }));
    const id = await queuedAt('medium');
    await runBuild(id);
    expect(mocks.execute.mock.calls[0][0].inference.model).toBe(CODER);

    mocks.execute.mockImplementation(async (input) => workerReply(input));
    await BuildRequest.updateOne({ _id: id }, { $set: { status: 'queued' } });
    await runBuild(id);
    expect(mocks.execute.mock.calls[1][0].inference).toMatchObject({ endpoint: 'https://openrouter.test/v1/chat/completions', bearerToken: 'paid-key', model: PAID });
    // 1000 × $3/1M + 500 × $15/1M = $0.0105
    expect(await getBuild(admin, id)).toMatchObject({ status: 'ready', attempts: 2, result: { model: PAID, costMicros: 10_500 } });
  });

  it('a build service that has not been updated still builds on its own model, with no cost claimed', async () => {
    await seedEngine();
    mocks.execute.mockImplementation(async () => ({ ...workerReply({}), usage: undefined, usedEngineModel: false }));
    const id = await queuedAt('low');
    await runBuild(id);
    const build = await getBuild(admin, id);
    expect(build).toMatchObject({ status: 'ready', result: { model: 'service-default', engineModel: false, costMicros: null } });
  });
});
