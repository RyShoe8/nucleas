import {describe,it,expect,vi,beforeEach} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
import {readFileSync} from 'node:fs';
import {Types} from 'mongoose';
const mocks=vi.hoisted(()=>({viewer:vi.fn(),profile:vi.fn(),read:vi.fn(),save:vi.fn(),find:vi.fn()}));
vi.mock('@/lib/companies/osRouteContext',()=>({requireCompanyViewer:mocks.viewer}));
vi.mock('@/lib/companies/companyProfile',()=>({getCompanyProfile:mocks.profile}));
vi.mock('@/lib/animation/animationStorage',()=>({readAnimationBytes:mocks.read,saveAnimationVersion:mocks.save}));
vi.mock('@/lib/models/Asset',()=>({default:{findOne:mocks.find}}));
import {GET,POST} from './route';
const company='b'.repeat(24),id='c'.repeat(24),viewer={userId:'a'.repeat(24),organizationId:new Types.ObjectId(),role:'Administrator',employeeId:null};
const url=`http://localhost/api/os/animation-projects?companyId=${company}`;
beforeEach(()=>{vi.resetAllMocks();mocks.viewer.mockResolvedValue(viewer);mocks.profile.mockResolvedValue({id:company});mocks.save.mockResolvedValue({_id:id});mocks.find.mockReturnValue({select:()=>({lean:async()=>({_id:id})})});});
describe('animation project API',()=>{
  it('requires authentication and company access before reading or writing',async()=>{
    mocks.viewer.mockResolvedValue(NextResponse.json({error:'Unauthorized'},{status:401}));
    expect((await GET(new NextRequest(`${url}&id=${id}`))).status).toBe(401);
    expect(mocks.profile).not.toHaveBeenCalled();
    mocks.viewer.mockResolvedValue(viewer);mocks.profile.mockResolvedValue(null);
    expect((await POST(new NextRequest(url,{method:'POST',body:'bad'}))).status).toBe(404);
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled();
  });
  it('stores a validated new version and returns private downloads',async()=>{
    const bytes=readFileSync('public/office/rigs/design.rigby');
    const saved=await POST(new NextRequest(url,{method:'POST',body:bytes}));
    expect(saved.status).toBe(201);expect((await saved.json()).id).toBe(id);
    expect(mocks.save).toHaveBeenCalledWith(viewer,company,'Nucleas design',expect.any(String),bytes);
    mocks.read.mockResolvedValue(bytes);
    const download=await GET(new NextRequest(`${url}&id=${id}`));
    expect(download.headers.get('Cache-Control')).toBe('private, no-store');
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    expect(mocks.read).toHaveBeenCalledWith(viewer,company,id);
  });
  it('rejects malformed or oversized uploads before persistence',async()=>{
    expect((await POST(new NextRequest(url,{method:'POST',body:'not a rig'}))).status).toBe(400);
    expect((await POST(new NextRequest(url,{method:'POST',body:new Uint8Array(3*1024*1024+1)}))).status).toBe(413);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
