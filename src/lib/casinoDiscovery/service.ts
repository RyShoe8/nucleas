import 'server-only';
import { Types } from 'mongoose';
import { CasinoCandidate } from '@/lib/models/CasinoCandidate';
import type { JobRunOutput } from '@/lib/jobs/schema';
import { casinoResearchSchema, canonicalCasinoDomain, readiness } from './schema';
import { casinoIntake } from './intake';
import { PublishDelivery, PublishItem } from '@/lib/models/Publishing';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { askEngine } from '@/lib/ai/engine/ask';
import { composePost, manualPostText } from '@/lib/publishing/compose';
import { getCompanyProfile, loadCompanyViewer } from '@/lib/companies/companyProfile';
import { webFetch } from '@/lib/ai/tools/webFetch';

export async function discoveryMemory(job: {organizationId:Types.ObjectId;companyId:Types.ObjectId}) {
 const [inventory,candidates] = await Promise.all([(await casinoIntake(job.organizationId,job.companyId)).inventory(), CasinoCandidate.find({organizationId:job.organizationId,companyId:job.companyId}).select('domain name status').lean()]);
 if(!inventory.casinos)throw new Error('The site inventory could not be verified; discovery must not guess which sites are new.');
 return JSON.stringify({existingCatalog:inventory.casinos,previousCandidates:candidates.map(row=>({domain:row.domain,name:row.name,status:row.status}))});
}
export async function saveCandidates(job: { _id:Types.ObjectId;organizationId:Types.ObjectId;companyId:Types.ObjectId },runId:Types.ObjectId,output:JobRunOutput,reviewPassed:boolean) {
 const inventory=await (await casinoIntake(job.organizationId,job.companyId)).inventory();
 if(!inventory.casinos)throw new Error('Could not verify the existing catalog before saving candidates.');
 const existingDomains=new Set(inventory.casinos.flatMap(row=>[row.website_url,row.login_url].flatMap(url=>{try{return url?[canonicalCasinoDomain(url)]:[];}catch{return [];}})));
 const existingNames=new Set(inventory.casinos.map(row=>row.name.toLowerCase().replace(/\W/g,'')));
 for(const record of output.records){
  const parsed=casinoResearchSchema.safeParse(record.values);if(!parsed.success)continue;
  const research=parsed.data, domain=canonicalCasinoDomain(research.website_url);
  if(existingDomains.has(domain)||existingNames.has(research.name.toLowerCase().replace(/\W/g,'')))continue;
  const blockers=readiness(research);if(!reviewPassed)blockers.push('Independent research review has not passed.');
  const urls=[...new Set([research.website_url,research.terms_url,research.eligibility_url,...(research.program_url?[research.program_url]:[]),...Object.values(research.field_sources).flat()])];
  if(urls.length>30)blockers.push('Research contains too many sources to verify automatically; review the sources manually.');
  const pages=await Promise.allSettled(urls.slice(0,30).map(url=>webFetch(url)));
  pages.forEach((page,index)=>{if(page.status==='rejected'||page.value.thin)blockers.push(`Could not verify official page: ${urls[index]}`);});
  try{await CasinoCandidate.updateOne({organizationId:job.organizationId,companyId:job.companyId,domain},{$setOnInsert:{jobId:job._id,runId,name:research.name,research,sources:record.sources,status:'review',blockers}},{upsert:true});}catch(error){if(!(error instanceof Error && 'code' in error && error.code===11000))throw error;}
 }
}
export async function candidateList(organizationId: Types.ObjectId, companyId:Types.ObjectId) {
 const rows=await CasinoCandidate.find({organizationId,companyId}).sort({createdAt:-1}).lean();
 const imports=rows.some(row=>row.status==='added')?await casinoIntake(organizationId,companyId).then(intake=>intake.inventory()).then(data=>data.imports??[]).catch(()=>[]):[];
 return rows.map(row=>({id:String(row._id),name:row.name,domain:row.domain,status:row.status,research:row.research,sources:row.sources,blockers:row.blockers,note:row.note??'',error:row.error??null,siteUrl:row.siteUrl??null,decidedAt:row.decidedAt?.toISOString()??null,social:imports.find(item=>item.request_id===String(row._id))??null}));
}
async function queueReddit(candidate: {_id:Types.ObjectId;organizationId:Types.ObjectId;companyId:Types.ObjectId;jobId:Types.ObjectId;name:string;domain:string;research:unknown}, userId:string, siteUrl:string) {
 const parsed=casinoResearchSchema.parse(candidate.research);
 const item=await PublishItem.findOneAndUpdate({jobId:candidate.jobId,key:`casino:${candidate.domain ?? String(candidate._id)}`},{$setOnInsert:{organizationId:candidate.organizationId,companyId:candidate.companyId,status:'processed',title:candidate.name,url:siteUrl,facts:{title:candidate.name,description:parsed.payload.about}}},{upsert:true,new:true});
 if(await PublishDelivery.exists({itemId:item!._id,platform:'reddit'}))return;
 const voice=await BrandVoice.findOne({organizationId:candidate.organizationId,companyId:candidate.companyId,status:'approved'}).select('persona').lean();
 const viewer=await loadCompanyViewer(userId);const profile=viewer?await getCompanyProfile(viewer,String(candidate.companyId)):null;
 const draft=voice?.persona ? await composePost({platform:'reddit',companyName:profile?.name??'The team',persona:voice.persona,example:'',brief:'Introduce this newly added casino or sports betting site with useful verified features, rewards, eligibility and relevant limitations. Never imply guaranteed winnings or that everyone is eligible. Do not publish; this is manual review copy.',noun:'site',facts:{title:candidate.name,description:parsed.payload.about,extra:[`Type: ${parsed.site_type}`,`Eligibility: ${parsed.eligibility_evidence}`,`Rewards: ${parsed.bonus_terms}`,`Redemption: ${parsed.redemption_terms}`]},link:siteUrl},async({system,user})=>(await askEngine({organizationId:String(candidate.organizationId),userId,need:'write',system,user,maxTokens:1600}))?.text??null).catch(()=>null):null;
 await PublishDelivery.updateOne({itemId:item!._id,platform:'reddit'},{$setOnInsert:{organizationId:candidate.organizationId,companyId:candidate.companyId,jobId:candidate.jobId,mode:'manual',status:'ready',title:draft?.title??`New on ${profile?.name??'our site'}: ${candidate.name}`,body:draft?.body??`${parsed.payload.about}\n\n${siteUrl}`,link:siteUrl}},{upsert:true});
}
export async function decideCandidate(job:{_id:Types.ObjectId;organizationId:Types.ObjectId;companyId:Types.ObjectId},id:string,userId:string,action:'add'|'reject',note:string) {
 if(!Types.ObjectId.isValid(id))throw new Error('Candidate not found.');
 const filter={_id:new Types.ObjectId(id),organizationId:job.organizationId,companyId:job.companyId,jobId:job._id};
 const candidate=await CasinoCandidate.findOne(filter).lean();if(!candidate)throw new Error('Candidate not found.');
 if(action==='reject'){
  if(!['review','failed'].includes(candidate.status))throw new Error('This candidate is already being added or was handled.');
  const rejected=await CasinoCandidate.updateOne({...filter,status:{$in:['review','failed']}},{$set:{status:'rejected',note:note.slice(0,2000),decidedByUserId:new Types.ObjectId(userId),decidedAt:new Date()}});
  if(!rejected.modifiedCount)throw new Error('Someone already handled this candidate.');return;
 }
 if(candidate.status==='added'&&candidate.siteUrl)return;
 const research=casinoResearchSchema.parse(candidate.research);const blockers=[...candidate.blockers,...readiness(research)];if(blockers.length)throw new Error(`Resolve required research first: ${[...new Set(blockers)].join(' ')}`);
 const claimed=await CasinoCandidate.updateOne({...filter,$or:[{status:{$in:['review','failed']}},{status:'adding',decidedAt:{$lt:new Date(Date.now()-5*60*1000)}}]},{$set:{status:'adding',decidedByUserId:new Types.ObjectId(userId),decidedAt:new Date()},$unset:{error:''}});
 if(!claimed.modifiedCount)throw new Error('Someone is already handling this candidate.');
 try{
  const intake=await casinoIntake(job.organizationId,job.companyId);
  const viewer=await loadCompanyViewer(userId);const profile=viewer?await getCompanyProfile(viewer,String(job.companyId)):null;
  const url=`${intake.origin}/casinos/${research.payload.slug}`;
  const introduction=`New on ${profile?.name??'our site'}: ${research.name}.\n\n${research.payload.about}\n\nCheck the listing for eligibility, redemption requirements and current terms.`;
  const social_copy={facebook:manualPostText('facebook',introduction,url),bluesky:manualPostText('bluesky',`New on ${profile?.name??'our site'}: ${research.name}. ${research.payload.about}`,url),discord:manualPostText('facebook',introduction,url)};
  const result=await intake.add({request_id:String(candidate._id),domain:candidate.domain,research,social_copy});
  if(result.url!==url)throw new Error('The site did not confirm the expected new record URL.');
  await CasinoCandidate.updateOne(filter,{$set:{status:'added',siteUrl:result.url,addedAt:new Date()}});
 }catch(error){await CasinoCandidate.updateOne({...filter,status:'adding'},{$set:{status:'failed',error:error instanceof Error?error.message:'Intake failed.'}});throw error;}
}

export async function queueCandidateReddit(job:{_id:Types.ObjectId;organizationId:Types.ObjectId;companyId:Types.ObjectId}, id:string, userId:string){
 const filter={_id:new Types.ObjectId(id),jobId:job._id,organizationId:job.organizationId,companyId:job.companyId,status:'added'};
 const candidate=await CasinoCandidate.findOne(filter).lean();if(!candidate?.siteUrl)return;
 try { await queueReddit(candidate,userId,candidate.siteUrl); await CasinoCandidate.updateOne(filter,{$unset:{error:''}}); }
 catch(error){ await CasinoCandidate.updateOne(filter,{$set:{error:`Site added; Reddit draft needs recovery: ${error instanceof Error?error.message:'Drafting failed.'}`}}); throw error; }
}
