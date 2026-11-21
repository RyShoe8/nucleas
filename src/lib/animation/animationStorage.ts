import {Types} from 'mongoose';
import Asset from '@/lib/models/Asset';
import {AnimationPayload} from '@/lib/models/AnimationPayload';
import type {CompanyViewer} from '@/lib/companies/companyProfile';
import {RIGBY_TAG} from './rigbyProject';
import { createHash } from 'node:crypto';
import { creativeKeys, openCreativeStorage, readCreativeObject, signedCreativeDownload, putCreativeSource } from '@/lib/storage/roglyCreative';

/** Caller must resolve company access before using these storage helpers. */
export async function readAnimationBytes(viewer:CompanyViewer,companyId:string,assetId:string) {
  const row=await AnimationPayload.findOne({assetId,companyId,organizationId:viewer.organizationId});
  if (row?.storage === 'rogly') {
    const key = creativeKeys(String(viewer.organizationId),companyId,assetId).source;
    if (row.objectKey !== key) throw Error('Animation storage scope does not match.');
    const client = await openCreativeStorage(viewer.organizationId); if (!client) throw Error('Reconnect Rogly creative storage.');
    try { const result = await readCreativeObject(client,key,row.byteLength ?? undefined); if (result.sha256 !== row.sha256) throw Error('Animation integrity check failed.'); return result.bytes; }
    finally { client.destroy(); }
  }
  return row?.bytes?Buffer.from(row.bytes):null;
}
export async function animationDownloadUrl(viewer:CompanyViewer,companyId:string,assetId:string) {
  const row=await AnimationPayload.findOne({assetId,companyId,organizationId:viewer.organizationId}).select('storage objectKey');
  if (row?.storage !== 'rogly') return null;
  const key = creativeKeys(String(viewer.organizationId),companyId,assetId).source;
  if (row.objectKey !== key) throw Error('Animation storage scope does not match.');
  const client = await openCreativeStorage(viewer.organizationId); if (!client) throw Error('Reconnect Rogly creative storage.');
  try { return await signedCreativeDownload(client,key); } finally { client.destroy(); }
}
export async function saveAnimationVersion(viewer:CompanyViewer,companyId:string,name:string,description:string,bytes:Buffer) {
  const id=new Types.ObjectId();
  const client = await openCreativeStorage(viewer.organizationId);
  if (client) {
    try {
      const key=creativeKeys(String(viewer.organizationId),companyId,String(id)).source;
      await putCreativeSource(client,key,bytes);
      await AnimationPayload.create({assetId:id,companyId,organizationId:viewer.organizationId,storage:'rogly',objectKey:key,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    } finally { client.destroy(); }
  } else await AnimationPayload.create({assetId:id,companyId,organizationId:viewer.organizationId,bytes});
  try {
    return await Asset.create({_id:id,name,type:'file',category:'Animation',tags:[RIGBY_TAG],linkedClientId:companyId,userId:viewer.userId,description:description.slice(0,2000),
      fileUrl:`/api/os/animation-projects?companyId=${companyId}&id=${id}`});
  }catch(error){await AnimationPayload.deleteOne({assetId:id,organizationId:viewer.organizationId});throw error;}
}
