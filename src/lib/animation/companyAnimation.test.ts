import {describe,it,expect,vi,beforeEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {Types} from 'mongoose';
const mocks=vi.hoisted(()=>({profile:vi.fn(),find:vi.fn(),read:vi.fn(),save:vi.fn()}));
vi.mock('@/lib/companies/companyProfile',()=>({getCompanyProfile:mocks.profile}));
vi.mock('@/lib/models/Asset',()=>({default:{findOne:mocks.find}}));
vi.mock('./animationStorage',()=>({readAnimationBytes:mocks.read,saveAnimationVersion:mocks.save}));
import {companyAnimation} from './companyAnimation';
import {inspectRigby} from './rigbyProject';
const viewer={userId:'a'.repeat(24),organizationId:new Types.ObjectId(),employeeId:null,role:'Administrator' as const};
const company='b'.repeat(24),assetId='c'.repeat(24);
beforeEach(()=>{vi.resetAllMocks();mocks.profile.mockResolvedValue({id:company});mocks.find.mockReturnValue({select:()=>({lean:async()=>({name:'Creative'})})});mocks.read.mockResolvedValue(readFileSync('public/office/rigs/creative.rigby'));mocks.save.mockResolvedValue({_id:new Types.ObjectId()});});
describe('company-scoped Rigby tools',()=>{
  it('denies inaccessible companies before reading a file',async()=>{
    mocks.profile.mockResolvedValue(null);
    await expect(companyAnimation(viewer,company,{assetId})).rejects.toThrow('Company not found');
    expect(mocks.find).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled();
  });
  it('inspects the real rig and preserves the requested company boundary',async()=>{
    const result=await companyAnimation(viewer,company,{assetId});
    expect(result).toMatchObject({file:assetId,summary:{bones:11}});
    expect(mocks.find).toHaveBeenCalledWith({_id:assetId,linkedClientId:company,tags:'nucleas:rigby'});
  });
  it('runs a real Rigby edit and saves a separate version without modifying its source',async()=>{
    const source=readFileSync('public/office/rigs/creative.rigby');
    const result=await companyAnimation(viewer,company,{assetId,operations:JSON.stringify([{op:'add_animation',name:'wave'},{op:'set_bone_key',animation:'wave',bone:'right-forearm',channel:'rotate',time:1,value:35}])});
    expect(result).toMatchObject({status:'draft',basedOn:assetId});
    const bytes=mocks.save.mock.calls[0][4] as Buffer;
    expect(inspectRigby(bytes).animations.map((a:{name:string})=>a.name)).toContain('wave');
    expect(readFileSync('public/office/rigs/creative.rigby')).toEqual(source);
  });
  it('refuses scripts and caller-controlled paths, and saves nothing on malformed edits',async()=>{
    for(const operation of [{op:'run_script',script:'bad'},{op:'add_animation',name:'x',output:'elsewhere'},{op:'set_bone_key',animation:'missing',bone:'head',time:0,value:1,channel:'rotate'}]) {
      await expect(companyAnimation(viewer,company,{assetId,operations:JSON.stringify([operation])})).rejects.toThrow();
    }
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
