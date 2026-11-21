import 'server-only';
import { Types } from 'mongoose';
import { CompanyTeam } from '@/lib/models/CompanyTeam';
import { BuildRequest } from '@/lib/models/BuildRequest';
import { Job } from '@/lib/models/Job';
import { WorkResponsibility } from '@/lib/models/WorkResponsibility';
import { OfficeSceneModel } from '@/lib/models/OfficeScene';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from './companyProfile';
import { availableReviewers, companyAssignments } from './teamAssignments';
import { TEAM, type TeamRole } from './teamRoles';
export async function validateWorkOwner(viewer: CompanyViewer, companyId: string, role: TeamRole, memberId?: string) {
    if (!memberId) return;
    const members = await companyAssignments(viewer.organizationId, [companyId]);
    if (!members.some(m => m.id === memberId && m.role === role && m.active)) throw Error('Choose an active employee from this company and field.');
}
export async function saveSpecialist(viewer: CompanyViewer, companyId: string, input: { role: TeamRole; memberId?: string; displayName: string; active: boolean; specialty: string; reviewerEmployeeId: string | null; remit: string; lessons: string }) {
    const company = await getCompanyProfile(viewer, companyId);
    if (!isCompanyManager(viewer) || !company || !TEAM[input.role].active) throw Error('Company management access and an active skill family are required.');
    if (input.reviewerEmployeeId && !(await availableReviewers(viewer.organizationId, company)).some(r => r.id === input.reviewerEmployeeId)) throw Error('Choose a reviewer with access to this company.');
    const scope = { organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId), role: input.role };
    const memberId = input.memberId ? new Types.ObjectId(input.memberId) : new Types.ObjectId();
    if (!input.active && input.memberId && (await Job.exists({ organizationId: viewer.organizationId, companyId, assignedMemberId: memberId, status: { $nin: ['done', 'rejected', 'archived'] } }) || await BuildRequest.exists({ organizationId: viewer.organizationId, companyId, assignedMemberId: memberId, status: { $in: ['planning', 'proposed', 'queued', 'building', 'ready', 'failed'] } }) || await WorkResponsibility.exists({ organizationId: viewer.organizationId, companyId, 'agreement.assignedMemberId': input.memberId, status: { $in: ['active', 'proposed', 'monitoring'] } }))) throw Error('Reassign or finish this employee’s work and pause ongoing responsibilities before removing them.');
    const member = { _id: memberId, displayName: input.displayName, active: input.active, specialty: input.specialty, reviewerEmployeeId: input.reviewerEmployeeId ? new Types.ObjectId(input.reviewerEmployeeId) : undefined, remit: input.remit, lessons: input.lessons };
    if (input.memberId) {
        const result = await CompanyTeam.updateOne({ ...scope, 'specialists._id': memberId }, { $set: { 'specialists.$': member, updatedBy: viewer.userId } }, { runValidators: true });
        if (!result.matchedCount) throw Error('Employee not found in this company.');
    } else {
        await CompanyTeam.updateOne(scope, { $setOnInsert: { remit: TEAM[input.role].remit, updatedBy: viewer.userId } }, { upsert: true });
        const result = await CompanyTeam.updateOne({ ...scope, 'specialists.7': { $exists: false } }, { $push: { specialists: member } }, { runValidators: true });
        if (!result.modifiedCount) throw Error('This field already has eight additional specialists.');
    }
    await OfficeSceneModel.updateOne({ _id: viewer.organizationId }, { $set: { 'scene.contextAt': 0 }, $inc: { revision: 1 } });
    return String(memberId);
}
