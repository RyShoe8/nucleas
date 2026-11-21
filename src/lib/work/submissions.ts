import 'server-only';
import { randomUUID } from 'node:crypto';
import { CompanyAssistantTurn } from '@/lib/models/CompanyAssistantTurn';
import { Job } from '@/lib/models/Job';
import { BuildRequest } from '@/lib/models/BuildRequest';
import { WorkResponsibility } from '@/lib/models/WorkResponsibility';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import type { WorkDraft } from './drafts';
export type CreatedWork = { kind: 'job' | 'build' | 'responsibility'; id: string };
const scope = (viewer: CompanyViewer, id: string) => ({ _id: id, organizationId: viewer.organizationId, userId: viewer.userId });
export async function readWorkDraft(viewer: CompanyViewer, id: string): Promise<WorkDraft | null> {
    if (!/^[a-f0-9]{24}$/i.test(id)) return null;
    const row = await CompanyAssistantTurn.findOne(scope(viewer, id)).select('workDraft').lean();
    const draft = row?.workDraft as WorkDraft | undefined;
    if (!draft) return null;
    if (!draft.created) {
        const q = { organizationId: viewer.organizationId, sourceTurnId: id, companyId: draft.companyId };
        const [job, build, responsibility] = await Promise.all([Job.findOne(q).select('_id').lean(), BuildRequest.findOne(q).select('_id').lean(), WorkResponsibility.findOne(q).select('_id').lean()]);
        const created: CreatedWork | undefined = job ? { kind: 'job', id: String(job._id) } : build ? { kind: 'build', id: String(build._id) } : responsibility ? { kind: 'responsibility', id: String(responsibility._id) } : undefined;
        if (created) { await CompanyAssistantTurn.updateOne(scope(viewer, id), { $set: { 'workDraft.created': created }, $unset: { 'workDraft.submission': 1 } }); draft.created = created; delete draft.submission; }
        // This exceeds the request's 800s maximum. Recover an interrupted pre-creation attempt only.
        else if (draft.submission && Date.now() - new Date(draft.submission.at).getTime() > 20 * 60_000) { await releaseWorkDraft(viewer, id, draft.submission.token); delete draft.submission; }
    }
    return draft;
}
export async function claimWorkDraft(viewer: CompanyViewer, id: string, companyId: string) {
    const draft = await readWorkDraft(viewer, id);
    if (!draft || draft.companyId !== companyId) throw Error('Work draft not found for this company.');
    if (draft.created) return { created: draft.created };
    const token = randomUUID();
    const claimed = await CompanyAssistantTurn.findOneAndUpdate({ ...scope(viewer, id), 'workDraft.submission': { $exists: false }, 'workDraft.created': { $exists: false } }, { $set: { 'workDraft.submission': { token, at: new Date().toISOString() } } });
    if (!claimed) throw Error('This agreement is already being prepared. Reopen it in a moment to see the result.');
    return { token };
}
export async function finishWorkDraft(viewer: CompanyViewer, id: string, token: string, created: CreatedWork) {
    await CompanyAssistantTurn.updateOne({ ...scope(viewer, id), 'workDraft.submission.token': token }, { $set: { 'workDraft.created': created }, $unset: { 'workDraft.submission': 1 } });
}
export async function releaseWorkDraft(viewer: CompanyViewer, id: string, token: string) {
    await CompanyAssistantTurn.updateOne({ ...scope(viewer, id), 'workDraft.submission.token': token }, { $unset: { 'workDraft.submission': 1 } });
}
