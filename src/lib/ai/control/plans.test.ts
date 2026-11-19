import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { planDraftSchema } from '@nucleas/ai-contracts';
import Project from '@/lib/models/Project';
import User from '@/lib/models/User';
import Employee from '@/lib/models/Employee';
import { AiPlan } from '@/lib/models/AiControl';
import { approvePlan, buildApprovedTasks, planDigest } from './plans';
import type { requireAiProject } from './access';

vi.mock('./access', () => ({ AiHttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
const draft = planDraftSchema.parse({ summary: 'Small change', tasks: [
  { key: 'code', name: 'Implement', acceptanceCriteria: ['Unit tests pass'] },
  { key: 'review', name: 'Review', acceptanceCriteria: ['Diff accepted'], dependsOn: ['code'] },
] });
const project = new Project({ name: 'Existing', userId: new Types.ObjectId(), tasks: [{ name: 'Human work', assignedToEmployeeIds: [new Types.ObjectId(), new Types.ObjectId()] }] });
const access = { userId: new Types.ObjectId().toString(), organizationId: 'org-a', employeeId: new Types.ObjectId(), project,
  canManage: true, ownerIds: [project.userId],
} satisfies Awaited<ReturnType<typeof requireAiProject>>;
let plan: InstanceType<typeof AiPlan>;
let update: MockInstance<typeof Project.updateOne>;
let save: MockInstance<InstanceType<typeof AiPlan>['save']>;
beforeEach(() => {
  vi.restoreAllMocks();
  plan = new AiPlan({ organizationId: 'org-a', projectId: project._id, objectiveId: new Types.ObjectId(),
    requestId: 'request', createdByUserId: access.userId, ...draft, digest: planDigest(draft),
    projectUpdatedAt: new Date('2026-01-01'), expiresAt: new Date(Date.now() + 60000),
  });
  // Unit-test transaction orchestration only: no claim of a real replica-set integration test.
  vi.spyOn(mongoose, 'startSession').mockResolvedValue({
    withTransaction: async (callback: () => Promise<unknown>) => callback(), endSession: vi.fn(),
  } as unknown as mongoose.ClientSession);
  vi.spyOn(AiPlan, 'findOne').mockReturnValue({ session: async () => plan } as unknown as ReturnType<typeof AiPlan.findOne>);
  vi.spyOn(User, 'exists').mockReturnValue({ session: async () => ({ _id: access.userId }) } as unknown as ReturnType<typeof User.exists>);
  vi.spyOn(Employee, 'exists').mockReturnValue({ session: async () => ({ _id: access.employeeId }) } as unknown as ReturnType<typeof Employee.exists>);
  update = vi.spyOn(Project, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as Awaited<ReturnType<typeof Project.updateOne>>);
  save = vi.spyOn(plan, 'save').mockResolvedValue(plan);
});
describe('immutable plan approval', () => {
  it('creates stable dependency IDs without assigning an AI to a human field', () => {
    const tasks = buildApprovedTasks(draft, plan.objectiveId, plan._id, access.employeeId);
    expect(tasks[1].dependencyTaskIds[0]).toEqual(tasks[0]._id);
    expect(tasks[0].assignedToEmployeeIds).toEqual([]);
    expect(tasks[0].status).toBe('active');
  });
  it('appends tasks using the reviewed project version', async () => {
    const before = JSON.stringify(project.tasks);
    await approvePlan(access, String(plan._id), plan.digest);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: plan.projectUpdatedAt, userId: { $in: access.ownerIds } }),
      expect.objectContaining({ $push: { tasks: { $each: expect.any(Array) } }, $inc: { __v: 1 } }), expect.objectContaining({ session: expect.anything() }));
    expect(JSON.stringify(project.tasks)).toBe(before);
    expect(plan.status).toBe('approved');
  });
  it('returns prior acceptance on replay without creating more tasks', async () => {
    plan.status = 'approved'; plan.materializedTaskIds = [new Types.ObjectId()];
    await expect(approvePlan(access, String(plan._id), plan.digest)).resolves.toMatchObject({ alreadyApproved: true });
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects stale projects without consuming approval', async () => {
    update.mockResolvedValue({ modifiedCount: 0 } as Awaited<ReturnType<typeof Project.updateOne>>);
    await expect(approvePlan(access, String(plan._id), plan.digest)).rejects.toMatchObject({ status: 409 });
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects mismatched digests and expiry', async () => {
    await expect(approvePlan(access, String(plan._id), 'wrong')).rejects.toMatchObject({ status: 409 });
    plan.expiresAt = new Date(0);
    await expect(approvePlan(access, String(plan._id), plan.digest)).rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects non-managers even if the caller bypasses the route', async () => {
    await expect(approvePlan({ ...access, canManage: false }, String(plan._id), plan.digest)).rejects.toMatchObject({ status: 403 });
  });
  it('rechecks approval authority inside the transaction', async () => {
    vi.mocked(Employee.exists).mockReturnValue({ session: async () => null } as unknown as ReturnType<typeof Employee.exists>);
    await expect(approvePlan(access, String(plan._id), plan.digest)).rejects.toMatchObject({ status: 403 });
    expect(update).not.toHaveBeenCalled();
  });
});
