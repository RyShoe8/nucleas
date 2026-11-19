import {Types} from 'mongoose';
import Asset from '@/lib/models/Asset';
import {AnimationPayload} from '@/lib/models/AnimationPayload';
import type {CompanyViewer} from '@/lib/companies/companyProfile';
import {RIGBY_TAG} from './rigbyProject';

/** Caller must resolve company access before using these storage helpers. */
export async function readAnimationBytes(viewer:CompanyViewer,companyId:string,assetId:string) {
  const row=await AnimationPayload.findOne({assetId,companyId,organizationId:viewer.organizationId}).select('bytes');
  return row?.bytes?Buffer.from(row.bytes):null;
}
export async function saveAnimationVersion(viewer:CompanyViewer,companyId:string,name:string,description:string,bytes:Buffer) {
  const id=new Types.ObjectId();
  await AnimationPayload.create({assetId:id,companyId,organizationId:viewer.organizationId,bytes});
  try {
    return await Asset.create({_id:id,name,type:'file',category:'Animation',tags:[RIGBY_TAG],linkedClientId:companyId,userId:viewer.userId,description:description.slice(0,2000),
      fileUrl:`/api/os/animation-projects?companyId=${companyId}&id=${id}`});
  }catch(error){await AnimationPayload.deleteOne({assetId:id,organizationId:viewer.organizationId});throw error;}
}
