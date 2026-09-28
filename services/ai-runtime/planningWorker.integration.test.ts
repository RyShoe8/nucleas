import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { randomUUID } from 'node:crypto';
import { AiBudget, AiBudgetReservation, AiDispatchLock, AiObjective, AiPlan, AiPlanningJob, AiRun, AiRunEvent, AiRunAcknowledgement } from '@/lib/models/AiControl';
import { AiSettings, AiSettingsAudit } from '@/lib/models/AiSettings';
import { defaultPlatformAiSettings } from '@/lib/ai/settingsSchema';
import { platformSettingsId, saveSettings, readPlatformSettings } from '@/lib/ai/control/settings';
import { saveBudgetSettings, budgetSettingsView } from '@/lib/ai/control/budgetSettings';
import { getPlanningPolicy } from '@/lib/ai/control/config';
import { listProjectRuns, getRunDetail, getRunEvents } from '@/lib/ai/control/runQueries';
import { listLibrary, getLibraryObjective, getLibraryPlan } from '@/lib/ai/control/libraryQueries';
import { listAttention, acknowledgeRun } from '@/lib/ai/control/attention';
import User from '@/lib/models/User';
import Employee from '@/lib/models/Employee';
import Project from '@/lib/models/Project';
import { ensureAiIndexes } from '@/lib/ai/control/indexes';
import { queuePlanning, cancelPlanning, type AiAccess } from '@/lib/ai/control/planningQueue';
import { approvePlan } from '@/lib/ai/control/plans';
import { processPlanningQueue } from './planningWorker';
import type { ModelResult } from '@nucleas/ai-contracts';
import { AiDispatchUsage } from '@/lib/models/AiControl';
import { DISPATCH_USAGE_ID, reserveDispatch } from '@/lib/ai/control/dispatchLimits';
import { aiTransaction } from '@/lib/ai/control/transaction';
import { clearTerminalPlanningContexts, CLEARED_PLANNING_CONTEXT } from '@/lib/ai/control/contextRetention';
import WorkspaceNotificationEvent from '@/lib/models/WorkspaceNotificationEvent';
import WorkspaceNotificationPreference from '@/lib/models/WorkspaceNotificationPreference';
import { canDeliverPlanningNotification } from '@/lib/ai/control/notifications';
import { processWorkspaceNotificationDigests } from '@/lib/workspace/workspaceNotifications';
import { budgetHistory } from '@/lib/ai/control/budgetHistory';
import { AiServiceIdentity, AiServiceGrant, AiServiceIdentityAudit } from '@/lib/models/AiServiceIdentity';
import { registerServiceIdentity, changeServiceIdentity, authenticateServiceCredential, issueServiceGrant,
  authorizeStoredServiceAction, revokeServiceGrant, listServiceIdentities } from '@/lib/ai/control/serviceIdentities';
import { AiArtifact, AiArtifactReview, AiArtifactAcceptance } from '@/lib/models/AiArtifactReview';
import { storeUnverifiedArtifact, recordArtifactReview, acceptStoredArtifact } from '@/lib/ai/control/artifactReviews';
import { publishAcceptedReview } from '@/lib/ai/control/githubPublishAction';
import { AiProjectRepository } from '@/lib/models/AiProjectRepository';
import { getArtifactContent } from '@/lib/ai/control/artifactQueries';
import { AiExecutionProbe, runExecutionProbe } from '@/lib/ai/control/executionProbe';

import { AiModelProfile } from '@/lib/models/AiModelProfile';

// Never read .env.local, use production MongoDB, or invoke a real model in this suite.
vi.mock('@/lib/db/mongodb', () => ({ default: async () => mongoose }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
const model = vi.hoisted(() => vi.fn());
const digestEmail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/services/workspaceDigestEmail', () => ({ sendWorkspaceDigestEmail: digestEmail }));
vi.mock('@nucleas/ai-core/gateway', async importOriginal => {
  const actual = await importOriginal<typeof import('@nucleas/ai-core/gateway')>();
  return {
    ...actual,
    invokeModel: model,
    invokeModelWithTools: async (...args: unknown[]) => {
      const res = await model(...args);
      return { toolCalls: [], ...res };
    },
  };
});

let replica: MongoMemoryReplSet;
let access: AiAccess;
let objective: InstanceType<typeof AiObjective>;
const models = [AiModelProfile, WorkspaceNotificationEvent, WorkspaceNotificationPreference, AiDispatchUsage, AiRunAcknowledgement, AiSettings, AiSettingsAudit, AiPlanningJob, AiDispatchLock, AiBudgetReservation, AiBudget, AiRunEvent, AiRun, AiPlan, AiObjective, Project, Employee, User];
const response: ModelResult = { content: JSON.stringify({ summary: 'Synthetic plan', tasks: [{ key: 'test', name: 'Add a regression', acceptanceCriteria: ['Test passes'], dependsOn: [] }] }),
  model: 'synthetic-model', inputTokens: 20, outputTokens: 30, latencyMs: 10, finishReason: 'stop' };

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' },
    instanceOpts: [{ args: ['--wiredTigerCacheSizeGB', '0.25'] }] });
  await mongoose.connect(replica.getUri('nucleas_ai_test_planning'));
  await ensureAiIndexes();
  await Promise.all([User, Project, Employee, WorkspaceNotificationPreference].map(item => item.createIndexes()));
}, 180000);
afterAll(async () => { await mongoose.disconnect(); await replica?.stop(); }, 30000);
beforeEach(async () => {
  if (mongoose.connection.host !== '127.0.0.1' || mongoose.connection.name !== 'nucleas_ai_test_planning') throw new Error('Refusing to clear a non-test database.');
  for (const item of [AiExecutionProbe, AiArtifactAcceptance, AiArtifactReview, AiArtifact, AiProjectRepository, AiServiceIdentityAudit, AiServiceGrant, AiServiceIdentity, ...models]) await item.collection.deleteMany({});
  vi.stubEnv('NUCLEAS_AI_REMOTE_BEARER_TOKEN', 'synthetic-only');
  vi.stubEnv('CRON_SECRET', 'synthetic-cron');
  vi.stubEnv('NEXTAUTH_SECRET', 'synthetic-cursor-secret');
  await AiSettings.create({ _id: platformSettingsId, value: { ...defaultPlatformAiSettings,
    remoteEnabled: true, dispatchEnabled: true, model: 'synthetic-model',
    reservationMicros: 25, organizationLimitMicros: 100, projectLimitMicros: 75,
  } });
  model.mockReset(); model.mockResolvedValue(response);
  digestEmail.mockReset(); digestEmail.mockResolvedValue(undefined);
  const user = await User.create({ email: 'ai-test@example.invalid', password: 'synthetic', organizationId: 'org-test' });
  const employee = await Employee.create({ userId: user._id, organizationId: 'org-test', name: 'Test manager', role: 'Manager' });
  const project = await Project.create({ userId: user._id, name: 'Synthetic project', tasks: [
    { name: 'Existing human task', assignedToEmployeeIds: [employee._id, new Types.ObjectId()] },
  ] });
  access = { userId: String(user._id), organizationId: 'org-test', employeeId: employee._id, canManage: true, ownerIds: [user._id], project };
  objective = await AiObjective.create({ organizationId: 'org-test', projectId: project._id, requestId: randomUUID(),
    createdByUserId: user._id, title: 'Synthetic objective', outcome: 'Tests pass', acceptanceCriteria: ['Regression covered'] });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('durable planning on a real isolated replica set', () => {
  it.each([undefined, 'chat', 'responses'] as const)('sends diagnostic %s once under concurrency and retains its dispatch lock', async kind => {
    await User.updateOne({ _id: access.userId }, { $set: { isAdmin: true } });
    await AiSettings.updateOne({ _id: platformSettingsId }, { $set: { 'value.model': defaultPlatformAiSettings.model } });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ output: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const attempts = await Promise.allSettled([runExecutionProbe(access.userId, kind), runExecutionProbe(access.userId, kind)]);
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await AiExecutionProbe.countDocuments()).toBe(1);
    expect((await AiDispatchUsage.findById(DISPATCH_USAGE_ID))?.attempts).toBe(1);
    expect((await AiDispatchLock.findById(DISPATCH_USAGE_ID))?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    await expect(runExecutionProbe(access.userId, kind)).rejects.toThrow('already been attempted');
    if (kind) {
      expect(await AiExecutionProbe.exists({ _id: 'remote-execution-probe-v1' })).toBeNull();
      await expect(runExecutionProbe(access.userId, kind === 'chat' ? 'responses' : 'chat')).rejects.toThrow('Shared inference is busy');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not consume the diagnostic when shared inference is busy or the actor is unauthorized', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(runExecutionProbe(access.userId)).rejects.toMatchObject({ status: 403 });
    await User.updateOne({ _id: access.userId }, { $set: { isAdmin: true } });
    await AiSettings.updateOne({ _id: platformSettingsId }, { $set: { 'value.model': defaultPlatformAiSettings.model } });
    await AiDispatchLock.create({ _id: DISPATCH_USAGE_ID, token: 'synthetic', expiresAt: new Date(Date.now() + 60000) });
    await expect(runExecutionProbe(access.userId)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled(); expect(await AiExecutionProbe.countDocuments()).toBe(0);
  });
  const serviceActor = () => ({ userId: access.userId, organizationId: access.organizationId });
  async function activeIdentity(role: 'architect' | 'reviewer' = 'architect') {
    await User.updateOne({ _id: access.userId }, { $set: { isAdmin: true } });
    const created = await registerServiceIdentity(serviceActor(), { name: `Synthetic ${role}`, role });
    const rotated = await changeServiceIdentity(serviceActor(), { identityId: created.identityId, revision: 0, action: 'rotate' });
    await changeServiceIdentity(serviceActor(), { identityId: created.identityId, revision: 1, action: 'activate' });
    return { identityId: created.identityId, authorization: `Bearer ${rotated.credential}`, credential: rotated.credential! };
  }
  async function scopedGrant(identityId: string) {
    const queued = await queuePlanning(access, String(objective._id), randomUUID());
    const grant = await issueServiceGrant(serviceActor(), { identityId, runId: queued.runId, expiresInSeconds: 300 });
    const run = await AiRun.findById(queued.runId).orFail();
    const action = { organizationId: access.organizationId, projectId: String(access.project._id), runId: queued.runId,
      operation: 'planning.infer', policyDigest: run.policyDigest, grantRevision: 0 };
    return { grant, action };
  }
  async function reviewedArtifact(verdict: 'passed' | 'changes_required' = 'passed', patch = Buffer.from('synthetic patch')) {
    const service = await activeIdentity('reviewer');
    const policy = await getPlanningPolicy(access.organizationId, String(access.project._id));
    const taskId = String(access.project.tasks![0]._id);
    const run = await AiRun.create({ organizationId: access.organizationId, projectId: access.project._id, taskId,
      role: 'worker', status: 'review_required', policyDigest: policy.digest, inputDigest: 'a'.repeat(64), createdByUserId: access.userId });
    const workerIdentityId = String(new Types.ObjectId());
    const stored = await storeUnverifiedArtifact({ organizationId: access.organizationId, projectId: String(access.project._id), taskId,
      runId: String(run._id), workerIdentityId, repositoryCommit: 'a'.repeat(40), expectedRunRevision: 0 }, patch, [Buffer.from('synthetic test evidence')]);
    const grant = await issueServiceGrant(serviceActor(), { identityId: service.identityId, runId: String(run._id), expiresInSeconds: 300 });
    const review = { protocolVersion: 1, reviewId: String(new Types.ObjectId()), binding: stored.binding, workerIdentityId,
      reviewerIdentityId: service.identityId, verdict, evidenceDigests: stored.evidenceDigests, findings: [],
      reviewedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
    await recordArtifactReview(service.authorization, grant.grantId, 0, stored.artifactId, review);
    return { service, grant, stored, review, run, taskId };
  }
  async function simulateVerifiedSandbox(artifactId: string) {
    // Test-only attestation simulation in the guarded temporary DB. No product API can promote this flag.
    await AiArtifact.collection.updateOne({ _id: new Types.ObjectId(artifactId) }, { $set: { executionVerified: true } });
  }
  it('acknowledges identical review deliveries without new events and rejects changed replay', async () => {
    const result = await reviewedArtifact();
    const replay = () => recordArtifactReview(result.service.authorization, result.grant.grantId, 0, result.stored.artifactId, result.review);
    const responses = await Promise.all([replay(), replay()]);
    expect(responses.every(item => 'alreadyRecorded' in item && item.alreadyRecorded)).toBe(true);
    expect(await AiArtifactReview.countDocuments()).toBe(1);
    expect(await AiRunEvent.countDocuments({ runId: result.run._id, type: 'artifact.reviewed' })).toBe(1);
    await expect(recordArtifactReview(result.service.authorization, result.grant.grantId, 0, result.stored.artifactId,
      { ...result.review, verdict: 'blocked' })).rejects.toMatchObject({ status: 409 });
    await revokeServiceGrant(serviceActor(), { grantId: result.grant.grantId, revision: 0 });
    await expect(replay()).rejects.toMatchObject({ status: 403 });
  });
  it('rejects review replay after cancellation', async () => {
    const result = await reviewedArtifact();
    await AiRun.updateOne({ _id: result.run._id }, { $set: { status: 'cancelled' } });
    await expect(recordArtifactReview(result.service.authorization, result.grant.grantId, 0, result.stored.artifactId, result.review)).rejects.toMatchObject({ status: 403 });
  });
  it('reads only scoped hash-checked artifact text and selected evidence', async () => {
    const result = await reviewedArtifact();
    expect(await getArtifactContent(access, result.stored.artifactId, null, 0)).toMatchObject({ text: 'synthetic patch', nextOffset: null });
    expect(await getArtifactContent(access, result.stored.artifactId, result.stored.evidenceDigests[0], 0)).toMatchObject({ text: 'synthetic test evidence' });
    await expect(getArtifactContent({ ...access, organizationId: 'foreign' }, result.stored.artifactId, null, 0)).rejects.toMatchObject({ status: 404 });
    await expect(getArtifactContent(access, result.stored.artifactId, 'f'.repeat(64), 0)).rejects.toMatchObject({ status: 404 });
    await expect(getArtifactContent(access, result.stored.artifactId, null, -1)).rejects.toMatchObject({ status: 400 });
    await AiArtifact.collection.updateOne({ _id: new Types.ObjectId(result.stored.artifactId) }, { $set: { patch: Buffer.from('tampered') } });
    await expect(getArtifactContent(access, result.stored.artifactId, null, 0)).rejects.toMatchObject({ status: 409 });
  });
  it('bounds content pages and refuses binary text decoding', async () => {
    const result = await reviewedArtifact('passed', Buffer.from('x'.repeat(20000)));
    const first = await getArtifactContent(access, result.stored.artifactId, null, 0);
    expect(first.text).toHaveLength(16384); expect(first.nextOffset).toBe(16384);
    const second = await getArtifactContent(access, result.stored.artifactId, null, first.nextOffset!);
    expect(second.text).toHaveLength(3616); expect(second.nextOffset).toBeNull();
    const binary = await reviewedArtifact('passed', Buffer.from([255, 254]));
    await expect(getArtifactContent(access, binary.stored.artifactId, null, 0)).rejects.toMatchObject({ status: 415 });
  });
  it('stores artifact bytes and immutable review without accepting unverified execution', async () => {
    const before = await Project.findById(access.project._id).lean();
    const result = await reviewedArtifact();
    expect((await AiArtifact.findById(result.stored.artifactId))?.executionVerified).toBe(false);
    expect((await AiArtifact.findById(result.stored.artifactId).lean())?.patch).toBeUndefined();
    expect((await AiArtifactReview.findById(result.review.reviewId))?.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    await AiArtifactReview.updateOne({ _id: result.review.reviewId }, { $set: { payload: { forged: true } } });
    expect((await AiArtifactReview.findById(result.review.reviewId))?.payload).toMatchObject({ verdict: 'passed' });
    await expect(acceptStoredArtifact(access, result.review.reviewId)).rejects.toMatchObject({ status: 409 });
    expect((await Project.findById(access.project._id).lean())?.tasks).toEqual(before?.tasks);
    expect(await AiArtifactAcceptance.countDocuments()).toBe(0);
  });
  it('atomically accepts one exact verified result and preserves all human assignees under duplicate requests', async () => {
    const result = await reviewedArtifact();
    await simulateVerifiedSandbox(result.stored.artifactId);
    const assignments = access.project.tasks![0].assignedToEmployeeIds?.map(String);
    const accepted = await Promise.all([acceptStoredArtifact(access, result.review.reviewId), acceptStoredArtifact(access, result.review.reviewId)]);
    expect(accepted.filter(item => !item.alreadyAccepted)).toHaveLength(1);
    expect(await AiArtifactAcceptance.countDocuments()).toBe(1);
    const task = (await Project.findById(access.project._id))?.tasks?.[0];
    expect(task?.status).toBe('completed');
    expect(task?.assignedToEmployeeIds?.map(String)).toEqual(assignments);
    expect((await AiRun.findById(result.run._id))?.status).toBe('completed');
    expect(await AiRunEvent.countDocuments({ runId: result.run._id, type: 'artifact.accepted' })).toBe(1);
  });
  it('blocks GitHub publish without verification, repository binding, or App install and never invents a PR URL', async () => {
    const result = await reviewedArtifact();
    expect(await publishAcceptedReview(access, result.review.reviewId)).toMatchObject({
      status: 'blocked',
      pullRequestUrl: null,
    });
    expect((await publishAcceptedReview(access, result.review.reviewId)).reason).toMatch(/Accept the exact|not been verified/i);

    await simulateVerifiedSandbox(result.stored.artifactId);
    await acceptStoredArtifact(access, result.review.reviewId);
    expect(await publishAcceptedReview(access, result.review.reviewId)).toMatchObject({
      status: 'blocked',
      reason: expect.stringMatching(/Link a GitHub repository/i),
      pullRequestUrl: null,
    });

    await AiProjectRepository.create({
      organizationId: access.organizationId,
      projectId: access.project._id,
      host: 'github',
      owner: 'acme',
      repo: 'app',
      defaultBranch: 'main',
      publishMode: 'pull_request',
      installationId: null,
    });
    const blocked = await publishAcceptedReview(access, result.review.reviewId);
    expect(blocked).toMatchObject({ status: 'blocked', pullRequestUrl: null });
    expect(blocked.reason).toMatch(/GitHub App|Install and connect/i);
    expect(blocked.repository).toMatchObject({ owner: 'acme', repo: 'app' });
  });
  it('refuses failed review even with simulated verified execution', async () => {
    const result = await reviewedArtifact('changes_required');
    await simulateVerifiedSandbox(result.stored.artifactId);
    await expect(acceptStoredArtifact(access, result.review.reviewId)).rejects.toThrow();
    expect(await AiArtifactAcceptance.countDocuments()).toBe(0);
    expect((await AiRun.findById(result.run._id))?.status).toBe('revision_required');
  });
  it('rejects acceptance when the grant issuer loses administrator authority', async () => {
    const result = await reviewedArtifact();
    await simulateVerifiedSandbox(result.stored.artifactId);
    await User.updateOne({ _id: access.userId }, { $set: { isAdmin: false } });
    await expect(acceptStoredArtifact(access, result.review.reviewId)).rejects.toThrow('issuer is no longer authorized');
    expect(await AiArtifactAcceptance.countDocuments()).toBe(0);
  });
  it('rejects acceptance after reviewer grant revocation or current human role loss', async () => {
    const result = await reviewedArtifact();
    await simulateVerifiedSandbox(result.stored.artifactId);
    await Employee.updateOne({ _id: access.employeeId }, { $set: { role: 'User' } });
    await expect(acceptStoredArtifact(access, result.review.reviewId)).rejects.toMatchObject({ status: 403 });
    await Employee.updateOne({ _id: access.employeeId }, { $set: { role: 'Manager' } });
    await revokeServiceGrant(serviceActor(), { grantId: result.grant.grantId, revision: 0 });
    await expect(acceptStoredArtifact(access, result.review.reviewId)).rejects.toMatchObject({ status: 409 });
    expect(await AiArtifactAcceptance.countDocuments()).toBe(0);
  });
  it('rejects changed task snapshots and rolls back acceptance/run completion', async () => {
    const result = await reviewedArtifact();
    await simulateVerifiedSandbox(result.stored.artifactId);
    await Project.updateOne({ _id: access.project._id }, { $set: { 'tasks.0.name': 'Human edit after review' } });
    await expect(acceptStoredArtifact(access, result.review.reviewId)).rejects.toMatchObject({ status: 409 });
    expect((await AiRun.findById(result.run._id))?.status).toBe('awaiting_acceptance');
    expect(await AiArtifactAcceptance.countDocuments()).toBe(0);
  });
  it('rejects tampered stored bytes even when an attestation flag was set', async () => {
    const result = await reviewedArtifact();
    await simulateVerifiedSandbox(result.stored.artifactId);
    await AiArtifact.collection.updateOne({ _id: new Types.ObjectId(result.stored.artifactId) }, { $set: { patch: Buffer.from('different bytes') } });
    await expect(acceptStoredArtifact(access, result.review.reviewId)).rejects.toMatchObject({ status: 409 });
    expect(await AiArtifactAcceptance.countDocuments()).toBe(0);
  });
  it('rejects foreign review access and oversized artifacts before persistence', async () => {
    const result = await reviewedArtifact();
    await expect(acceptStoredArtifact({ ...access, organizationId: 'other-org' }, result.review.reviewId)).rejects.toMatchObject({ status: 403 });
    await expect(storeUnverifiedArtifact({ organizationId: access.organizationId, projectId: String(access.project._id), taskId: result.taskId,
      runId: String(result.run._id), workerIdentityId: String(new Types.ObjectId()), repositoryCommit: 'b'.repeat(40), expectedRunRevision: 0 },
      Buffer.alloc(1024 * 1024 + 1), [Buffer.from('test')])).rejects.toMatchObject({ status: 400 });
    expect(await AiArtifact.countDocuments()).toBe(1);
  });
  it('registers disabled identities and stores only hashed, expiring credentials with audit', async () => {
    const service = await activeIdentity();
    expect(await authenticateServiceCredential(service.authorization)).toMatchObject({ identityId: service.identityId, credentialVersion: 1 });
    const stored = await AiServiceIdentity.findById(service.identityId).select('+credentialHash').lean();
    expect(stored?.credentialHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(service.credential);
    expect(JSON.stringify(await AiServiceIdentityAudit.find().lean())).not.toContain(service.credential);
    expect((await listServiceIdentities(access.organizationId, null)).items[0]).not.toHaveProperty('credentialHash');
    expect(await AiServiceIdentityAudit.countDocuments()).toBe(3);
  });
  it('rejects non-administrator registration without persisting identity or audit', async () => {
    await expect(registerServiceIdentity(serviceActor(), { name: 'No', role: 'architect' })).rejects.toMatchObject({ status: 403 });
    expect(await AiServiceIdentity.countDocuments()).toBe(0);
    expect(await AiServiceIdentityAudit.countDocuments()).toBe(0);
  });
  it('rotates credentials and rejects the old token, old grants, and stale administrative edits', async () => {
    const service = await activeIdentity();
    const { grant, action } = await scopedGrant(service.identityId);
    const rotated = await changeServiceIdentity(serviceActor(), { identityId: service.identityId, revision: 2, action: 'rotate' });
    await expect(authenticateServiceCredential(service.authorization)).rejects.toMatchObject({ status: 401 });
    expect(await authenticateServiceCredential(`Bearer ${rotated.credential}`)).toMatchObject({ credentialVersion: 2 });
    await expect(aiTransaction(tx => authorizeStoredServiceAction(`Bearer ${rotated.credential}`, grant.grantId, action, tx))).rejects.toMatchObject({ status: 401 });
    await expect(changeServiceIdentity(serviceActor(), { identityId: service.identityId, revision: 2, action: 'disable' })).rejects.toMatchObject({ status: 409 });
  });
  it('authorizes only current stored scope and policy, and fences revoked grants', async () => {
    const service = await activeIdentity();
    const { grant, action } = await scopedGrant(service.identityId);
    expect(await aiTransaction(tx => authorizeStoredServiceAction(service.authorization, grant.grantId, action, tx))).toMatchObject({ grantId: grant.grantId });
    await expect(aiTransaction(tx => authorizeStoredServiceAction(service.authorization, grant.grantId,
      { ...action, organizationId: 'other-org' }, tx))).rejects.toMatchObject({ status: 401 });
    await revokeServiceGrant(serviceActor(), { grantId: grant.grantId, revision: 0 });
    await expect(aiTransaction(tx => authorizeStoredServiceAction(service.authorization, grant.grantId, action, tx))).rejects.toThrow();
  });
  it('does not revive old grants after disabling and reactivating an identity', async () => {
    const service = await activeIdentity();
    const { grant, action } = await scopedGrant(service.identityId);
    await changeServiceIdentity(serviceActor(), { identityId: service.identityId, revision: 2, action: 'disable' });
    await expect(authenticateServiceCredential(service.authorization)).rejects.toMatchObject({ status: 401 });
    await changeServiceIdentity(serviceActor(), { identityId: service.identityId, revision: 3, action: 'activate' });
    await expect(aiTransaction(tx => authorizeStoredServiceAction(service.authorization, grant.grantId, action, tx))).rejects.toThrow();
    await changeServiceIdentity(serviceActor(), { identityId: service.identityId, revision: 4, action: 'revoke' });
    await expect(changeServiceIdentity(serviceActor(), { identityId: service.identityId, revision: 5, action: 'activate' })).rejects.toMatchObject({ status: 409 });
  });
  it('denies expired, malformed and altered credentials without accepting model-provider tokens', async () => {
    const service = await activeIdentity();
    for (const token of [null, 'Bearer synthetic-only', `${service.authorization}x`, service.authorization.replace('nas1.', 'nas2.')]) {
      await expect(authenticateServiceCredential(token)).rejects.toMatchObject({ status: 401 });
    }
    await AiServiceIdentity.updateOne({ _id: service.identityId }, { $set: { credentialExpiresAt: new Date(0) } });
    await expect(authenticateServiceCredential(service.authorization)).rejects.toMatchObject({ status: 401 });
  });
  it('rechecks issuer membership, run cancellation and organization pause on service actions', async () => {
    const service = await activeIdentity();
    const { grant, action } = await scopedGrant(service.identityId);
    await User.updateOne({ _id: access.userId }, { $set: { isAdmin: false } });
    await expect(aiTransaction(tx => authorizeStoredServiceAction(service.authorization, grant.grantId, action, tx))).rejects.toMatchObject({ status: 403 });
    await User.updateOne({ _id: access.userId }, { $set: { isAdmin: true } });
    await saveBudgetSettings({ ...serviceActor(), projectId: undefined }, 0, { limitMicros: null, paused: true });
    await expect(aiTransaction(tx => authorizeStoredServiceAction(service.authorization, grant.grantId, action, tx))).rejects.toThrow();
    await cancelPlanning(access, action.runId);
    await expect(aiTransaction(tx => authorizeStoredServiceAction(service.authorization, grant.grantId, action, tx))).rejects.toMatchObject({ status: 403 });
  });
  it('paginates monthly budget history without crossing organization or project scope', async () => {
    const scopeKey = `project:${String(access.project._id)}`;
    await AiBudget.create(Array.from({ length: 14 }, (_, index) => ({ organizationId: access.organizationId, scopeKey,
      period: `${2026 - Math.floor(index / 12)}-${String(12 - index % 12).padStart(2, '0')}`,
      limitMicros: 100, spentMicros: index, reservedMicros: 25 })));
    await AiBudget.create([{ organizationId: 'other-org', scopeKey, period: '2026-12', limitMicros: 999 },
      { organizationId: access.organizationId, scopeKey: 'organization', period: '2026-12', limitMicros: 888 }]);
    const first = await budgetHistory(access.organizationId, String(access.project._id), null);
    expect(first.items).toHaveLength(12); expect(first.nextCursor).toBe('2026-01');
    expect(Object.keys(first.items[0]).sort()).toEqual(['period', 'limitMicros', 'spentMicros', 'reservedMicros'].sort());
    const second = await budgetHistory(access.organizationId, String(access.project._id), first.nextCursor);
    expect(second.items).toHaveLength(2); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.period)).size).toBe(14);
    expect((await budgetHistory(access.organizationId, undefined, null)).items).toEqual([
      { period: '2026-12', limitMicros: 888, spentMicros: 0, reservedMicros: 0 }]);
    await expect(budgetHistory(access.organizationId, undefined, '2026-13')).rejects.toMatchObject({ status: 400 });
  });
  it('shows current scoped reservations without counting other scopes or months', async () => {
    const queued = await queuePlanning(access, String(objective._id), randomUUID());
    const scopeKey = `project:${String(access.project._id)}`;
    const period = new Date().toISOString().slice(0, 7);
    await AiBudget.create([{ organizationId: 'other-org', scopeKey, period, limitMicros: 999, spentMicros: 900 },
      { organizationId: access.organizationId, scopeKey, period: '2000-01', limitMicros: 999, spentMicros: 900 }]);
    const view = await budgetSettingsView(access.organizationId, String(access.project._id));
    expect(view.usage).toMatchObject({ period, ledgerExists: true, spentMicros: 0, reservedMicros: 25, remainingMicros: 50 });
    expect((await budgetSettingsView(access.organizationId)).usage).toMatchObject({ reservedMicros: 25, remainingMicros: 75 });
    await cancelPlanning(access, queued.runId);
    expect((await budgetSettingsView(access.organizationId, String(access.project._id))).usage).toMatchObject({ reservedMicros: 0, remainingMicros: 75 });
  });
  it('uses current ceilings rather than stale ledger limits and never resets held usage on read', async () => {
    await queuePlanning(access, String(objective._id), randomUUID());
    await saveBudgetSettings({ userId: access.userId, organizationId: access.organizationId, projectId: String(access.project._id) },
      0, { limitMicros: 10, paused: false });
    const before = await AiBudget.find().lean();
    const view = await budgetSettingsView(access.organizationId, String(access.project._id));
    expect(view.usage).toMatchObject({ reservedMicros: 25, remainingMicros: 0 });
    expect(await AiBudget.find().lean()).toEqual(before);
  });
  it('reports missing current ledger explicitly without creating one', async () => {
    const view = await budgetSettingsView(access.organizationId, String(access.project._id));
    expect(view.usage).toMatchObject({ ledgerExists: false, spentMicros: 0, reservedMicros: 0, remainingMicros: 75 });
    expect(await AiBudget.countDocuments()).toBe(0);
  });
  const enableNotifications = () => WorkspaceNotificationPreference.create({ userId: access.userId, employeeId: access.employeeId,
    organizationId: access.organizationId, interval: '1h' });
  it('prevents overlapping digest workers from emailing the same recipient', async () => {
    await enableNotifications(); await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    let release!: () => void; let entered!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const sending = new Promise<void>(resolve => { entered = resolve; });
    digestEmail.mockImplementationOnce(async () => { entered(); await waiting; });
    const first = processWorkspaceNotificationDigests();
    try {
      await sending;
      expect((await processWorkspaceNotificationDigests()).emailsSent).toBe(0);
      expect(digestEmail).toHaveBeenCalledTimes(1);
    } finally { release(); await first; }
    expect((await WorkspaceNotificationPreference.findOne())?.digestLeaseToken).toBeUndefined();
  });
  it('retains a lease after ambiguous email failure and releases it after expiry and recovery', async () => {
    await enableNotifications(); await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    digestEmail.mockRejectedValueOnce(new Error('Synthetic ambiguous email failure'));
    await expect(processWorkspaceNotificationDigests()).rejects.toThrow('Synthetic ambiguous');
    expect((await WorkspaceNotificationPreference.findOne())?.digestLeaseToken).toBeTruthy();
    expect((await processWorkspaceNotificationDigests()).emailsSent).toBe(0);
    expect(digestEmail).toHaveBeenCalledTimes(1);
    await WorkspaceNotificationPreference.updateOne({}, { $set: { digestLeaseExpiresAt: new Date(0) } });
    expect((await processWorkspaceNotificationDigests()).emailsSent).toBe(1);
    expect((await WorkspaceNotificationPreference.findOne())?.digestLeaseToken).toBeUndefined();
  });
  it('releases an unused digest lease when no events exist', async () => {
    await enableNotifications();
    expect((await processWorkspaceNotificationDigests()).emailsSent).toBe(0);
    expect((await WorkspaceNotificationPreference.findOne())?.digestLeaseToken).toBeUndefined();
  });
  it('delivers generic run links through the existing digest without a real email', async () => {
    await enableNotifications(); await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    expect((await processWorkspaceNotificationDigests()).eventsSent).toBe(1);
    expect(digestEmail).toHaveBeenCalledTimes(1);
    const row = digestEmail.mock.calls[0][0].events[0];
    expect(row.href).toContain(`/workspace/projects/${String(access.project._id)}/ai/runs/`);
    expect(row.entityLabel).toBe('AI planning update'); expect(row.projectName).toBe('AI planning');
  });
  it('marks stale AI digest events suppressed rather than sent', async () => {
    await enableNotifications(); const { runId } = await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    await AiRun.updateOne({ _id: runId }, { $inc: { revision: 1 } });
    expect((await processWorkspaceNotificationDigests()).eventsSent).toBe(0);
    expect(digestEmail).not.toHaveBeenCalled();
    const event = await WorkspaceNotificationEvent.findOne();
    expect(event?.suppressedAt).toBeInstanceOf(Date); expect(event?.digestSentAt).toBeUndefined();
  });
  it('enqueues one generic review notification in the terminal transaction', async () => {
    await enableNotifications();
    await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue(); await processPlanningQueue();
    const events = await WorkspaceNotificationEvent.find(); expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('ai_update'); expect(events[0].projectName).toBe('AI planning');
    expect(events[0].changeLabel).toBe('Draft ready for your review');
    expect(await canDeliverPlanningNotification(events[0])).toBe(true);
    await AiRun.updateOne({ _id: events[0].entityId }, { $inc: { revision: 1 } });
    expect(await canDeliverPlanningNotification(events[0])).toBe(false);
  });
  it.each(['preference', 'membership', 'role', 'ownership'])('suppresses delivery after %s revocation', async reason => {
    await enableNotifications(); await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    const event = await WorkspaceNotificationEvent.findOne(); expect(event).not.toBeNull();
    if (reason === 'preference') await WorkspaceNotificationPreference.updateOne({}, { $set: { interval: 'off' } });
    if (reason === 'membership') await User.updateOne({ _id: access.userId }, { $set: { organizationId: 'other-org' } });
    if (reason === 'role') await Employee.updateOne({ _id: access.employeeId }, { $set: { role: 'Employee' } });
    if (reason === 'ownership') await Project.updateOne({ _id: access.project._id }, { $set: { userId: new Types.ObjectId() } });
    expect(await canDeliverPlanningNotification(event!)).toBe(false);
  });
  it('does not enqueue AI email when notifications are off', async () => {
    await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    expect(await WorkspaceNotificationEvent.countDocuments()).toBe(0);
  });
  it.each(['organization', 'project'])('fences queued work when its %s is paused and requires resubmission', async scope => {
    const queued = await queuePlanning(access, String(objective._id), randomUUID());
    const controls = { userId: access.userId, organizationId: access.organizationId,
      projectId: scope === 'project' ? String(access.project._id) : undefined };
    await saveBudgetSettings(controls, 0, { limitMicros: null, paused: true });
    await expect(queuePlanning(access, String(objective._id), randomUUID())).rejects.toThrow();
    expect((await processPlanningQueue()).status).toBe('blocked'); expect(model).not.toHaveBeenCalled();
    expect((await AiRun.findById(queued.runId))?.status).toBe('blocked');
    expect((await budgetSettingsView(access.organizationId, String(access.project._id))).parentPaused).toBe(scope === 'organization');
    await saveBudgetSettings(controls, 1, { limitMicros: null, paused: false });
    await queuePlanning(access, String(objective._id), randomUUID());
    expect((await processPlanningQueue()).status).toBe('processed');
  });
  it('rejects returned drafts when a manager pauses during inference', async () => {
    await queuePlanning(access, String(objective._id), randomUUID());
    model.mockImplementationOnce(async () => {
      await saveBudgetSettings({ userId: access.userId, organizationId: access.organizationId, projectId: undefined },
        0, { limitMicros: null, paused: true });
      return response;
    });
    expect((await processPlanningQueue()).status).toBe('blocked');
    expect(await AiPlan.countDocuments()).toBe(0);
    expect((await AiBudget.find()).every(budget => budget.reservedMicros === 25)).toBe(true);
  });
  it('clears copied input atomically on queued cancellation while preserving provenance', async () => {
    const { runId } = await queuePlanning(access, String(objective._id), randomUUID());
    const before = await AiPlanningJob.findOne({ runId });
    await cancelPlanning(access, runId);
    const after = await AiPlanningJob.findOne({ runId });
    expect(after?.input).toBe(CLEARED_PLANNING_CONTEXT); expect(after?.inputClearedAt).toBeInstanceOf(Date);
    expect(after?.inputDigest).toBe(before?.inputDigest);
    expect(await AiObjective.countDocuments()).toBe(1); expect(await AiRun.countDocuments()).toBe(1);
    expect(await clearTerminalPlanningContexts()).toBe(0);
  });
  it('bounds legacy cleanup and leaves active inputs and historical records intact', async () => {
    const { runId } = await queuePlanning(access, String(objective._id), randomUUID());
    const active = await AiPlanningJob.findOne({ runId }).lean();
    await AiPlanningJob.collection.insertMany(Array.from({ length: 105 }, () => ({ ...active,
      _id: new Types.ObjectId(), runId: new Types.ObjectId(), requestId: randomUUID(), active: false, status: 'cancelled' })));
    expect(await clearTerminalPlanningContexts()).toBe(100);
    expect(await clearTerminalPlanningContexts()).toBe(5);
    expect(await clearTerminalPlanningContexts()).toBe(0);
    expect((await AiPlanningJob.findOne({ runId }))?.input).toBe(active?.input);
    expect(await AiPlanningJob.countDocuments()).toBe(106);
    expect(await AiObjective.countDocuments()).toBe(1); expect(await AiRun.countDocuments()).toBe(1);
  });
  it('runs context maintenance while inference dispatch is paused', async () => {
    const { runId } = await queuePlanning(access, String(objective._id), randomUUID());
    await cancelPlanning(access, runId);
    await AiPlanningJob.updateOne({ runId }, { $set: { input: 'legacy copied context' }, $unset: { inputClearedAt: 1 } });
    await AiSettings.updateOne({ _id: platformSettingsId }, { $set: { 'value.dispatchEnabled': false } });
    expect((await processPlanningQueue()).status).toBe('disabled');
    expect((await AiPlanningJob.findOne({ runId }))?.input).toBe(CLEARED_PLANNING_CONTEXT);
    expect(model).not.toHaveBeenCalled();
  });
  it('rolls back quota with a failed dispatch transaction', async () => {
    await expect(aiTransaction(async session => {
      expect(await reserveDispatch(defaultPlatformAiSettings, new Date(), session)).toBe(true);
      throw new Error('Synthetic marker failure');
    })).rejects.toThrow('Synthetic marker failure');
    expect(await AiDispatchUsage.countDocuments()).toBe(0);
  });
  it('serializes concurrent reservations and never resets usage on settings edits', async () => {
    const limits = { dailyRequestLimit: 1, minimumIntervalSeconds: 300 };
    // Pre-create the singleton to exercise transaction write-conflict retry.
    await AiDispatchUsage.create({ _id: DISPATCH_USAGE_ID, day: '2000-01-01', attempts: 0, lastStartedAt: new Date(0) });
    const results = await Promise.all([1, 2].map(() => aiTransaction(session => reserveDispatch(limits, new Date(), session))));
    expect(results.filter(Boolean)).toHaveLength(1);
    const settings = await readPlatformSettings();
    await saveSettings(platformSettingsId, settings.revision, { ...settings.value, maxOutputTokens: 1024 }, access.userId);
    expect((await AiDispatchUsage.findById(DISPATCH_USAGE_ID))?.attempts).toBe(1);
  });
  it('keeps throttled jobs queued and cancellable without sending another request', async () => {
    await queuePlanning(access, String(objective._id), randomUUID());
    await processPlanningQueue();
    expect(model.mock.calls[0][1].maxOutputTokens).toBe(3072);
    const next = await queuePlanning(access, String(objective._id), randomUUID());
    expect((await processPlanningQueue()).status).toBe('throttled');
    expect(model).toHaveBeenCalledTimes(1);
    expect((await AiRun.findById(next.runId))?.status).toBe('queued');
    await cancelPlanning(access, next.runId);
    expect((await AiRun.findById(next.runId))?.status).toBe('cancelled');
    expect((await AiDispatchUsage.findById(DISPATCH_USAGE_ID))?.attempts).toBe(1);
  });
  it('enforces the daily cap after cooldown and counts invalid responses', async () => {
    await AiSettings.updateOne({ _id: platformSettingsId }, { $set: { 'value.dailyRequestLimit': 1 } });
    model.mockResolvedValue({ ...response, content: 'invalid JSON' });
    await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    await AiDispatchUsage.updateOne({ _id: DISPATCH_USAGE_ID }, { $set: { lastStartedAt: new Date(Date.now() - 360000) } });
    await queuePlanning(access, String(objective._id), randomUUID());
    expect((await processPlanningQueue()).status).toBe('throttled');
    expect(model).toHaveBeenCalledTimes(1);
    await AiDispatchUsage.updateOne({ _id: DISPATCH_USAGE_ID }, { $set: { day: '2000-01-01' } });
    model.mockResolvedValue(response);
    expect((await processPlanningQueue()).status).toBe('processed');
    expect((await AiDispatchUsage.findById(DISPATCH_USAGE_ID))?.attempts).toBe(1);
  });
  const attentionAccess = () => ({ userId: access.userId, organizationId: access.organizationId, employeeId: String(access.employeeId),
    canManage: access.canManage, ownerIds: access.ownerIds });
  it('shows review-ready runs only to project contributors and organization managers', async () => {
    const queued = await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    expect((await listAttention(attentionAccess(), 'review', null)).items.map(item => item.id)).toEqual([queued.runId]);
    expect((await listAttention({ ...attentionAccess(), canManage: false }, 'review', null)).items).toHaveLength(1);
    expect((await listAttention({ ...attentionAccess(), canManage: false, employeeId: String(new Types.ObjectId()) }, 'review', null)).items).toHaveLength(0);
    expect((await listAttention({ ...attentionAccess(), organizationId: 'other-org' }, 'review', null)).items).toHaveLength(0);
    expect((await listAttention(attentionAccess(), 'issues', null)).items).toHaveLength(0);
  });
  it('acknowledges only one user and revision without changing run state or events', async () => {
    const queued = await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    const run = await AiRun.findById(queued.runId); const eventCount = await AiRunEvent.countDocuments();
    await acknowledgeRun(access, queued.runId, run!.revision); await acknowledgeRun(access, queued.runId, run!.revision);
    expect(await AiRunAcknowledgement.countDocuments()).toBe(1);
    expect((await listAttention(attentionAccess(), 'all', null)).items).toHaveLength(0);
    expect((await listAttention({ ...attentionAccess(), userId: String(new Types.ObjectId()) }, 'all', null)).items).toHaveLength(1);
    expect((await AiRun.findById(queued.runId))?.status).toBe('awaiting_acceptance'); expect(await AiRunEvent.countDocuments()).toBe(eventCount);
    await AiRun.updateOne({ _id: run!._id }, { $inc: { revision: 1 } });
    expect((await listAttention(attentionAccess(), 'all', null)).items).toHaveLength(1);
    await expect(acknowledgeRun(access, queued.runId, run!.revision)).rejects.toMatchObject({ status: 409 });
    await expect(acknowledgeRun({ ...access, organizationId: 'other-org' }, queued.runId, run!.revision + 1)).rejects.toMatchObject({ status: 404 });
  });
  it('bounds scans across inaccessible projects without skipping the next accessible item', async () => {
    const employeeId = new Types.ObjectId();
    const visible = await Project.create({ userId: access.userId, name: 'Visible project', assignedToEmployeeIds: [employeeId] });
    const row = { organizationId: access.organizationId, projectId: access.project._id, role: 'architect', status: 'blocked', revision: 0,
      createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date(), inputDigest: 'a'.repeat(64), policyDigest: 'b'.repeat(64), createdByUserId: new Types.ObjectId(access.userId) };
    await AiRun.collection.insertMany(Array.from({ length: 160 }, () => ({ ...row, _id: new Types.ObjectId() })));
    const visibleId = new Types.ObjectId();
    await AiRun.collection.insertOne({ ...row, _id: visibleId, projectId: visible._id, createdAt: new Date('2026-08-01T00:00:00Z') });
    const viewer = { ...attentionAccess(), canManage: false, employeeId: String(employeeId) };
    const first = await listAttention(viewer, 'issues', null);
    expect(first.items).toHaveLength(0); expect(first.nextCursor).not.toBeNull();
    const next = await listAttention(viewer, 'issues', first.nextCursor);
    expect(next.items.map(item => item.id)).toEqual([String(visibleId)]); expect(next.nextCursor).toBeNull();
  });
  it('rechecks ownership and assignment revocation on each attention refresh', async () => {
    await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    const viewer = { ...attentionAccess(), canManage: false };
    expect((await listAttention(viewer, 'all', null)).items).toHaveLength(1);
    await Project.updateOne({ _id: access.project._id }, { $set: { tasks: [], assignedToEmployeeIds: [], assignedToEmployeeId: null } });
    expect((await listAttention(viewer, 'all', null)).items).toHaveLength(0);
    await Project.updateOne({ _id: access.project._id }, { $set: { userId: new Types.ObjectId() } });
    expect((await listAttention(attentionAccess(), 'all', null)).items).toHaveLength(0);
  });
  it.each(['objectives', 'plans'] as const)('paginates %s summaries without duplicates or leaking another organization', async kind => {
    const createdAt = new Date('2026-09-01T00:00:00Z');
    const records = Array.from({ length: 31 }, (_, index) => ({ _id: new Types.ObjectId(), organizationId: access.organizationId,
      projectId: access.project._id, requestId: randomUUID(), createdAt, updatedAt: createdAt, title: `Objective ${index}`, summary: `Plan ${index}`,
      outcome: 'private-outcome', tasks: [{ name: 'private-task' }], status: 'draft', source: 'human', expiresAt: new Date(Date.now() + 86400000) }));
    const collection = kind === 'objectives' ? AiObjective.collection : AiPlan.collection;
    await collection.insertMany(records);
    await collection.insertOne({ ...records[0], _id: new Types.ObjectId(), organizationId: 'other-org', createdAt: new Date() });
    const first = await listLibrary(access, kind, null); expect(first.items).toHaveLength(25);
    await collection.insertOne({ ...records[0], _id: new Types.ObjectId(), requestId: randomUUID(), createdAt: new Date() });
    const second = await listLibrary(access, kind, first.nextCursor);
    // The setup includes one existing objective, but no existing plan.
    expect(second.items).toHaveLength(kind === 'objectives' ? 7 : 6); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(kind === 'objectives' ? 32 : 31);
    expect(JSON.stringify(first)).not.toContain('private-outcome'); expect(JSON.stringify(first)).not.toContain('private-task');
  });
  it('loads an older plan exactly and approval replay preserves task identity', async () => {
    const queued = await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    const plan = await AiPlan.findOne({ runId: queued.runId });
    await AiPlan.collection.insertMany(Array.from({ length: 26 }, () => ({ _id: new Types.ObjectId(), organizationId: access.organizationId,
      projectId: access.project._id, requestId: randomUUID(), summary: 'Newer plan', status: 'draft', source: 'human', createdAt: new Date(Date.now() + 1000), expiresAt: new Date(Date.now() + 86400000) })));
    expect((await listLibrary(access, 'plans', null)).items.some(item => item.id === String(plan!._id))).toBe(false);
    const detail = await getLibraryPlan(access, String(plan!._id));
    expect(detail.digest).toBe(plan!.digest); expect(detail.stale).toBe(false); expect(detail.expired).toBe(false);
    expect((await getLibraryObjective(access, detail.objectiveId)).title).toBe(objective.title);
    const first = await approvePlan(access, detail.id, detail.digest);
    const replay = await approvePlan(access, detail.id, detail.digest);
    expect(first!.taskIds).toEqual(replay!.taskIds); expect(replay!.alreadyApproved).toBe(true);
    expect((await getLibraryPlan(access, detail.id)).materializedTaskIds).toEqual(first!.taskIds);
  });
  it('denies foreign objective/plan detail reads and reports stale/expired drafts without mutating tasks', async () => {
    const queued = await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    const plan = await AiPlan.findOne({ runId: queued.runId });
    await expect(getLibraryObjective({ ...access, organizationId: 'other-org' }, String(objective._id))).rejects.toMatchObject({ status: 404 });
    await expect(getLibraryPlan({ ...access, organizationId: 'other-org' }, String(plan!._id))).rejects.toMatchObject({ status: 404 });
    await AiPlan.updateOne({ _id: plan!._id }, { $set: { expiresAt: new Date(0), projectUpdatedAt: new Date(0) } });
    expect(await getLibraryPlan(access, String(plan!._id))).toMatchObject({ expired: true, stale: true });
    expect((await Project.findById(access.project._id))?.tasks).toHaveLength(1);
    await expect(approvePlan(access, String(plan!._id), plan!.digest)).rejects.toMatchObject({ status: 409 });
  });
  it('paginates tied timestamps without duplicate runs, including when new runs arrive', async () => {
    const createdAt = new Date('2026-09-01T00:00:00Z');
    const records = Array.from({ length: 31 }, () => ({ _id: new Types.ObjectId(), organizationId: access.organizationId,
      projectId: access.project._id, role: 'architect', status: 'blocked', revision: 0, createdAt, updatedAt: createdAt,
      inputDigest: 'a'.repeat(64), policyDigest: 'b'.repeat(64), createdByUserId: new Types.ObjectId(access.userId) }));
    await AiRun.collection.insertMany(records);
    await AiRun.collection.insertOne({ ...records[0], _id: new Types.ObjectId(), organizationId: 'other-org' });
    const first = await listProjectRuns(access, null); expect(first.runs).toHaveLength(25);
    await AiRun.collection.insertOne({ ...records[0], _id: new Types.ObjectId(), createdAt: new Date() });
    const second = await listProjectRuns(access, first.nextCursor);
    expect(second.runs).toHaveLength(6); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.runs, ...second.runs].map(run => run.id)).size).toBe(31);
  });
  it('redacts private job fields and keeps both reservation scopes distinct', async () => {
    const queued = await queuePlanning(access, String(objective._id), randomUUID());
    await AiPlanningJob.updateOne({ runId: queued.runId }, { $set: { leaseToken: 'private-lease', input: 'private-prompt' } });
    const detail = await getRunDetail(access, queued.runId);
    expect(detail.run.costMicros).toBeNull(); expect(detail.run.inputTokens).toBeNull();
    expect(detail.reservations).toHaveLength(2);
    expect(detail.reservations.map(item => item.scope).sort()).toEqual(['organization', 'project']);
    const serialized = JSON.stringify(detail);
    for (const text of ['private-lease', 'private-prompt', 'synthetic-only', 'createdByUserId', 'spentMicros']) expect(serialized).not.toContain(text);
    await expect(getRunDetail({ ...access, organizationId: 'other-org' }, queued.runId)).rejects.toMatchObject({ status: 404 });
    await expect(getRunEvents({ ...access, organizationId: 'other-org' }, queued.runId, null)).rejects.toMatchObject({ status: 404 });
  });
  it('paginates events by sequence and excludes mismatched project events', async () => {
    const queued = await queuePlanning(access, String(objective._id), randomUUID());
    await AiRunEvent.insertMany(Array.from({ length: 60 }, (_, index) => ({ organizationId: access.organizationId,
      projectId: access.project._id, runId: queued.runId, sequence: index + 1, type: 'test.event', summary: 'Synthetic event' })));
    await AiRunEvent.create({ organizationId: access.organizationId, projectId: new Types.ObjectId(), runId: queued.runId,
      sequence: 999, type: 'test.event', summary: 'Must not be exposed' });
    const first = await getRunEvents(access, queued.runId, null);
    expect(first.events).toHaveLength(50); expect(first.nextAfter).toBe(49);
    const second = await getRunEvents(access, queued.runId, String(first.nextAfter));
    expect(second.events).toHaveLength(11); expect(second.nextAfter).toBeNull();
    expect(second.events.map(event => event.sequence)).toEqual(Array.from({ length: 11 }, (_, index) => index + 50));
  });
  it('persists audited settings and rejects concurrent stale saves', async () => {
    const prior = await readPlatformSettings();
    const results = await Promise.all([
      saveSettings(platformSettingsId, prior.revision, { ...prior.value, model: 'model-a' }, access.userId),
      saveSettings(platformSettingsId, prior.revision, { ...prior.value, model: 'model-b' }, access.userId),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await readPlatformSettings()).revision).toBe(1);
    expect(await AiSettingsAudit.countDocuments()).toBe(1);
    expect(JSON.stringify(await AiSettingsAudit.find().lean())).not.toContain('synthetic-only');
  });
  it('honors lower scoped limits without changing another organization', async () => {
    await saveBudgetSettings({ userId: access.userId, organizationId: access.organizationId, projectId: undefined }, 0, { limitMicros: 50 });
    expect((await getPlanningPolicy(access.organizationId, String(access.project._id))).organizationLimitMicros).toBe(50);
    expect((await getPlanningPolicy('another-organization', String(new Types.ObjectId()))).organizationLimitMicros).toBe(100);
    await expect(saveBudgetSettings({ userId: access.userId, organizationId: access.organizationId, projectId: String(access.project._id) }, 0, { limitMicros: 60 })).rejects.toMatchObject({ status: 400 });
  });
  it('supports a zero project limit and clamped inheritance without clearing reservations', async () => {
    const projectAccess = { userId: access.userId, organizationId: access.organizationId, projectId: String(access.project._id) };
    await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    await saveBudgetSettings(projectAccess, 0, { limitMicros: 0 });
    await expect(queuePlanning(access, String(objective._id), randomUUID())).rejects.toThrow();
    expect((await AiBudget.find()).every(budget => budget.reservedMicros === 25)).toBe(true);
    await saveBudgetSettings(projectAccess, 1, { limitMicros: null });
    expect((await budgetSettingsView(access.organizationId, projectAccess.projectId)).effectiveLimitMicros).toBe(75);
    expect((await AiBudget.find()).every(budget => budget.reservedMicros === 25)).toBe(true);
  });
  it('pauses the worker through saved settings and blocks outdated queued policy after resuming', async () => {
    const queued = await queuePlanning(access, String(objective._id), randomUUID());
    const prior = await readPlatformSettings();
    await saveSettings(platformSettingsId, prior.revision, { ...prior.value, dispatchEnabled: false }, access.userId);
    expect(await processPlanningQueue()).toEqual({ status: 'disabled' });
    expect(model).not.toHaveBeenCalled();
    await saveSettings(platformSettingsId, prior.revision + 1, prior.value, access.userId);
    expect((await processPlanningQueue()).status).toBe('blocked');
    expect((await AiRun.findById(queued.runId))?.failureCode).toBe('stale_input_or_policy');
    expect(model).not.toHaveBeenCalled();
  });
  it('rejects drafts when saved settings change during inference', async () => {
    const queued = await queuePlanning(access, String(objective._id), randomUUID());
    model.mockImplementationOnce(async () => {
      const prior = await readPlatformSettings();
      await saveSettings(platformSettingsId, prior.revision, { ...prior.value, model: 'replacement-model' }, access.userId);
      return response;
    });
    expect((await processPlanningQueue()).status).toBe('blocked');
    expect(await AiPlan.countDocuments({ runId: queued.runId })).toBe(0);
  });
  it('queues once, creates a draft, and materializes tasks only on human approval', async () => {
    const requestId = randomUUID();
    const queued = await queuePlanning(access, String(objective._id), requestId);
    expect(await queuePlanning(access, String(objective._id), requestId)).toMatchObject({ runId: queued.runId, alreadyQueued: true });
    expect(await AiPlanningJob.countDocuments()).toBe(1);
    expect((await Project.findById(access.project._id))?.tasks).toHaveLength(1);
    await processPlanningQueue();
    expect(model).toHaveBeenCalledTimes(1);
    const plan = await AiPlan.findOne({ runId: queued.runId });
    expect(plan?.source).toBe('remote-model');
    expect((await AiRun.findById(queued.runId))?.status).toBe('awaiting_acceptance');
    expect((await Project.findById(access.project._id))?.tasks).toHaveLength(1);
    await approvePlan(access, String(plan!._id), plan!.digest);
    await approvePlan(access, String(plan!._id), plan!.digest);
    const updated = await Project.findById(access.project._id);
    expect(updated?.tasks).toHaveLength(2);
    expect(updated?.tasks?.[0].assignedToEmployeeIds?.map(String)).toEqual(access.project.tasks?.[0].assignedToEmployeeIds?.map(String));
    expect((await AiRun.findById(queued.runId))?.status).toBe('completed');
    expect((await AiRunEvent.find({ runId: queued.runId })).map(event => event.sequence)).toEqual([0, 1, 2, 3]);
  });
  it('serializes concurrent duplicate submissions and leaves one reservation per scope', async () => {
    const requestId = randomUUID();
    const results = await Promise.allSettled([queuePlanning(access, String(objective._id), requestId), queuePlanning(access, String(objective._id), requestId)]);
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    expect(await AiPlanningJob.countDocuments()).toBe(1);
    expect(await AiRun.countDocuments()).toBe(1);
    expect(await AiBudgetReservation.countDocuments()).toBe(2);
    expect((await AiBudget.find()).every(budget => budget.reservedMicros === 25)).toBe(true);
  });
  it('rolls back run/job creation if the project budget cannot be reserved', async () => {
    await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    await AiDispatchUsage.updateOne({ _id: DISPATCH_USAGE_ID }, { $set: { lastStartedAt: new Date(Date.now() - 360000) } });
    await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    await AiDispatchUsage.updateOne({ _id: DISPATCH_USAGE_ID }, { $set: { lastStartedAt: new Date(Date.now() - 360000) } });
    await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    await expect(queuePlanning(access, String(objective._id), randomUUID())).rejects.toThrow('Budget unavailable');
    expect(await AiRun.countDocuments()).toBe(3);
    expect(await AiPlanningJob.countDocuments()).toBe(3);
    expect((await AiBudget.find()).every(budget => budget.reservedMicros === 75)).toBe(true);
  });
  it('cancels queued work and releases its reservations without inference', async () => {
    const { runId } = await queuePlanning(access, String(objective._id), randomUUID());
    await cancelPlanning(access, runId); await processPlanningQueue();
    expect(model).not.toHaveBeenCalled();
    expect((await AiRun.findById(runId))?.status).toBe('cancelled');
    expect((await AiBudget.find()).every(budget => budget.reservedMicros === 0)).toBe(true);
  });
  it('discards returned drafts when cancellation arrives during inference', async () => {
    const { runId } = await queuePlanning(access, String(objective._id), randomUUID());
    model.mockImplementation(async () => { await cancelPlanning(access, runId); return response; });
    await processPlanningQueue();
    expect(await AiPlan.countDocuments()).toBe(0);
    expect((await AiRun.findById(runId))?.status).toBe('cancelled');
    expect((await AiBudget.find()).every(budget => budget.reservedMicros === 25)).toBe(true);
  });
  it('blocks stale project snapshots before sending data', async () => {
    const { runId } = await queuePlanning(access, String(objective._id), randomUUID());
    await Project.updateOne({ _id: access.project._id }, { $set: { name: 'Changed' } });
    await processPlanningQueue();
    expect(model).not.toHaveBeenCalled();
    expect((await AiRun.findById(runId))?.failureCode).toBe('stale_input_or_policy');
  });
  it('rechecks revoked membership and never sends an unauthorized objective', async () => {
    await queuePlanning(access, String(objective._id), randomUUID());
    await Employee.updateOne({ _id: access.employeeId }, { $set: { role: 'User' } });
    await processPlanningQueue(); expect(model).not.toHaveBeenCalled(); expect(await AiPlan.countDocuments()).toBe(0);
  });
  it('does not publish a draft if the project changes during inference', async () => {
    await queuePlanning(access, String(objective._id), randomUUID());
    model.mockImplementation(async () => { await Project.updateOne({ _id: access.project._id }, { $set: { name: 'Changed during inference' } }); return response; });
    await processPlanningQueue(); expect(await AiPlan.countDocuments()).toBe(0);
    expect((await AiBudget.find()).every(budget => budget.reservedMicros === 25)).toBe(true);
  });
  it('rejects malformed model output without retries or project changes', async () => {
    await queuePlanning(access, String(objective._id), randomUUID());
    model.mockResolvedValue({ ...response, content: 'not JSON' }); await processPlanningQueue();
    expect(model).toHaveBeenCalledTimes(1); expect(await AiPlan.countDocuments()).toBe(0);
    expect((await Project.findById(access.project._id))?.tasks).toHaveLength(1);
  });
  it('fences an expired attempt and retains unknown charges instead of replaying', async () => {
    const { runId } = await queuePlanning(access, String(objective._id), randomUUID());
    await AiPlanningJob.updateOne({ runId }, { $set: { status: 'running', leaseToken: 'expired', leaseExpiresAt: new Date(0), dispatchedAt: new Date(0) } });
    await processPlanningQueue();
    expect(model).not.toHaveBeenCalled();
    expect((await AiRun.findById(runId))?.failureCode).toBe('lease_expired');
    expect((await AiBudget.find()).every(budget => budget.reservedMicros === 25)).toBe(true);
  });
  it('prevents overlapping cron invocations', async () => {
    await queuePlanning(access, String(objective._id), randomUUID());
    await AiDispatchLock.create({ _id: 'remote-planning-v1', token: 'held', expiresAt: new Date(Date.now() + 60000) });
    expect(await processPlanningQueue()).toEqual({ status: 'busy' }); expect(model).not.toHaveBeenCalled();
  });
  it('fences a late response after the lease expires', async () => {
    const { runId } = await queuePlanning(access, String(objective._id), randomUUID());
    model.mockImplementation(async () => {
      await AiPlanningJob.updateOne({ runId }, { $set: { leaseExpiresAt: new Date(0) } });
      return response;
    });
    expect((await processPlanningQueue()).status).toBe('lease_lost');
    expect(await AiPlan.countDocuments()).toBe(0);
    await processPlanningQueue();
    expect(model).toHaveBeenCalledTimes(1);
    expect((await AiRun.findById(runId))?.failureCode).toBe('lease_expired');
  });
  it('refuses an objective from another organization without allocating budget', async () => {
    await AiObjective.updateOne({ _id: objective._id }, { $set: { organizationId: 'other-org' } });
    await expect(queuePlanning(access, String(objective._id), randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(await AiRun.countDocuments()).toBe(0); expect(await AiBudgetReservation.countDocuments()).toBe(0);
  });
  it('records an explicit no-provider-fee result separately from unknown pricing', async () => {
    await AiSettings.updateOne({ _id: platformSettingsId }, { $set: { 'value.noProviderFee': true } });
    const { runId } = await queuePlanning(access, String(objective._id), randomUUID()); await processPlanningQueue();
    expect((await AiRun.findById(runId))?.costMicros).toBe(0);
    expect((await AiBudget.find()).every(budget => budget.reservedMicros === 0)).toBe(true);
  });
});
