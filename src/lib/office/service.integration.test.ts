import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import mongoose,{Types} from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server-core';
const mocks=vi.hoisted(()=>({companies:vi.fn(),jobs:vi.fn(),activity:vi.fn(),today:vi.fn(),logos:vi.fn()}));
vi.mock('@/lib/companies/companyProfile',()=>({listCompanyProfiles:mocks.companies}));
vi.mock('@/lib/jobs/jobs',()=>({listJobs:mocks.jobs}));
vi.mock('@/lib/activity/activity',()=>({listActivity:mocks.activity}));
vi.mock('@/lib/metrics/query',()=>({getTodayOverview:mocks.today}));
vi.mock('@/lib/models/BrandAsset',()=>({BrandAsset:{find:mocks.logos}}));
import {organizationOffice} from './service';
import {CompanyTeam} from '@/lib/models/CompanyTeam';
import {OfficeSceneModel} from '@/lib/models/OfficeScene';
import Employee from '@/lib/models/Employee';
import type {CompanyViewer} from '@/lib/companies/companyProfile';
let db:MongoMemoryServer;
const company='b'.repeat(24),org=new Types.ObjectId();
const viewer:CompanyViewer={userId:'a'.repeat(24),organizationId:org,employeeId:null,role:'User'};
beforeAll(async()=>{db=await MongoMemoryServer.create();await mongoose.connect(db.getUri('office_test'));});
afterAll(async()=>{await mongoose.disconnect();await db.stop();});
beforeEach(async()=>{
  await OfficeSceneModel.deleteMany({});await CompanyTeam.deleteMany({});await Employee.deleteMany({});
  await CompanyTeam.insertMany(['design','support','operations','marketing'].map(role=>({organizationId:org,companyId:company,role,active:true,updatedBy:org,remit:role})));vi.clearAllMocks();
  mocks.companies.mockResolvedValue([{id:company,name:'Shared company',relationship:'owned'}]);
  mocks.jobs.mockResolvedValue([]);mocks.activity.mockResolvedValue([]);mocks.today.mockResolvedValue({rows:[]});
  mocks.logos.mockReturnValue({select:()=>({lean:async()=>[]})});
});
it('persists one office for different users, with isolated organizations',async()=>{
  const first=await organizationOffice(viewer,{personId:`${company}:design`,target:'pool'});
  const second=await organizationOffice({...viewer,userId:'c'.repeat(24)});
  expect(second.scene).toEqual(first.scene);expect(second.revision).toBe(first.revision);
  expect(await OfficeSceneModel.countDocuments()).toBe(1);
  const other=await organizationOffice({...viewer,organizationId:new Types.ObjectId()});
  expect(other.scene.overrides).toEqual({});expect(await OfficeSceneModel.countDocuments()).toBe(2);
});
it('concurrent commands preserve both updates rather than overwriting the office',async()=>{
  await organizationOffice(viewer);
  await Promise.all([
    organizationOffice(viewer,{personId:`${company}:design`,target:'pool'}),
    organizationOffice({...viewer,userId:'c'.repeat(24)},{personId:`${company}:support`,target:'coffee'}),
  ]);
  const saved=await OfficeSceneModel.findById(org).lean();
  expect(saved?.scene.overrides).toMatchObject({[`${company}:design`]:'pool',[`${company}:support`]:'coffee'});
  expect(saved?.revision).toBe(3);
});
it('rejects a fourth shared sofa occupant and keeps the three saved visits',async()=>{
  for(const role of ['design','support','operations'])await organizationOffice(viewer,{personId:`${company}:${role}`,target:'gaming'});
  await expect(organizationOffice(viewer,{personId:`${company}:marketing`,target:'couch'})).rejects.toThrow(/full/);
  const saved=await OfficeSceneModel.findById(org).lean();
  expect(Object.keys(saved!.scene.overrides)).toHaveLength(3);
});
it('creates the Management area from real employees and links their assigned virtual staff',async()=>{
  const human=await Employee.create({organizationId:String(org),name:'Kelly McGuire',jobTitle:'Creative director',role:'Manager'});
  await Employee.create({organizationId:String(new Types.ObjectId()),name:'Outside employee',role:'User'});
  await CompanyTeam.updateOne({organizationId:org,companyId:company,role:'design'},{$set:{reviewerEmployeeId:human._id,displayName:'Morgan Reed'}});
  const snapshot=await organizationOffice(viewer);
  const management=snapshot.scene.world.suites.find(s=>s.room.kind==='management')!;
  expect(management.room.desks).toHaveLength(1);
  expect(management.room.desks[0]).toMatchObject({human:true,name:'Kelly McGuire',specialty:'Creative director',reports:[{companyId:company,name:'Morgan Reed',role:'design'}]});
  const person=snapshot.scene.world.people.find(p=>p.desk.human)!;
  expect(person.id).toBe(`human:${human._id}`);
  expect(snapshot.scene.actors.find(a=>a.id===person.id)?.destination).toEqual(person.home);
  expect(JSON.stringify(snapshot)).not.toContain('Outside employee');
});
