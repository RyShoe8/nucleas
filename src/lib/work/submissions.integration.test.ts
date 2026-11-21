import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
vi.mock('server-only', () => ({}));
import { CompanyAssistantTurn } from '@/lib/models/CompanyAssistantTurn';
import { Job } from '@/lib/models/Job';
import { claimWorkDraft, finishWorkDraft, readWorkDraft, releaseWorkDraft } from './submissions';
const viewer = { userId: String(new Types.ObjectId()), organizationId: new Types.ObjectId(), role: 'Administrator' as const, employeeId: null };
const companyId = String(new Types.ObjectId());
let mongo: MongoMemoryServer;
beforeAll(async () => { mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } }); await mongoose.connect(mongo.getUri('work_submissions_test')); }, 120_000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await CompanyAssistantTurn.deleteMany({}); await Job.deleteMany({}); });
async function draft() { return String((await CompanyAssistantTurn.create({ ...viewer, role: 'assistant', text: 'Proposed work', workDraft: { companyId, companyName: 'Company', outcome: 'Improve our review pages.' } }))._id); }
it('allows one submission across concurrent tabs and returns the original work on later clicks', async () => {
    const id = await draft();
    const results = await Promise.allSettled([claimWorkDraft(viewer, id, companyId), claimWorkDraft(viewer, id, companyId)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const won = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<{ token: string }>;
    const created = { kind: 'job' as const, id: String(new Types.ObjectId()) };
    await finishWorkDraft(viewer, id, won.value.token, created);
    expect(await claimWorkDraft(viewer, id, companyId)).toEqual({ created });
});
it('recovers a persisted job if the request stopped before linking the reply', async () => {
    const id = await draft(); await claimWorkDraft(viewer, id, companyId);
    const job = await Job.create({ organizationId: viewer.organizationId, companyId, createdByUserId: viewer.userId, sourceTurnId: id, request: 'Improve our review pages.', status: 'designing' });
    expect((await readWorkDraft(viewer, id))?.created).toEqual({ kind: 'job', id: String(job._id) });
    expect((await readWorkDraft(viewer, id))?.submission).toBeUndefined();
});
it('refuses another user, organization or company and releases a failed preparation safely', async () => {
    const id = await draft();
    expect(await readWorkDraft({ ...viewer, userId: String(new Types.ObjectId()) }, id)).toBeNull();
    expect(await readWorkDraft({ ...viewer, organizationId: new Types.ObjectId() }, id)).toBeNull();
    await expect(claimWorkDraft(viewer, id, String(new Types.ObjectId()))).rejects.toThrow('not found');
    const claim = await claimWorkDraft(viewer, id, companyId);
    await releaseWorkDraft(viewer, id, 'wrong-token');
    await expect(claimWorkDraft(viewer, id, companyId)).rejects.toThrow('already');
    await releaseWorkDraft(viewer, id, claim.token!);
    expect((await claimWorkDraft(viewer, id, companyId)).token).toBeTruthy();
});
