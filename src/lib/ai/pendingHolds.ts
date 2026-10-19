import { Types } from 'mongoose';
import User from '@/lib/models/User';
import Project from '@/lib/models/Project';
import { assistantLedgerProjectId } from './company/assistantLedger';
import { AiBudget, AiBudgetReservation, AiRun, AiRunEvent } from '@/lib/models/AiControl';
import { aiTransaction } from './control/transaction';
import { settleRunBudget } from './control/budgets';

export interface PendingHold {
  runId: string; amountMicros: number; createdAt: string; model: string; status: string;
  reason: string; canReconcile: boolean; person: string; source: string;
}

/** Count the organization scope once: project reservations mirror it, rather than adding to it. */
export async function pendingHolds(organizationId: string, period: string): Promise<PendingHold[]> {
  const budgets = await AiBudget.find({ organizationId, period, scopeKey: 'organization' }).select('_id').lean();
  const holds = await AiBudgetReservation.find({ organizationId, budgetId: { $in: budgets.map((b) => b._id) }, state: 'reserved' }).sort({ createdAt: -1 }).lean();
  const ids = holds.map((h) => h.runId);
  const runs = await AiRun.find({ organizationId, _id: { $in: ids } }).select('model status createdAt failureCode createdByUserId projectId').lean();
  const events = await AiRunEvent.find({ organizationId, runId: { $in: ids } }).sort({ sequence: -1 }).select('runId summary').lean();
  const users = await User.find({ _id: { $in: runs.map((r) => r.createdByUserId) } }).select('name').lean();
  const projects = await Project.find({ _id: { $in: runs.map((r) => r.projectId) } }).select('name').lean();
  return holds.map((hold) => {
    const run = runs.find((r) => String(r._id) === String(hold.runId));
    const event = events.find((e) => String(e.runId) === String(hold.runId));
    return { person: users.find((u) => String(u._id) === String(run?.createdByUserId))?.name ?? 'Unknown person', source: String(run?.projectId) === String(assistantLedgerProjectId(organizationId)) ? 'Ask Nucleas / background work' : projects.find((p) => String(p._id) === String(run?.projectId))?.name ?? 'Unknown project', runId: String(hold.runId), amountMicros: hold.amountMicros, createdAt: hold.createdAt.toISOString(), model: run?.model ?? 'Unknown model', status: run?.status ?? 'Run missing', reason: event?.summary ?? run?.failureCode ?? 'Usage has not been confirmed.', canReconcile: !!run && ['completed', 'blocked', 'failed', 'cancelled'].includes(run.status) };
  });
}

/** An administrator supplies a confirmed cost and evidence; both budget scopes and the run update atomically. */
export async function reconcileHold(organizationId: string, runId: string, userId: string, actualMicros: number, reason: string) {
  if (!Types.ObjectId.isValid(runId) || !Number.isSafeInteger(actualMicros) || actualMicros < 0 || reason.trim().length < 10 || reason.length > 500) throw new Error('Enter a valid run, confirmed cost and an explanation of at least 10 characters.');
  return aiTransaction(async (session) => {
    const run = await AiRun.findOne({ _id: new Types.ObjectId(runId), organizationId }).session(session);
    if (!run || !['completed', 'blocked', 'failed', 'cancelled'].includes(run.status)) throw new Error('Only finished runs can be reconciled. Active or missing runs cannot be released.');
    if (!(await AiBudgetReservation.exists({ organizationId, runId: run._id, state: 'reserved' }).session(session))) throw new Error('This hold has already been reconciled. Refresh the list.');
    await settleRunBudget(organizationId, run._id, actualMicros, session);
    run.costMicros = actualMicros;
    run.revision += 1;
    await run.save({ session });
    await AiRunEvent.create([{ organizationId, projectId: run.projectId, runId: run._id, sequence: run.revision, type: 'budget.reconciled', summary: `Administrator ${userId} confirmed cost $${(actualMicros / 1_000_000).toFixed(6)}. Evidence: ${reason.trim()}` }], { session });
  });
}
