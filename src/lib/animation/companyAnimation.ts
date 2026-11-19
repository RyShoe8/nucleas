import 'server-only';
import { Types } from 'mongoose';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Asset from '@/lib/models/Asset';
import { getCompanyProfile, type CompanyViewer } from '@/lib/companies/companyProfile';
import { inspectRigby, RIGBY_TAG } from './rigbyProject';
import {readAnimationBytes,saveAnimationVersion} from './animationStorage';
import { Workspace, createTools } from '../../../vendor/rigby/src/mcp/tools.js';
import { createEditTools } from '../../../vendor/rigby/src/mcp/edits.js';

const EDITS=new Set(['add_animation','add_bone','set_bone_setup','set_bone_key','set_attachment_key','set_event_key']);
type RigbyTool = {name:string;handler:(args:Record<string,unknown>)=>Promise<Record<string,unknown>>};

/** Draft-only access to the same canonical Assets used by Animation Studio. Never publishes live art. */
export async function companyAnimation(viewer:CompanyViewer,companyId:string,input:{assetId?:string;operations?:string}) {
  if(!(await getCompanyProfile(viewer,companyId)))throw new Error('Company not found.');
  if(input.operations&&!input.assetId)throw new Error('Choose a saved animation asset before editing.');
  if(!input.assetId) return {projects:await Asset.find({linkedClientId:companyId,tags:RIGBY_TAG}).select('name description createdAt').sort({createdAt:-1}).limit(40).lean(),studio:'Creative → Animation Studio'};
  if(!Types.ObjectId.isValid(input.assetId))throw new Error('Invalid animation asset.');
  const source=await Asset.findOne({_id:input.assetId,linkedClientId:companyId,tags:RIGBY_TAG}).select('name').lean();
  if(!source)throw new Error('Animation asset not found.');
  const bytes=await readAnimationBytes(viewer,companyId,input.assetId);
  if(!bytes)throw new Error('Animation file not found.');inspectRigby(bytes);
  const folder=await mkdtemp(path.join(tmpdir(),'nucleas-rigby-'));
  try {
    await writeFile(path.join(folder,'project.rigby'),bytes);
    const workspace=await Workspace.open([folder]);
    const reads=createTools(workspace) as RigbyTool[];
    if(!input.operations) {
      const rig=await reads.find(tool=>tool.name==='describe_rig')!.handler({path:'project.rigby'});
      return { ...rig, file:input.assetId, summary:inspectRigby(bytes) };
    }
    if(input.operations.length>16000)throw new Error('Use a focused edit of at most 16,000 characters.');
    const operations=JSON.parse(input.operations);
    if(!Array.isArray(operations)||!operations.length||operations.length>64)throw new Error('Use between 1 and 64 animation edits.');
    for(const operation of operations) {
      if(!operation||typeof operation!=='object'||!EDITS.has(operation.op)||'path' in operation||'output' in operation)throw new Error('Only bone, animation, attachment and event edits are supported.');
    }
    const batch=(createEditTools(workspace) as unknown as RigbyTool[]).find(tool=>tool.name==='batch_edit');
    if(!batch)throw new Error('Animation editing unavailable.');
    await batch.handler({path:'project.rigby',operations});
    const result=await readFile(path.join(folder,'project.rigby'));const info=inspectRigby(result);
    const asset=await saveAnimationVersion(viewer,companyId,source.name,`Draft based on ${input.assetId}; ${operations.length} Rigby edits. ${info.animations.map((a:{name:string})=>a.name).join(', ')}`,result);
    return {assetId:String(asset._id),basedOn:input.assetId,...info,status:'draft',message:'Saved a separate editable version. Review it in Creative → Animation Studio. Live office art is unchanged.'};
  } finally {await rm(folder,{recursive:true,force:true});}
}
