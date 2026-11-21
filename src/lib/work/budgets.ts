import 'server-only';
import { randomUUID } from 'node:crypto';
import { type ClientSession, type Types } from 'mongoose';
import { WorkBudget, type WorkBudgetDoc } from '@/lib/models/WorkBudget';
import { Job } from '@/lib/models/Job';
import { itemCostUnknown, itemSpend, readItemCapMicros, withItemAllowance, withItemCap } from '@/lib/ai/control/itemCap';

type Reservation = Pick<WorkBudgetDoc, 'limitMicros' | 'entries' | 'closedAt'>;

/** Known costs are booked when the operation finishes. Unfinished/unknown calls retain their allowance. */
export function summarizeWorkBudgets(rows: Reservation[], now = new Date()) {
    const month = now.toISOString().slice(0, 7);
    let recordedMicros = 0, reservedMicros = 0, unknownReservations = 0;
    for (const row of rows) {
        const spent = row.entries.reduce((sum, e) => sum + e.costMicros, 0);
        const unknown = !row.entries.length || row.entries.some(e => !e.finishedAt || e.costUnknown);
        recordedMicros += row.entries.filter(e => e.finishedAt?.toISOString().slice(0, 7) === month).reduce((sum, e) => sum + e.costMicros, 0);
        // An unknown charge may have consumed the entire allowance. Never treat missing usage as $0.
        reservedMicros += unknown ? row.limitMicros : row.closedAt ? 0 : Math.max(0, row.limitMicros - spent);
        if (row.entries.some(e => !e.finishedAt || e.costUnknown)) unknownReservations++;
    }
    return { month, recordedMicros, reservedMicros, unknownReservations, allocatedMicros: recordedMicros + reservedMicros };
}

export async function responsibilityBudget(organizationId: Types.ObjectId, responsibilityId: Types.ObjectId) {
    return summarizeWorkBudgets(await WorkBudget.find({ organizationId, responsibilityId }).lean());
}

/** Closing a reviewed attempt releases only known unused budget; another attempt gets a new job. */
export async function closeWorkBudget(jobId: Types.ObjectId | null | undefined, session: ClientSession) {
    if (!jobId) return;
    const row = await WorkBudget.findOne({ jobId }).session(session).lean();
    if (!row || row.closedAt) return;
    if (row.leaseExpiresAt && row.leaseExpiresAt > new Date()) throw Error('This target is still running. Wait for it to finish before assessing it.');
    await WorkBudget.updateOne({ _id: row._id }, { $set: { closedAt: new Date() } }, { session });
}

export class WorkBudgetUnavailable extends Error {
    constructor(public readonly retryLater: boolean) {
        super('This target’s budget is closed, missing, or already in use. Create another attempt from its responsibility after the current work finishes.');
    }
}

/** Reopened processes and queued workers read the same remaining target allowance. */
export async function withWorkBudget<T>(jobId: string, label: string, work: () => Promise<T>): Promise<T> {
    const job = await Job.findById(jobId).select('organizationId responsibilityId').lean();
    if (!job?.responsibilityId) return withItemCap(label, work);
    const token = randomUUID(), now = new Date();
    const row = await WorkBudget.findOneAndUpdate({ jobId: job._id, organizationId: job.organizationId, responsibilityId: job.responsibilityId,
        closedAt: { $exists: false }, $or: [{ leaseExpiresAt: { $exists: false } }, { leaseExpiresAt: { $lte: now } }],
    }, { $set: { leaseToken: token, leaseExpiresAt: new Date(now.getTime() + 20 * 60_000) } }, { new: true }).lean();
    if (!row) {
        const current = await WorkBudget.findOne({ jobId: job._id, organizationId: job.organizationId }).select('leaseExpiresAt').lean();
        throw new WorkBudgetUnavailable(!!current?.leaseExpiresAt && current.leaseExpiresAt > now);
    }
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
        const cap = Math.min(row.limitMicros, await readItemCapMicros(String(job.organizationId)));
        const uncertain = row.entries.some(e => !e.finishedAt || e.costUnknown);
        const remaining = uncertain ? 0 : Math.max(0, cap - row.entries.reduce((sum, e) => sum + e.costMicros, 0));
        await WorkBudget.updateOne({ _id: row._id, leaseToken: token }, { $push: { entries: { token, label, startedAt: now, costUnknown: true, costMicros: 0 } } });
        heartbeat = setInterval(() => {
            void WorkBudget.updateOne({ _id: row._id, leaseToken: token }, { $set: { leaseExpiresAt: new Date(Date.now() + 20 * 60_000) } }).catch(() => { /* An unfinished receipt retains the reservation if storage is unavailable. */ });
        }, 60_000);
        heartbeat.unref();
        return await withItemAllowance('responsibility target', remaining, async () => {
            let finished = false;
            try { const result = await work(); finished = true; return result; }
            finally {
                await WorkBudget.updateOne({ _id: row._id, leaseToken: token, 'entries.token': token }, { $set: {
                    'entries.$.costMicros': itemSpend()?.spentMicros ?? 0,
                    'entries.$.costUnknown': !finished || itemCostUnknown(), 'entries.$.finishedAt': new Date(),
                } });
            }
        });
    } finally {
        if (heartbeat) clearInterval(heartbeat);
        await WorkBudget.updateOne({ _id: row._id, leaseToken: token }, { $unset: { leaseToken: 1, leaseExpiresAt: 1 } });
    }
}
