import 'server-only';
import { Types } from 'mongoose';
import { listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import { CompanyTeam } from '@/lib/models/CompanyTeam';
import Employee from '@/lib/models/Employee';
import { Job, JobRun } from '@/lib/models/Job';
import { BuildRequest } from '@/lib/models/BuildRequest';
import { PublishDelivery } from '@/lib/models/Publishing';
import { LinkOpportunity } from '@/lib/models/LinkOpportunity';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { MarketingPlan } from '@/lib/models/MarketingPlan';
import { CapabilityApproval } from '@/lib/models/Capability';
import { listActivity } from '@/lib/activity/activity';
import { TEAM, teamRoleFor, type TeamRole } from '@/lib/companies/teamRoles';
import { attentionLink, type AttentionItem } from './types';

/** Current work, not an accumulating notification log. Resolved requests disappear automatically. */
export async function attentionFor(viewer: CompanyViewer): Promise<AttentionItem[]> {
  const companies = await listCompanyProfiles(viewer);
  const byCompany = new Map(companies.map(c => [c.id, c]));
  const scope = { organizationId: viewer.organizationId, companyId: { $in: companies.map(c => new Types.ObjectId(c.id)) } };
  const [members, people, jobs, builds, other, voices, plans, approvals] = await Promise.all([
    CompanyTeam.find(scope).select('companyId role displayName identityName reviewerEmployeeId').lean(),
    Employee.find({ organizationId: String(viewer.organizationId), userId: { $type: 'objectId' } }).select('userId').lean(),
    Job.find({ ...scope, status: { $nin: ['archived', 'rejected'] } }).select('companyId teamRole design.title design.skill design.category request status updatedAt error lastRunAt').lean(),
    BuildRequest.find({ ...scope, status: { $in: ['proposed', 'ready', 'failed'] } }).select('companyId teamRole title status updatedAt error').lean(),
    listActivity(viewer, { complete: true, excludeBuilds: true }),
    BrandVoice.find({...scope,status:'draft',revision:{$gt:0}}).select('companyId updatedAt').lean(),
    MarketingPlan.find({...scope,status:'draft'}).select('companyId updatedAt').lean(),
    CapabilityApproval.find({...scope,status:'pending',expiresAt:{$gt:new Date()}}).select('companyId capabilityId createdAt').lean(),
  ]);
  const userByEmployee = new Map(people.map(p => [String(p._id), String(p.userId)]));
  const items: AttentionItem[] = [];
  const add = (id: string, companyId: string, role: TeamRole, title: string, detail: string, since: Date | string, moduleId: string, extra: Record<string, string> = {}) => {
    const company = byCompany.get(companyId); if (!company) return;
    const member = members.find(m => String(m.companyId) === companyId && m.role === role);
    const recipient = member?.reviewerEmployeeId ? userByEmployee.get(String(member.reviewerEmployeeId)) : String(viewer.organizationId);
    if ((recipient ?? String(viewer.organizationId)) !== viewer.userId) return;
    const payload = { companyId, companyName: company.name, role, ...extra };
    items.push({ id, companyId, companyName: company.name, employeeName: member?.displayName || member?.identityName || TEAM[role].name,
      title: title.slice(0, 180), detail: detail.slice(0, 500), since: new Date(since).toISOString(), moduleId, payload, href: attentionLink(moduleId, payload) });
  };
  const ids = jobs.map(j => j._id), byJob = new Map(jobs.map(j => [String(j._id), j]));
  // No display-list cap and no five-run cutoff: every outstanding review is included.
  const [reviews, deliveries, links, latestRuns] = await Promise.all([
    JobRun.find({ ...scope, jobId: { $in: ids }, status: 'needs_review' }).select('jobId updatedAt dryRun').lean(),
    PublishDelivery.find({ ...scope, jobId: { $in: ids }, $or:[{status:'ready',heldFor:{$ne:'reddit'}},{status:'failed'}] }).select('jobId platform status createdAt error').lean(),
    LinkOpportunity.find({ ...scope, jobId: { $in: ids }, status: { $in: ['recommended', 'approved'] } }).select('jobId status updatedAt').lean(),
    JobRun.aggregate<{ _id: Types.ObjectId; run: { _id: Types.ObjectId; status: string; updatedAt: Date; dryRun: boolean } }>([
      { $match: { ...scope, jobId: { $in: ids } } }, { $sort: { createdAt: -1 } },
      { $group: { _id: '$jobId', run: { $first: { _id: '$_id', status: '$status', updatedAt: '$updatedAt', dryRun: '$dryRun' } } } },
    ]),
  ]);
  const jobItem = (jobId: string, id: string, detail: string, at: Date, extra: Record<string, string> = {}) => {
    const job = byJob.get(jobId); if (!job) return;
    add(id, String(job.companyId), teamRoleFor(job), job.design?.title || 'Team assignment', detail, at, 'team', { jobId, ...extra });
  };
  for (const job of jobs) {
    const detail = job.status === 'needs_answers' ? 'Answer the open questions' : job.status === 'proposed' ? 'Review the proposed plan or trial run' : job.status === 'failed' ? job.error || 'This assignment needs help' : null;
    if (detail) jobItem(String(job._id), `job:${job._id}:${job.status}`, detail, job.updatedAt);
  }
  for (const r of reviews) jobItem(String(r.jobId), `run:${r._id}`, r.dryRun ? 'Review the trial result' : 'Review the finished result', r.updatedAt, { runId: String(r._id) });
  for (const d of deliveries) jobItem(String(d.jobId), `delivery:${d._id}`, d.status === 'failed' ? `Resolve the ${d.platform} delivery failure` : `Review or complete the ${d.platform} post`, d.createdAt, { deliveryId: String(d._id) });
  for (const l of links) jobItem(String(l.jobId), `link:${l._id}`, l.status === 'approved' ? 'Complete the approved link submission' : 'Review a link opportunity', l.updatedAt, {opportunityId:String(l._id)});
  for (const r of latestRuns) if (r.run.status === 'failed' && !r.run.dryRun && ['active', 'ready'].includes(byJob.get(String(r._id))?.status ?? '')) jobItem(String(r._id), `run:${r.run._id}`, 'The latest run failed and needs help', r.run.updatedAt);
  for (const b of builds) add(`build:${b._id}:${b.status}`, String(b.companyId), b.teamRole ?? 'engineering', b.title, b.status === 'failed' ? b.error || 'The build needs help' : b.status === 'proposed' ? 'Review the implementation plan' : 'Review the completed code change', b.updatedAt, 'team', { jobId: String(b._id) });
  for(const v of voices)add(`voice:${v._id}`,String(v.companyId),'marketing','Approve brand voice','Review the saved voice before it is used in content',v.updatedAt,'brand-voice');
  for(const p of plans)add(`plan:${p._id}`,String(p.companyId),'marketing','Approve marketing overview','Review the saved strategy and proposed work',p.updatedAt,'marketing',{kind:'marketing_plan'});
  for(const a of approvals){const role:TeamRole=/^(code|hosting|website)\./.test(a.capabilityId)?'engineering':/^(payments|bank|commerce)\./.test(a.capabilityId)?'operations':a.capabilityId.startsWith('support.')?'support':'marketing';add(`approval:${a._id}`,String(a.companyId),role,a.capabilityId.replace(/[._]/g,' '),'Review the requested external action',a.createdAt,'company',{section:'activity',approvalId:String(a._id)});}
  for (const a of other) if (a.kind !== 'build' && a.companyId && ['you', 'failed'].includes(a.group)) add(`activity:${a.id}:${a.status}`, a.companyId, 'marketing', a.title, a.detail, new Date(0), a.open.window, a.open.payload);
  return items.sort((a, b) => a.companyName.localeCompare(b.companyName) || a.since.localeCompare(b.since));
}
