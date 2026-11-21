import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/control/settings', () => ({ readBudgetSettings: async () => ({ value: { itemCapMicros: 500_000 } }) }));
import { Job } from '@/lib/models/Job';
import { WorkBudget } from '@/lib/models/WorkBudget';
import { closeWorkBudget, summarizeWorkBudgets, withWorkBudget } from './budgets';
import { itemCapRefusal, itemSpend, recordItemSpend, withItemCap } from '@/lib/ai/control/itemCap';
import { aiTransaction } from '@/lib/ai/control/transaction';

let repl: MongoMemoryReplSet;
const organizationId = new Types.ObjectId(), responsibilityId = new Types.ObjectId();
beforeAll(async () => { repl = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger' } }); await mongoose.connect(repl.getUri('work_budgets')); await WorkBudget.init(); }, 120_000);
afterAll(async () => { await mongoose.disconnect(); await repl?.stop(); });
beforeEach(async () => { await Promise.all([Job.deleteMany({}), WorkBudget.deleteMany({})]); });
async function target() {
    const job = await Job.create({ organizationId, responsibilityId, companyId: new Types.ObjectId(), createdByUserId: new Types.ObjectId(), request: 'Research a page', status: 'designing' });
    await WorkBudget.create({ organizationId, responsibilityId, jobId: job._id, limitMicros: 1e6 });
    return String(job._id);
}
it('shares the org-limited allowance across planning, execution, retry and enclosing requests', async () => {
    const id = await target();
    await withWorkBudget(id, 'plan', async () => { expect(await itemCapRefusal(String(organizationId))).toBeNull(); recordItemSpend(300_000); });
    await withItemCap('request', async () => {
        await withWorkBudget(id, 'run', async () => {
            expect(itemSpend()?.capMicros).toBe(200_000);
            recordItemSpend(200_000);
            expect(await itemCapRefusal(String(organizationId))).toContain('AI budget cannot reserve');
        });
        expect(itemSpend()?.spentMicros).toBe(200_000);
    });
    await withWorkBudget(id, 'retry', async () => { expect(await itemCapRefusal(String(organizationId))).toContain('AI budget cannot reserve'); });
    const row = (await WorkBudget.findOne().lean())!;
    expect(row.entries.map(e => e.costMicros)).toEqual([300_000, 200_000, 0]);
});
it('rejects simultaneous spend on a target and releases the lease after finishing', async () => {
    const id = await target();
    await withWorkBudget(id, 'plan', async () => {
        await expect(withWorkBudget(id, 'other', async () => recordItemSpend(99))).rejects.toThrow('already in use');
        recordItemSpend(100);
    });
    await withWorkBudget(id, 'run', async () => recordItemSpend(200));
    expect((await WorkBudget.findOne())?.entries).toHaveLength(2);
});
it('retains unreported and interrupted costs across retries and calendar months', async () => {
    const id = await target();
    await withWorkBudget(id, 'plan', async () => { recordItemSpend(null); expect(await itemCapRefusal(String(organizationId))).toContain('did not report'); });
    await withWorkBudget(id, 'retry', async () => { expect(itemSpend()?.capMicros).toBe(0); });
    await aiTransaction(session => closeWorkBudget(new Types.ObjectId(id), session));
    const row = (await WorkBudget.findOne().lean())!;
    expect(summarizeWorkBudgets([row], new Date('2099-01-01'))).toMatchObject({ recordedMicros: 0, reservedMicros: 1e6, unknownReservations: 1 });
    await expect(withWorkBudget(id, 'old retry', async () => {})).rejects.toThrow('closed');
});
it('releases known unused allowance after review while preserving the recorded monthly cost', async () => {
    const id = await target();
    await withWorkBudget(id, 'plan', async () => recordItemSpend(100_000));
    await withWorkBudget(id, 'run', async () => recordItemSpend(200_000));
    let row = (await WorkBudget.findOne().lean())!;
    expect(summarizeWorkBudgets([row])).toMatchObject({ recordedMicros: 300_000, reservedMicros: 700_000, allocatedMicros: 1e6 });
    expect(summarizeWorkBudgets([row], new Date('2099-01-01'))).toMatchObject({ recordedMicros: 0, reservedMicros: 700_000, allocatedMicros: 700_000 });
    await aiTransaction(session => closeWorkBudget(new Types.ObjectId(id), session));
    row = (await WorkBudget.findOne().lean())!;
    expect(summarizeWorkBudgets([row])).toMatchObject({ recordedMicros: 300_000, reservedMicros: 0, allocatedMicros: 300_000 });
    expect(summarizeWorkBudgets([row], new Date('2099-01-01'))).toMatchObject({ allocatedMicros: 0 });
});
it('does not release uncertain costs when a process dies or throws after doing work', async () => {
    const id = await target();
    await expect(withWorkBudget(id, 'plan', async () => { recordItemSpend(25_000); throw Error('process stopped'); })).rejects.toThrow('process stopped');
    await WorkBudget.updateOne({ jobId: id }, { $push: { entries: { token: 'crash', label: 'run', startedAt: new Date(), costUnknown: true } }, $set: { leaseToken: 'crash', leaseExpiresAt: new Date(0) } });
    await withWorkBudget(id, 'recovered', async () => { expect(itemSpend()?.capMicros).toBe(0); });
    expect(summarizeWorkBudgets(await WorkBudget.find().lean())).toMatchObject({ reservedMicros: 1e6, unknownReservations: 1 });
});
