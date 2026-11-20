import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import mongoose,{Types} from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server-core';
const mocks=vi.hoisted(()=>({companies:vi.fn(),activity:vi.fn()}));
vi.mock('@/lib/companies/companyProfile',()=>({listCompanyProfiles:mocks.companies}));
vi.mock('@/lib/activity/activity',()=>({listActivity:mocks.activity}));
import {attentionFor} from './service';
import {CompanyTeam} from '@/lib/models/CompanyTeam';
import {Job,JobRun} from '@/lib/models/Job';
import {PublishDelivery} from '@/lib/models/Publishing';
import Employee from '@/lib/models/Employee';
import {companyAssignments,availableReviewers,ensureEmployeeIdentity} from '@/lib/companies/teamAssignments';
import type {CompanyProfile,CompanyViewer} from '@/lib/companies/companyProfile';
import {buildOffice} from '@/components/os/modules/office/officeState';
import {makeWorld} from '@/components/os/modules/office/officeSimulation';
let db:MongoMemoryServer;
const org=new Types.ObjectId(),company=new Types.ObjectId(),person=new Types.ObjectId(),employee=new Types.ObjectId(),foreign=new Types.ObjectId();
const owner:CompanyViewer={userId:String(org),organizationId:org,employeeId:null,role:'Administrator'};
const colleague:CompanyViewer={...owner,userId:String(person),employeeId:String(employee),role:'User'};
const profile={id:String(company),name:'Our company',teamEmployeeIds:[String(employee)]} as CompanyProfile;
const createJob=(extra:Record<string,unknown>={})=>Job.create({organizationId:org,companyId:company,createdByUserId:org,request:'Create a useful campaign',teamRole:'marketing',status:'active',design:{title:'Campaign'},...extra});
beforeAll(async()=>{db=await MongoMemoryServer.create();await mongoose.connect(db.getUri('attention_test'));});
afterAll(async()=>{await mongoose.disconnect();await db.stop();});
beforeEach(async()=>{
 await mongoose.connection.dropDatabase();mocks.companies.mockResolvedValue([profile]);mocks.activity.mockResolvedValue([]);
 await CompanyTeam.syncIndexes();
 await Employee.create({_id:employee,organizationId:String(org),userId:person,name:'Human reviewer',role:'User'});
});
it('routes every outstanding run to the assigned human, with no history display cutoff',async()=>{
 const job=await createJob();
 await CompanyTeam.create({organizationId:org,companyId:company,role:'marketing',displayName:'Growth editor',remit:'Grow the audience',reviewerEmployeeId:employee,updatedBy:org});
 const runs=await JobRun.insertMany(Array.from({length:25},()=>({organizationId:org,companyId:company,jobId:job._id,status:'needs_review',startedAt:new Date()})));
 expect(await attentionFor(owner)).toEqual([]);
 const items=await attentionFor(colleague);expect(items).toHaveLength(25);expect(items.every(i=>i.employeeName==='Growth editor')).toBe(true);
 expect(JSON.parse(new URL(items[0].href).searchParams.get('payload')!).runId).toBe(String(runs[0]._id));
 await JobRun.updateMany({jobId:job._id},{$set:{status:'completed'}});expect(await attentionFor(colleague)).toEqual([]);
});
it('never leaks another organization or inaccessible company through assignments or links',async()=>{
 const job=await createJob({status:'proposed'});
 await createJob({organizationId:foreign,status:'proposed'});
 await createJob({companyId:foreign,status:'failed'});
 const items=await attentionFor(owner);expect(items).toHaveLength(1);expect(items[0].payload.jobId).toBe(String(job._id));
 mocks.companies.mockResolvedValue([]);expect(await attentionFor(owner)).toEqual([]);
});
it('falls back to the organization owner if the linked employee no longer exists',async()=>{
 await createJob({status:'failed'});
 await CompanyTeam.create({organizationId:org,companyId:company,role:'marketing',remit:'Grow audience',reviewerEmployeeId:foreign,updatedBy:org});
 expect(await attentionFor(owner)).toHaveLength(1);expect(await attentionFor(colleague)).toHaveLength(0);
});
it('removes posted deliveries and includes failures needing intervention',async()=>{
 const job=await createJob(),id=new Types.ObjectId();
 await PublishDelivery.collection.insertOne({_id:id,organizationId:org,companyId:company,jobId:job._id,status:'ready',platform:'facebook',createdAt:new Date()});
 expect((await attentionFor(owner))[0].payload.deliveryId).toBe(String(id));
 await PublishDelivery.updateOne({_id:id},{$set:{status:'posted'}});expect(await attentionFor(owner)).toEqual([]);
 await JobRun.create({organizationId:org,companyId:company,jobId:job._id,status:'failed',startedAt:new Date()});expect((await attentionFor(owner))[0].detail).toContain('failed');
});
it('assigns only existing work and explicit staff, including a renamed specialist',async()=>{
 await createJob();
 await CompanyTeam.create({organizationId:org,companyId:company,role:'creative',active:true,displayName:'Motion artist',specialty:'Short product demos',remit:'Create assets',updatedBy:org});
 await CompanyTeam.create({organizationId:org,companyId:company,role:'tester',active:true,remit:'Reserved',updatedBy:org});
 const staff=await companyAssignments(org,[String(company)]);expect(staff.filter(s=>s.active).map(s=>s.role).sort()).toEqual(['creative','marketing']);
 expect(staff.find(s=>s.role==='creative')).toMatchObject({displayName:'Motion artist',specialty:'Short product demos'});
 expect((await companyAssignments(foreign,[String(company)])).some(s=>s.active)).toBe(false);
});
it('adds one desk per assigned employee and retains that employee when their work finishes',async()=>{
 const job=await createJob();
 const world=async()=>makeWorld(buildOffice({companies:[{...profile,relationship:'owned'}],assignments:await companyAssignments(org,[String(company)]),jobs:[],activity:[],today:[]}));
 const first=await world();expect(first.people).toHaveLength(1);
 await Job.updateOne({_id:job._id},{$set:{status:'done'}});
 expect((await world()).people.map(p=>p.id)).toEqual(first.people.map(p=>p.id));
 await CompanyTeam.create({organizationId:org,companyId:company,role:'creative',active:true,updatedBy:org,remit:'Make images'});
 expect((await world()).people).toHaveLength(2);
 await CompanyTeam.updateOne({organizationId:org,companyId:company,role:'creative'},{$set:{active:false}});
 expect((await world()).people).toHaveLength(1);
});
it('lists human contacts only from this organization who already have company access',async()=>{
 await Employee.create({organizationId:String(org),userId:foreign,name:'Unassigned colleague',role:'User'});
 await Employee.create({organizationId:String(foreign),userId:foreign,name:'Outside manager',role:'Manager'});
 const reviewers=await availableReviewers(org,profile);expect(reviewers.map(r=>r.id)).toEqual([String(employee)]);
});
it('persists a different identity for the same role at different companies, even on concurrent first loads',async()=>{
 const second=new Types.ObjectId();
 const names=await Promise.all([ensureEmployeeIdentity(org,String(company),'marketing'),ensureEmployeeIdentity(org,String(company),'marketing'),ensureEmployeeIdentity(org,String(second),'marketing')]);
 expect(names[0]).toBe(names[1]);expect(names[0]).not.toBe(names[2]);expect(await CompanyTeam.countDocuments()).toBe(2);
 await CompanyTeam.updateOne({companyId:company},{$set:{displayName:'Morgan'}});
 const staff=await companyAssignments(org,[String(company),String(second)]);
 expect(staff.find(s=>s.companyId===String(company)&&s.role==='marketing')?.displayName).toBe('Morgan');
 expect(await ensureEmployeeIdentity(org,String(second),'marketing')).toBe(names[2]);
});
