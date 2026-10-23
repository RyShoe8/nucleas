import { after, NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getJob } from '@/lib/jobs/jobs';
import { Job } from '@/lib/models/Job';
import { candidateList, decideCandidate, queueCandidateReddit } from '@/lib/casinoDiscovery/service';
import { CasinoCandidate } from '@/lib/models/CasinoCandidate';
import { casinoResearchSchema, canonicalCasinoDomain, readiness } from '@/lib/casinoDiscovery/schema';
import { Types } from 'mongoose';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
type Context = {params:Promise<{id:string}>};
export async function GET(request:NextRequest,{params}:Context){
 const viewer=await requireCompanyViewer(request);if(viewer instanceof NextResponse)return viewer;
 const job=await getJob(viewer,(await params).id);if(!job||job.design?.skill!=='casino_discovery')return NextResponse.json({error:'Discovery job not found.'},{status:404});
 return NextResponse.json({candidates:await candidateList(viewer.organizationId,new Types.ObjectId(job.companyId))},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:NextRequest,{params}:Context){
 const viewer=await requireCompanyViewer(request);if(viewer instanceof NextResponse)return viewer;
 const view=await getJob(viewer,(await params).id);if(!view||view.design?.skill!=='casino_discovery')return NextResponse.json({error:'Discovery job not found.'},{status:404});
 if(!view.canManage)return NextResponse.json({error:'A manager or administrator must review candidates.'},{status:403});
 const body=await request.json().catch(()=>({}));if(typeof body.candidateId!=='string'||!Types.ObjectId.isValid(body.candidateId))return NextResponse.json({error:'Candidate not found.'},{status:404});
 const job=await Job.findOne({_id:view.id,organizationId:viewer.organizationId}).lean();if(!job)return NextResponse.json({error:'Job not found.'},{status:404});
 try{
 if(body.action==='update'){
  const parsed=casinoResearchSchema.safeParse(body.research);if(!parsed.success)return NextResponse.json({error:parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ')},{status:400});
  const domain=canonicalCasinoDomain(parsed.data.website_url);
  const result=await CasinoCandidate.updateOne({_id:body.candidateId,organizationId:viewer.organizationId,companyId:job.companyId,jobId:job._id,domain,status:{$in:['review','failed']}},{$set:{research:parsed.data,name:parsed.data.name,blockers:readiness(parsed.data),note:'Research manually reviewed and updated.',decidedByUserId:new Types.ObjectId(viewer.userId),decidedAt:new Date()}});
  if(!result.matchedCount)throw new Error('This candidate was handled, belongs to a different site, or is not editable.');
 }else if(body.action==='add'||body.action==='reject')await decideCandidate(job,body.candidateId,viewer.userId,body.action,typeof body.note==='string'?body.note:'');
 else return NextResponse.json({error:'Unknown action.'},{status:400});
 if(body.action==='add')after(()=>queueCandidateReddit(job,body.candidateId,viewer.userId).catch(error=>console.error('[casino-discovery] Reddit drafting failed',{candidateId:body.candidateId,error})));
 return NextResponse.json({ok:true});
 }catch(error){console.error('[casino-discovery] review action failed',{jobId:view.id,candidateId:body.candidateId,error});return NextResponse.json({error:error instanceof Error?error.message:'Could not process candidate.'},{status:409});}
}
