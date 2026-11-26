import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ profile: vi.fn(), profiles: vi.fn(), viewer: vi.fn(), design: vi.fn(), approve: vi.fn(), execute: vi.fn(), page: vi.fn() }));
vi.mock('@/lib/companies/companyProfile', () => ({ getCompanyProfile: mocks.profile, listCompanyProfiles: mocks.profiles, loadCompanyViewer: mocks.viewer, isCompanyManager: (v: { role: string }) => ['Administrator', 'Manager'].includes(v.role) }));
vi.mock('@/lib/jobs/jobs', () => ({ runDesign: mocks.design, approveJob: mocks.approve, executeJobRun: mocks.execute }));
vi.mock('@/lib/ai/tools/webFetch', () => ({ webFetch: mocks.page }));
vi.mock('@/lib/ai/engine/select', () => ({ readEngineSettings: async () => ({ defaultCostLevel: 'medium' }) }));
vi.mock('@/lib/ai/control/settings', () => ({ readBudgetSettings: async () => ({ value: { itemCapMicros: 2e6 } }) }));
import { WorkBudget } from '@/lib/models/WorkBudget';
import { WorkResponsibility, WorkAssessment, WorkAgreementVersion } from '@/lib/models/WorkResponsibility';
import { Job, JobRun } from '@/lib/models/Job';
import { workAgreementSchema } from './agreements';
import { createResponsibility, listResponsibilities, updateResponsibility, advanceResponsibility } from './responsibilities';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
let repl: MongoMemoryReplSet;
const org = new Types.ObjectId(), cid = new Types.ObjectId();
const viewer: CompanyViewer = { userId: String(new Types.ObjectId()), organizationId: org, employeeId: null, role: 'Administrator' };
const profile = { id: String(cid), name: 'Company', domain: 'example.com', websites: ['example.com'] };
const agreement = workAgreementSchema.parse({ mode: 'ongoing', role: 'marketing', outcome: 'Improve every review page.', standard: 'Useful original analysis with verified evidence.', gates: ['Verify every material claim.'], threshold: 85, maxPending: 1, targets: ['https://example.com/reviews/a', 'https://example.com/reviews/b'] });
beforeAll(async () => { repl = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger' } }); await mongoose.connect(repl.getUri('responsibilities_test')); }, 120_000);
afterAll(async () => { await mongoose.disconnect(); await repl?.stop(); });
afterEach(() => vi.useRealTimers());
beforeEach(async () => {
    await Promise.all([Job.deleteMany({}), JobRun.deleteMany({}), WorkResponsibility.deleteMany({}), WorkAssessment.deleteMany({}), WorkAgreementVersion.deleteMany({}), WorkBudget.deleteMany({})]); vi.resetAllMocks();
    mocks.profile.mockImplementation(async (v: CompanyViewer, id: string) => String(v.organizationId) === String(org) && id === String(cid) ? profile : null);
    mocks.profiles.mockImplementation(async (v: CompanyViewer) => String(v.organizationId) === String(org) ? [profile] : []);
    mocks.viewer.mockResolvedValue(viewer); mocks.page.mockResolvedValue({ text: 'Verified complete page content', thin: false });
    mocks.design.mockImplementation(async (_v, id) => { await Job.updateOne({ _id: id }, { $set: { status: 'proposed' } }); });
    mocks.approve.mockImplementation(async (_v, id) => { await Job.updateOne({ _id: id }, { $set: { status: 'ready' } }); return { ok: true, dryRunId: 'run' }; });
});
async function active() { const { id } = await createResponsibility(viewer, String(cid), agreement); await updateResponsibility(viewer, id, { revision: 0, action: 'activate', monthlyBudgetMicros: 4e6, unitBudgetMicros: 2e6 }); return id; }
it('creates a reviewable agreement with no model work or guessed spend, and rejects another company’s pages', async () => {
    const { id } = await createResponsibility(viewer, String(cid), agreement);
    expect((await WorkResponsibility.findById(id))?.status).toBe('proposed'); expect(mocks.design).not.toHaveBeenCalled();
    await expect(createResponsibility(viewer, String(cid), { ...agreement, targets: ['https://another-company.com/'] })).rejects.toThrow('belong');
    await expect(createResponsibility({ ...viewer, role: 'User' }, String(cid), agreement)).rejects.toThrow('management');
    expect(await listResponsibilities({ ...viewer, organizationId: new Types.ObjectId() })).toEqual([]);
});
it('bounds concurrent planning, reserves budget once, and stops when the review queue is full', async () => {
    const id = await active();
    await Promise.all([advanceResponsibility(id), advanceResponsibility(id)]);
    await advanceResponsibility(id);
    expect(await Job.countDocuments({ responsibilityId: id })).toBe(1); expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect((await Job.findOne({ responsibilityId: id }))?.level).toBe('medium');
    const row = await WorkResponsibility.findById(id);
    expect(row?.allocatedMicros).toBe(2e6); expect(row?.targets.filter(t => t.status === 'review')).toHaveLength(1);
    expect(mocks.approve).toHaveBeenCalledWith(viewer, expect.any(String), { completion: 'review', monthlyBudgetMicros: 2e6 });
});
it('surfaces a finished sample for review without first requiring acceptance of its parent job', async () => {
    const id = await active(); await advanceResponsibility(id);
    const job = (await Job.findOne({ responsibilityId: id }))!;
    await Job.updateOne({ _id: job._id }, { $set: { status: 'testing' } });
    const run = await JobRun.create({ organizationId: org, companyId: cid, jobId: job._id, status: 'needs_review', dryRun: true, startedAt: new Date(), quality: { status: 'incomplete' } });
    // A newer in-progress retry takes precedence over an older result waiting for review.
    const retry = await JobRun.create({ organizationId: org, companyId: cid, jobId: job._id, status: 'running', dryRun: true, startedAt: new Date(), createdAt: new Date(Date.now() + 1000) });
    await advanceResponsibility(id);
    expect((await WorkResponsibility.findById(id))?.targets[0].status).toBe('working');
    await JobRun.updateOne({ _id: retry._id }, { $set: { status: 'needs_review' } });
    await advanceResponsibility(id);
    const row = (await WorkResponsibility.findById(id))!;
    expect(row.targets[0].status).toBe('review');
    expect(row.targets[0].checkedAt).toBeUndefined();
    expect(await Job.countDocuments({ responsibilityId: id })).toBe(1);
    expect((await Job.findById(job._id))?.status).toBe('testing');
    expect((await JobRun.findById(run._id))?.quality.status).toBe('incomplete');
});
it('requires every gate and live page evidence; rejects stale decisions and enforces the monthly allocation', async () => {
    const id = await active(); await advanceResponsibility(id); await advanceResponsibility(id);
    let row = (await WorkResponsibility.findById(id))!;
    const key = row.targets[0].key;
    await updateResponsibility(viewer, id, { revision: row.revision, action: 'assess', targetKey: key, score: 99, evidence: 'Verified the source and live review.', gatesPassed: [] });
    expect((await WorkResponsibility.findById(id))?.targets[0].status).toBe('queued');
    await expect(updateResponsibility(viewer, id, { revision: row.revision, action: 'pause' })).rejects.toThrow('changed');
    await advanceResponsibility(id); await advanceResponsibility(id);
    row = (await WorkResponsibility.findById(id))!;
    await updateResponsibility(viewer, id, { revision: row.revision, action: 'assess', targetKey: key, score: 90, evidence: 'Verified and applied the reviewed update.', gatesPassed: agreement.gates });
    await advanceResponsibility(id);
    row = (await WorkResponsibility.findById(id))!;
    expect(row.targets[0].status).toBe('current'); expect(row.targets[0].pageRevision).toMatch(/^[a-f0-9]{64}$/); expect(row.targets[0].rubricVersion).toBe(1);
    expect(row.targets[1].status).toBe('queued'); expect(await Job.countDocuments({ responsibilityId: id })).toBe(2);
});
it('pauses when the approving manager loses access and never advances a paused agreement', async () => {
    const id = await active(); mocks.viewer.mockResolvedValue({ ...viewer, role: 'User' }); await advanceResponsibility(id);
    expect((await WorkResponsibility.findById(id))?.status).toBe('paused'); expect(await Job.countDocuments({})).toBe(0);
    await advanceResponsibility(id); expect(mocks.design).not.toHaveBeenCalled();
});
it('retains assessment evidence, versions changed standards, and requires approval again', async () => {
    const id = await active(); await advanceResponsibility(id); await advanceResponsibility(id);
    let row = (await WorkResponsibility.findById(id))!;
    await updateResponsibility(viewer, id, { action: 'assess', revision: row.revision, targetKey: row.targets[0].key, score: 91, evidence: 'Verified the published page against primary sources.', gatesPassed: agreement.gates });
    const history = await WorkAssessment.find({ responsibilityId: id });
    expect(history).toHaveLength(1); expect(history[0].pageRevision).toMatch(/^[a-f0-9]{64}$/);
    row = (await WorkResponsibility.findById(id))!;
    await updateResponsibility(viewer, id, { action: 'revise', revision: row.revision, agreement: { ...agreement, threshold: 95, standard: 'Each material claim has a dated primary citation and a reviewed comparison.' } });
    row = (await WorkResponsibility.findById(id))!;
    expect(row.status).toBe('proposed'); expect(row.rubricVersion).toBe(2); expect(row.targets[0].status).toBe('queued');
    expect(await WorkAgreementVersion.countDocuments({ responsibilityId: id })).toBe(2);
    const count = await Job.countDocuments({ responsibilityId: id }); await advanceResponsibility(id);
    expect(await Job.countDocuments({ responsibilityId: id })).toBe(count);
    await updateResponsibility(viewer, id, { action: 'archive', revision: row.revision });
    expect(await listResponsibilities(viewer)).toEqual([]);
    expect(await listResponsibilities(viewer, undefined, true)).toHaveLength(1);
    expect(await WorkAssessment.countDocuments({ responsibilityId: id })).toBe(1);
});

it('lets a manager pause preparation without the worker reactivating it or starting execution', async () => {
    const id = await active();
    mocks.design.mockImplementation(async (_v, jobId) => {
        const row = (await WorkResponsibility.findById(id))!;
        await updateResponsibility(viewer, id, { revision: row.revision, action: 'pause' });
        await Job.updateOne({ _id: jobId }, { $set: { status: 'proposed' } });
    });
    await advanceResponsibility(id); await advanceResponsibility(id);
    expect((await WorkResponsibility.findById(id))?.status).toBe('paused');
    expect(mocks.approve).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
    expect(await Job.countDocuments({})).toBe(1);
});

it('defers an unreadable maintenance check instead of paying for an unnecessary rewrite', async () => {
    const id = await active();
    await WorkResponsibility.updateOne({ _id: id }, { $set: { 'targets.0.status': 'current', 'targets.1.status': 'current', 'targets.0.checkedAt': new Date(0), 'targets.1.checkedAt': new Date(0) } });
    mocks.page.mockRejectedValue(Error('Temporary fetch failure'));
    await advanceResponsibility(id);
    const row = (await WorkResponsibility.findById(id))!;
    expect(row.status).toBe('monitoring'); expect(row.targets.every(t => t.status === 'current')).toBe(true);
    expect(row.targets[0].observationError).toContain('Could not verify'); expect(mocks.design).not.toHaveBeenCalled();
    expect(row.targets[0].lastObservedAt).toBeInstanceOf(Date);
    expect(row.nextCheckAt?.getTime()).toBe(row.targets[0].lastObservedAt!.getTime() + 86_400_000);
    await advanceResponsibility(id);
    expect(mocks.page).toHaveBeenCalledTimes(2);
});

it('leaves completed pages untouched until exactly 30 days, even when their content has changed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const accepted = new Date('2026-11-20T18:00:00Z'); vi.setSystemTime(accepted);
    const id = await active();
    await WorkResponsibility.updateOne({ _id: id }, { $set: {
        'targets.0.status': 'current', 'targets.1.status': 'current',
        'targets.0.checkedAt': accepted, 'targets.1.checkedAt': accepted,
        'targets.0.pageRevision': 'older-page-hash', 'targets.1.pageRevision': 'older-page-hash',
    } });
    const due = accepted.getTime() + 30 * 86_400_000;
    for (const time of [accepted.getTime(), accepted.getTime() + 86_400_000, due - 1]) {
        vi.setSystemTime(time); await advanceResponsibility(id);
        const row = (await WorkResponsibility.findById(id))!;
        expect(row.status).toBe('monitoring'); expect(row.nextCheckAt?.getTime()).toBe(due);
        expect(row.targets.every(t => t.status === 'current')).toBe(true);
    }
    expect(mocks.page).not.toHaveBeenCalled(); expect(mocks.design).not.toHaveBeenCalled();
    expect(await Job.countDocuments({ responsibilityId: id })).toBe(0);
    vi.setSystemTime(due); await advanceResponsibility(id);
    expect(mocks.page).toHaveBeenCalledTimes(2); expect(mocks.design).toHaveBeenCalledTimes(1);
    expect(await Job.countDocuments({ responsibilityId: id })).toBe(1);
});

it('maintains separate page cooldowns and restarts the 30 days only after a new passing assessment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = new Date('2026-11-20T18:00:00Z'); vi.setSystemTime(now);
    const id = await active();
    await WorkResponsibility.updateOne({ _id: id }, { $set: {
        'targets.0.status': 'current', 'targets.1.status': 'current',
        'targets.0.checkedAt': new Date(now.getTime() - 30 * 86_400_000), 'targets.1.checkedAt': now,
        'targets.0.lastObservedAt': now,
    } });
    await advanceResponsibility(id); await advanceResponsibility(id);
    expect(mocks.page).toHaveBeenCalledExactlyOnceWith(agreement.targets[0]);
    let row = (await WorkResponsibility.findById(id))!;
    expect(row.targets[0].status).toBe('review'); expect(row.targets[1].status).toBe('current');
    await updateResponsibility(viewer, id, { revision: row.revision, action: 'assess', targetKey: row.targets[0].key,
        score: 92, evidence: 'Published page and dated sources verified again.', gatesPassed: agreement.gates });
    mocks.page.mockClear(); mocks.design.mockClear();
    vi.setSystemTime(now.getTime() + 86_400_000); await advanceResponsibility(id);
    row = (await WorkResponsibility.findById(id))!;
    expect(row.targets.every(t => t.status === 'current')).toBe(true);
    expect(row.nextCheckAt?.getTime()).toBe(now.getTime() + 30 * 86_400_000);
    expect(mocks.page).not.toHaveBeenCalled(); expect(mocks.design).not.toHaveBeenCalled();
});

it('releases known unused allowance on assessment and makes room for the next target', async () => {
    const id = await active();
    await WorkResponsibility.updateOne({ _id: id }, { $set: { monthlyBudgetMicros: 2_500_000 } });
    await advanceResponsibility(id); await advanceResponsibility(id);
    const row = (await WorkResponsibility.findById(id))!;
    await WorkBudget.updateOne({ responsibilityId: id }, { $push: { entries: { token: 'verified-receipt', startedAt: new Date(), finishedAt: new Date(), costMicros: 100_000, costUnknown: false } } });
    await updateResponsibility(viewer, id, { revision: row.revision, action: 'assess', targetKey: row.targets[0].key, score: 90, evidence: 'Checked the published change and every required source.', gatesPassed: agreement.gates });
    await advanceResponsibility(id);
    expect(await Job.countDocuments({ responsibilityId: id })).toBe(2);
    expect((await listResponsibilities(viewer))[0]).toMatchObject({ recordedMicros: 100_000, reservedMicros: 2_000_000, allocatedMicros: 2_100_000 });
});
