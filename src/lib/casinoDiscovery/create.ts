import 'server-only';
import { Types } from 'mongoose';
import { Job } from '@/lib/models/Job';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import { adminSessionFor } from '@/lib/companies/adminAccount';
import { readEngineSettings } from '@/lib/ai/engine/select';
import { casinoDiscoveryDesign } from '@/lib/jobs/templates/casinoDiscovery';
import { jobDesignSchema } from '@/lib/jobs/schema';
import { nextScheduledAt } from '@/lib/jobs/schedule';
export async function createCasinoDiscovery(viewer:CompanyViewer,companyId:string,activate=false){
 if(!isCompanyManager(viewer))throw new Error('A manager or administrator must configure discovery.');
 const profile=await getCompanyProfile(viewer,companyId);if(!profile)throw new Error('Company not found.');
 const existing=await Job.findOne({organizationId:viewer.organizationId,companyId,'design.skill':'casino_discovery',status:{$nin:['rejected','archived','done']}}).select('_id').lean();if(existing)return String(existing._id);
 const session=await adminSessionFor(viewer.organizationId,companyId);if(!session)throw new Error('Connect this company’s site admin account first.');
 const anchorDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());
 const design=jobDesignSchema.parse(casinoDiscoveryDesign(anchorDate));
 const job=await Job.create({organizationId:viewer.organizationId,companyId:new Types.ObjectId(companyId),createdByUserId:new Types.ObjectId(viewer.userId),status:activate?'active':'proposed',design,completion:'review',level:(await readEngineSettings(String(viewer.organizationId))).defaultCostLevel,monthlyBudgetMicros:2000000,request:'Every three days, discover new casinos and sports betting sites. Prioritize verified affiliate/referral programs. Gather all admin fields with official sources. A person adds each site once, then Facebook, Bluesky and Discord share automatically; Reddit remains manual. Keep a permanent searchable Don’t add list.',...(activate?{nextRunAt:nextScheduledAt(design.schedule,new Date())}:{}),publishing:{source:{type:'site',feedUrl:`${new URL(session.baseUrl).origin}/sitemap.xml`,feedKind:'sitemap',pathPrefix:'/casinos/',noun:'site'},channels:[{platform:'reddit',mode:'manual'}],brief:'Introduce reviewed newly added sites. Reddit is always manual.',notifyUserIds:[viewer.userId],examples:{}},events:[{at:new Date(),userId:new Types.ObjectId(viewer.userId),action:'casino_discovery_configured',note:'Three-day discovery; individual sites always require explicit review.'}]});
 return String(job._id);
}
