import 'server-only';
import mongoose, { Types } from 'mongoose';
import Employee from '@/lib/models/Employee';
import User from '@/lib/models/User';
import Invitation from '@/lib/models/Invitation';
import Project from '@/lib/models/Project';
import {CompanyTeam} from '@/lib/models/CompanyTeam';
import {OfficeSceneModel} from '@/lib/models/OfficeScene';
import type {CompanyViewer} from '@/lib/companies/companyProfile';

export class EmployeeManagementError extends Error {
  constructor(message:string, public status:number){super(message);}
}
export async function invalidateOfficeRoster(organizationId:Types.ObjectId){
  // Bump revision too: an in-flight office refresh must not overwrite this invalidation.
  await OfficeSceneModel.updateOne({_id:organizationId},{$set:{'scene.contextAt':0},$inc:{revision:1}});
}
export async function removeOfficeEmployee(viewer:CompanyViewer,id:string){
  if(viewer.role!=='Administrator')throw new EmployeeManagementError('Only administrators can remove employees.',403);
  if(!/^[a-f0-9]{24}$/i.test(id))throw new EmployeeManagementError('Employee not found.',404);
  const organizationId=String(viewer.organizationId);
  await mongoose.connection.transaction(async session=>{
    const person=await Employee.findOne({_id:id,organizationId}).session(session);
    if(!person)throw new EmployeeManagementError('Employee not found.',404);
    if(String(person.userId)===organizationId||String(person.userId)===viewer.userId||String(person._id)===viewer.employeeId)
      throw new EmployeeManagementError('You cannot remove yourself or the organization owner.',409);
    // Preserve the account and its history, but detach membership from this organization.
    if(person.userId){
      // Legacy projects are scoped via their owning user's organization. Keep them with this team.
      const member=await User.findOne({_id:person.userId,organizationId}).session(session);
      if(member){
        await Project.updateMany({userId:person.userId},{$set:{userId:viewer.organizationId}},{session});
        await User.updateOne({_id:person.userId,organizationId},{$set:{organizationId:String(person.userId),organizationSetupComplete:false}},{session});
      }
    }
    await Invitation.updateMany({organizationId,employeeId:person._id,status:'pending'},{$set:{status:'expired',expiresAt:new Date()}},{session});
    // Missing reviewer already routes work to the organization owner; keep every virtual employee/job.
    await CompanyTeam.updateMany({organizationId:viewer.organizationId,reviewerEmployeeId:person._id},{$unset:{reviewerEmployeeId:1}},{session});
    await Employee.deleteOne({_id:person._id,organizationId},{session});
    await OfficeSceneModel.updateOne({_id:viewer.organizationId},{$set:{'scene.contextAt':0},$inc:{revision:1}},{session});
  });
}
