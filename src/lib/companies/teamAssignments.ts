import 'server-only';
import { Types } from 'mongoose';
import { CompanyTeam } from '@/lib/models/CompanyTeam';
import { Job } from '@/lib/models/Job';
import { BuildRequest } from '@/lib/models/BuildRequest';
import Employee from '@/lib/models/Employee';
import { TEAM, TEAM_ROLES, teamRoleFor, type TeamRole } from './teamRoles';
import type { CompanyProfile } from './companyProfile';
import { suggestedEmployeeName } from './employeeIdentity';

/** One-time additive identity allocation, safe when several office windows connect together. */
export async function ensureEmployeeIdentity(organizationId:Types.ObjectId,companyId:string,role:TeamRole) {
  const scope={organizationId,companyId:new Types.ObjectId(companyId),role};
  for(let attempt=0;attempt<64;attempt++){
    const current=await CompanyTeam.findOne(scope).select('identityName').lean();
    if(current?.identityName)return current.identityName;
    const name=suggestedEmployeeName(`${companyId}:${role}`,attempt);
    if(await CompanyTeam.exists({organizationId,identityName:name}))continue;
    try{
      await CompanyTeam.updateOne({...scope,identityName:{$exists:false}},{$set:{identityName:name},$setOnInsert:{remit:TEAM[role].remit,updatedBy:organizationId}},{upsert:true,runValidators:true});
      return name;
    }catch(error){if((error as {code?:number}).code!==11000)throw error;}
  }
  throw new Error('Could not allocate an employee identity. Try again.');
}

export interface TeamAssignment { id?: string; additional?: boolean; companyId: string; role: TeamRole; active: boolean; displayName: string; specialty: string; reviewerEmployeeId: string | null; remit: string; lessons: string }
export async function companyAssignments(organizationId: Types.ObjectId, companyIds: string[]): Promise<TeamAssignment[]> {
  if (!companyIds.length) return [];
  const scope = { organizationId, companyId: { $in: companyIds.map(id => new Types.ObjectId(id)) } };
  const [profiles, jobs, builds] = await Promise.all([
    CompanyTeam.find(scope).lean(),
    Job.find({ ...scope, status: { $nin: ['archived', 'rejected', 'done'] } }).select('companyId teamRole assignedMemberId request design.skill design.title design.category').lean(),
    BuildRequest.find({ ...scope, status: { $in: ['planning', 'proposed', 'queued', 'building', 'ready', 'failed'] } }).select('companyId teamRole assignedMemberId').lean(),
  ]);
  const result=companyIds.flatMap(companyId => TEAM_ROLES.map(role => {
    const saved = profiles.find(p => String(p.companyId) === companyId && p.role === role);
    const hasWork = jobs.some(j => String(j.companyId) === companyId && teamRoleFor(j) === role && (!j.assignedMemberId || String(j.assignedMemberId) === String(saved?._id)))
      || builds.some(b => String(b.companyId) === companyId && (b.teamRole ?? 'engineering') === role && (!b.assignedMemberId || String(b.assignedMemberId) === String(saved?._id)));
    return { id: saved?._id ? String(saved._id) : undefined, additional: false, companyId, role, active: TEAM[role].active && (hasWork || saved?.active === true), displayName: saved?.displayName && saved.displayName!==TEAM[role].name ? saved.displayName : saved?.identityName || TEAM[role].name,
      specialty: saved?.specialty ?? '', reviewerEmployeeId: saved?.reviewerEmployeeId ? String(saved.reviewerEmployeeId) : null,
      remit: saved?.remit ?? TEAM[role].remit, lessons: saved?.lessons ?? '' };
  }));
  for(const member of result)if(member.active){
    const saved=profiles.find(p=>String(p.companyId)===member.companyId&&p.role===member.role);
    if(!saved?.identityName){const name=await ensureEmployeeIdentity(organizationId,member.companyId,member.role);if(member.displayName===TEAM[member.role].name)member.displayName=name;if(!member.id)member.id=String((await CompanyTeam.findOne({organizationId,companyId:member.companyId,role:member.role}).select('_id').lean())?._id??'');}
    // Finishing a job does not dismiss its employee or remove their desk.
    if(saved?.active!==true)await CompanyTeam.updateOne({organizationId,companyId:member.companyId,role:member.role},{$set:{active:true}});
  }
  return [...result, ...profiles.flatMap(p => (p.specialists ?? []).map(s => ({ id: String(s._id), additional: true, companyId: String(p.companyId), role: p.role,
    active: TEAM[p.role].active && s.active, displayName: s.displayName, specialty: s.specialty ?? '', reviewerEmployeeId: s.reviewerEmployeeId ? String(s.reviewerEmployeeId) : null, remit: s.remit, lessons: s.lessons ?? '' })))];
}

/** An assignment does not grant access to another company's data. */
export async function availableReviewers(organizationId: Types.ObjectId, company: CompanyProfile) {
  const employees = await Employee.find({ organizationId: String(organizationId), userId: { $exists: true } }).select('name userId role').lean();
  return employees.filter(e => e.userId && (['Administrator', 'Manager'].includes(e.role) || String(e.userId) === String(organizationId) || company.teamEmployeeIds.includes(String(e._id))))
    .map(e => ({ id: String(e._id), userId: String(e.userId), name: e.name }));
}

export async function ensureTeamAssignment(organizationId: Types.ObjectId, companyId: string, role: TeamRole, userId: string) {
  await ensureEmployeeIdentity(organizationId,companyId,role);
  // Assigning new work is an explicit assignment; existing schedules and identity remain intact.
  await CompanyTeam.updateOne({ organizationId, companyId: new Types.ObjectId(companyId), role }, {
    $set: { active: true, updatedBy: new Types.ObjectId(userId) }, $setOnInsert: { remit: TEAM[role].remit },
  }, { upsert: true, runValidators: true });
}
