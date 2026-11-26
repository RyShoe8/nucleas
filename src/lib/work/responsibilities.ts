import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { WorkResponsibility, WorkAssessment, WorkAgreementVersion } from '@/lib/models/WorkResponsibility';
import { Job, JobRun } from '@/lib/models/Job';
import { WorkBudget } from '@/lib/models/WorkBudget';
import { readItemCapMicros } from '@/lib/ai/control/itemCap';
import { closeWorkBudget, responsibilityBudget, summarizeWorkBudgets } from './budgets';
import { aiTransaction } from '@/lib/ai/control/transaction';
import { webFetch } from '@/lib/ai/tools/webFetch';
import { readEngineSettings } from '@/lib/ai/engine/select';
import { validateWorkOwner } from '@/lib/companies/teamSpecialists';
import { getCompanyProfile, isCompanyManager, loadCompanyViewer, listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import { approveJob, executeJobRun, runDesign } from '@/lib/jobs/jobs';
import { agreementBrief, workAgreementSchema, type WorkAgreement } from './agreements';
import { targetRecheckTime } from './maintenance';

export async function listResponsibilities(viewer: CompanyViewer, companyId?: string, includeClosed = false) {
    const profiles = companyId ? [await getCompanyProfile(viewer, companyId)].filter(Boolean) : await listCompanyProfiles(viewer);
    const ids = profiles.map(p => new Types.ObjectId(p!.id));
    const rows = await WorkResponsibility.find({ organizationId: viewer.organizationId, companyId: { $in: ids }, ...(!includeClosed ? { status: { $ne: 'archived' } } : {}) }).sort({ updatedAt: -1 }).lean();
    const budgets = await WorkBudget.find({ organizationId: viewer.organizationId, responsibilityId: { $in: rows.map(r => r._id) } }).lean();
    const itemCap = rows.length ? await readItemCapMicros(String(viewer.organizationId)) : 0;
    return rows.map(row => ({ ...row, ...summarizeWorkBudgets(budgets.filter(b => String(b.responsibilityId) === String(row._id))), effectiveUnitBudgetMicros: Math.min(row.unitBudgetMicros, itemCap), id: String(row._id), companyId: String(row.companyId), companyName: profiles.find(p => p!.id === String(row.companyId))?.name, canManage: isCompanyManager(viewer), leaseToken: undefined }));
}
export async function createResponsibility(viewer: CompanyViewer, companyId: string, agreement: WorkAgreement, sourceTurnId?: string) {
    const profile = await getCompanyProfile(viewer, companyId);
    if (!isCompanyManager(viewer) || !profile) throw Error('Company management access is required.');
    const allowed = new Set([profile.domain, ...profile.websites].filter(Boolean).map(h => new URL(`https://${h}`).hostname.replace(/^www\./, '')));
    const urls = [...new Set(agreement.targets.map(raw => { const url = new URL(raw); url.hash = ''; return url.href; }))];
    if (urls.some(raw => !allowed.has(new URL(raw).hostname.replace(/^www\./, '')))) throw Error('Target pages must belong to this company’s configured websites.');
    const row = await WorkResponsibility.create({ organizationId: viewer.organizationId, companyId, createdByUserId: viewer.userId, agreement, sourceTurnId,
        targets: urls.map(url => ({ key: createHash('sha256').update(url).digest('hex'), url })) });
    return { id: String(row._id) };
}
export async function updateResponsibility(viewer: CompanyViewer, id: string, input: { revision: number; action: 'activate' | 'pause' | 'archive' | 'assess' | 'reopen' | 'revise'; agreement?: WorkAgreement; monthlyBudgetMicros?: number; unitBudgetMicros?: number; targetKey?: string; score?: number; evidence?: string; gatesPassed?: string[] }) {
    if (!Types.ObjectId.isValid(id) || !isCompanyManager(viewer)) throw Error('Company management access is required.');
    const row = await WorkResponsibility.findOne({ _id: id, organizationId: viewer.organizationId }).lean();
    if (!row || !(await getCompanyProfile(viewer, String(row.companyId)))) throw Error('Responsibility not found.');
    const stopping = input.action === 'pause' || input.action === 'archive';
    if (row.revision !== input.revision || (!stopping && row.leaseExpiresAt && row.leaseExpiresAt > new Date())) throw Error('This work changed or is being prepared. Refresh and try again.');
    const agreement = workAgreementSchema.parse(row.agreement);
    const set: Record<string, unknown> = { error: null, nextCheckAt: new Date() };
    if (input.action === 'activate') {
        await validateWorkOwner(viewer, String(row.companyId), agreement.role, agreement.assignedMemberId);
        if (!row.targets.length || !agreement.gates.length) throw Error('Add target pages and mandatory quality checks before activation.');
        const budget = input.monthlyBudgetMicros ?? row.monthlyBudgetMicros, unit = input.unitBudgetMicros ?? row.unitBudgetMicros;
        if (!Number.isSafeInteger(budget) || !Number.isSafeInteger(unit) || unit <= 0 || budget < unit || budget > 1e9) throw Error('Set a monthly budget and a positive per-target ceiling within it.');
        set.status = 'active'; set.monthlyBudgetMicros = budget; set.unitBudgetMicros = unit;
    } else if (input.action === 'revise') {
        const updated = workAgreementSchema.parse(input.agreement);
        if (updated.mode !== 'ongoing' || JSON.stringify(updated.targets) !== JSON.stringify(agreement.targets)) throw Error('Keep this inventory unchanged. Create a separate responsibility for a different collection.');
        await validateWorkOwner(viewer, String(row.companyId), updated.role, updated.assignedMemberId);
        set.agreement = updated; set.rubricVersion = row.rubricVersion + 1; set.status = 'proposed';
        set.targets = row.targets.map(t => t.status === 'current' ? { ...t, status: 'queued', attempts: 0 } : t);
    } else if (input.action === 'pause' || input.action === 'archive') set.status = input.action === 'pause' ? 'paused' : 'archived';
    else {
        const index = row.targets.findIndex(t => t.key === input.targetKey);
        if (index < 0) throw Error('Target not found.');
        if (input.action === 'reopen') {
            set[`targets.${index}.status`] = 'queued'; set[`targets.${index}.attempts`] = 0; set.status = 'paused';
        } else {
            if (row.targets[index].status !== 'review') throw Error('Review the generated work before assessing this target.');
            if (!Number.isFinite(input.score) || input.score! < 0 || input.score! > 100 || !input.evidence?.trim()) throw Error('Record the score and verification evidence.');
            const passes = input.score! >= agreement.threshold && agreement.gates.every(g => input.gatesPassed?.includes(g));
            if (passes) {
                const page = await webFetch(row.targets[index].url);
                if (page.thin) throw Error('The target page could not be verified. Keep it open until readable evidence is available.');
                set[`targets.${index}.pageRevision`] = createHash('sha256').update(page.text).digest('hex');
                set[`targets.${index}.lastObservedAt`] = new Date();
                set[`targets.${index}.observationError`] = null;
            }
            set[`targets.${index}.status`] = passes ? 'current' : row.targets[index].attempts >= 3 ? 'blocked' : 'queued';
            set[`targets.${index}.score`] = input.score; set[`targets.${index}.evidence`] = input.evidence.slice(0, 3000);
            set[`targets.${index}.gatesPassed`] = input.gatesPassed ?? []; set[`targets.${index}.checkedAt`] = new Date();
            set[`targets.${index}.checkedBy`] = new Types.ObjectId(viewer.userId); set[`targets.${index}.rubricVersion`] = row.rubricVersion;
        }
    }
    await aiTransaction(async session => {
        const updated = await WorkResponsibility.updateOne({ _id: row._id, revision: input.revision, ...(!stopping ? { $or: [{ leaseExpiresAt: { $exists: false } }, { leaseExpiresAt: { $lte: new Date() } }] } : {}) }, { $set: set, $inc: { revision: 1 } }, { session });
        if (!updated.modifiedCount) throw Error('This work changed. Refresh and try again.');
        if (input.action === 'revise') {
            await WorkAgreementVersion.updateOne({ responsibilityId: row._id, version: row.rubricVersion }, { $setOnInsert: { organizationId: row.organizationId, companyId: row.companyId, agreement: row.agreement, changedBy: row.createdByUserId } }, { session, upsert: true });
            await WorkAgreementVersion.create([{ organizationId: row.organizationId, companyId: row.companyId, responsibilityId: row._id, version: row.rubricVersion + 1, agreement: set.agreement, changedBy: viewer.userId }], { session });
        }
        if (input.action === 'assess') {
            const index = row.targets.findIndex(t => t.key === input.targetKey);
            await closeWorkBudget(row.targets[index].jobId, session);
            await WorkAssessment.create([{ organizationId: row.organizationId, companyId: row.companyId, responsibilityId: row._id, targetKey: input.targetKey,
                rubricVersion: row.rubricVersion, standard: agreement.standard, score: input.score, gatesPassed: input.gatesPassed ?? [], requiredGates: agreement.gates, evidence: input.evidence,
                pageRevision: set[`targets.${index}.pageRevision`], checkedAt: new Date(), checkedBy: viewer.userId }], { session });
        }
        if (input.action === 'reopen') await closeWorkBudget(row.targets.find(t => t.key === input.targetKey)?.jobId, session);
        if (input.action === 'archive') await WorkBudget.updateMany({ responsibilityId: row._id, organizationId: row.organizationId, closedAt: { $exists: false } }, { $set: { closedAt: new Date() } }, { session });
    });
}

/** One bounded target per tick. All output remains a reviewed draft in Nucleas. No new model router. */
export async function advanceResponsibility(id: string) {
    const now = new Date(), token = randomUUID();
    const row = await WorkResponsibility.findOneAndUpdate({ _id: id, status: { $in: ['active', 'monitoring'] }, $or: [{ leaseExpiresAt: { $exists: false } }, { leaseExpiresAt: { $lte: now } }] }, { $set: { leaseToken: token, leaseExpiresAt: new Date(now.getTime() + 20 * 60_000) } }, { new: true }).lean();
    if (!row) return;
    try {
        const viewer = await loadCompanyViewer(String(row.createdByUserId));
        if (!viewer || !isCompanyManager(viewer) || String(viewer.organizationId) !== String(row.organizationId) || !(await getCompanyProfile(viewer, String(row.companyId)))) throw Error('The responsible manager no longer has access.');
        const agreement = workAgreementSchema.parse(row.agreement);
        await validateWorkOwner(viewer, String(row.companyId), agreement.role, agreement.assignedMemberId);
        const targets = row.targets.map(t => ({ ...t }));
        // Completed pages receive no fetches or model work during their 30-day cooldown.
        for (const t of targets.filter(t => t.status === 'current' && targetRecheckTime(t) <= now.getTime()).sort((a, b) => targetRecheckTime(a) - targetRecheckTime(b)).slice(0, 3)) {
            const page = await webFetch(t.url).catch(() => null);
            t.lastObservedAt = now;
            if (!page || page.thin) { t.observationError = 'Could not verify the page. Its last assessment is retained; another check is due tomorrow.'; continue; }
            t.observationError = undefined;
            // Even unchanged text needs fresh source verification once the assessment expires.
            t.status = 'queued'; t.attempts = 0;
        }
        for (const t of targets.filter(t => t.status === 'working' && t.jobId)) {
            const job = await Job.findOne({ _id: t.jobId, organizationId: row.organizationId }).select('status').lean();
            if (!job || ['failed', 'rejected', 'archived'].includes(job.status)) t.status = 'blocked';
            else if (['ready', 'done', 'active', 'proposed', 'needs_answers'].includes(job.status)) t.status = 'review';
            else if (job.status === 'testing') {
                // A sample awaiting review leaves its parent job in testing. Look at the latest
                // run so old failures cannot make a newer in-progress attempt look ready.
                const latest = await JobRun.findOne({ jobId: t.jobId, organizationId: row.organizationId })
                    .sort({ createdAt: -1, _id: -1 }).select('status').lean();
                if (latest?.status === 'needs_review') t.status = 'review';
                else if (latest?.status === 'failed' || latest?.status === 'rejected') t.status = 'blocked';
            }
        }
        const budget = await responsibilityBudget(row.organizationId, row._id);
        const month = budget.month;
        let allocated = budget.allocatedMicros;
        const allowance = Math.min(row.unitBudgetMicros, await readItemCapMicros(String(row.organizationId)));
        const pending = targets.filter(t => ['working', 'review', 'blocked'].includes(t.status)).length;
        const next = pending < agreement.maxPending ? targets.find(t => t.status === 'queued' && t.attempts < 3) : undefined;
        let jobId: string | undefined;
        let newJob: Record<string, unknown> | undefined;
        if (next && allocated + allowance <= row.monthlyBudgetMicros) {
            const level = agreement.level ?? (await readEngineSettings(String(row.organizationId))).defaultCostLevel;
            // Persist the queue link before any model call; a restart cannot create duplicate target work.
            const oid = new Types.ObjectId(); jobId = String(oid);
            const unit = { ...agreement, mode: 'once' as const, schedule: undefined, targets: [next.url] };
            newJob = { _id: oid, organizationId: row.organizationId, companyId: row.companyId, createdByUserId: row.createdByUserId, teamRole: agreement.role,
                responsibilityId: row._id, targetKey: next.key, workAgreement: unit, status: 'designing', level, monthlyBudgetMicros: row.unitBudgetMicros,
                assignedMemberId: agreement.assignedMemberId,
                request: `${agreementBrief(unit)}\n\nTarget: ${next.url}\nPrevious assessment: ${(next.evidence ?? 'Not assessed').slice(0, 500)}\nPrepare an evidence-led audit and improvement draft. Do not publish.`.slice(0, 6000),
                events: [{ at: now, userId: row.createdByUserId, action: 'responsibility_target' }] };
            next.jobId = oid; next.status = 'working'; next.attempts += 1; allocated += allowance;
        }
        const status = targets.every(t => t.status === 'current') ? 'monitoring' : 'active';
        const nextMaintenance = Math.min(...targets.filter(t => t.status === 'current').map(targetRecheckTime));
        const maintenanceDue = nextMaintenance <= now.getTime();
        const budgetReached = next && !newJob && allocated + allowance > row.monthlyBudgetMicros;
        const nextCheckAt = budgetReached ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
            : status === 'monitoring' && !maintenanceDue && Number.isFinite(nextMaintenance) ? new Date(nextMaintenance)
            : new Date(now.getTime() + (maintenanceDue ? 60_000 : pending >= agreement.maxPending ? 15 * 60_000 : 60_000));
        await aiTransaction(async session => {
            const changed = await WorkResponsibility.updateOne({ _id: row._id, leaseToken: token, revision: row.revision, status: { $in: ['active', 'monitoring'] } }, { $set: { targets, status, nextCheckAt, allocationMonth: month, allocatedMicros: allocated, error: null }, $inc: { revision: 1 } }, { session });
            if (!changed.matchedCount) throw Error('Responsibility lease changed.');
            if (newJob) {
                await Job.create([newJob], { session });
                await WorkBudget.create([{ organizationId: row.organizationId, responsibilityId: row._id, jobId: newJob._id, limitMicros: allowance }], { session });
            }
        });
        if (jobId) {
            await runDesign(viewer, jobId);
            const job = await Job.findById(jobId).select('status').lean();
            if (job?.status === 'proposed' && await WorkResponsibility.exists({ _id: row._id, status: { $in: ['active', 'monitoring'] } })) {
                const approved = await approveJob(viewer, jobId, { completion: 'review', monthlyBudgetMicros: row.unitBudgetMicros });
                if (approved.ok && approved.dryRunId) await executeJobRun(approved.dryRunId);
            }
        }
    } catch (error) {
        await WorkResponsibility.updateOne({ _id: row._id, leaseToken: token, status: { $in: ['active', 'monitoring'] } }, { $set: { error: (error instanceof Error ? error.message : 'Could not advance responsibility').slice(0, 1000), status: 'paused' } });
    } finally {
        await WorkResponsibility.updateOne({ _id: row._id, leaseToken: token }, { $unset: { leaseToken: 1, leaseExpiresAt: 1 } });
    }
}
