import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
import {Types} from 'mongoose';
const mocks=vi.hoisted(()=>({viewer:vi.fn(),profile:vi.fn(),companies:vi.fn(),office:vi.fn()}));
vi.mock('@/lib/companies/osRouteContext',()=>({requireCompanyViewer:mocks.viewer}));
vi.mock('@/lib/companies/companyProfile',()=>({getCompanyProfile:mocks.profile,listCompanyProfiles:mocks.companies}));
vi.mock('@/lib/office/service',()=>({organizationOffice:mocks.office,OfficeConflict:class extends Error{}}));
import {GET,POST} from './route';
import {advanceScene} from '@/lib/office/timeline';
import {buildOffice} from '@/components/os/modules/office/officeState';
const company='b'.repeat(24),hidden='c'.repeat(24),viewer={userId:'a'.repeat(24),organizationId:new Types.ObjectId(),role:'User',employeeId:null};
const request=(body:unknown)=>new NextRequest('http://localhost/api/os/office',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.viewer.mockResolvedValue(viewer);mocks.profile.mockResolvedValue({id:company});mocks.companies.mockResolvedValue([{id:company}]);mocks.office.mockResolvedValue({revision:1,serverTime:1000,scene:advanceScene(null,buildOffice({companies:[{id:company,name:'Visible'},{id:hidden,name:'Secret'}],jobs:[],activity:[],today:[]}),1000)});});
it('requires a session and rejects supplied organization IDs',async()=>{
  mocks.viewer.mockResolvedValue(NextResponse.json({error:'Unauthorized'},{status:401}));
  expect((await GET(new NextRequest('http://localhost/api/os/office'))).status).toBe(401);
  mocks.viewer.mockResolvedValue(viewer);
  expect((await POST(request({companyId:company,role:'design',target:'pool',organizationId:hidden}))).status).toBe(400);
  expect(mocks.office).not.toHaveBeenCalled();
});
it('filters hidden companies and keeps the response private',async()=>{
  const result=await GET(new NextRequest('http://localhost/api/os/office'));
  expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  const body=await result.text();expect(body).not.toContain(hidden);expect(body).not.toContain('Secret');
});
it('checks company access before sending a shared visit',async()=>{
  mocks.profile.mockResolvedValue(null);
  expect((await POST(request({companyId:company,role:'design',target:'pool'}))).status).toBe(404);
  expect(mocks.office).not.toHaveBeenCalled();
  mocks.profile.mockResolvedValue({id:company});
  expect((await POST(request({companyId:company,role:'design',target:'pool'}))).status).toBe(200);
  expect(mocks.office).toHaveBeenCalledWith(viewer,{personId:`${company}:design`,target:'pool'});
});
