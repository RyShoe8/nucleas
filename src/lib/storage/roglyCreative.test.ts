import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Types } from 'mongoose';
const mocks = vi.hoisted(()=>({ row:vi.fn(), profiles:vi.fn(), credential:vi.fn(), legacy:vi.fn(), request:vi.fn() }));
vi.mock('@/lib/companies/companyProfile',()=>({listCompanyProfiles:mocks.profiles}));
vi.mock('@/lib/models/Integration',()=>({IntegrationConnection:{findOne:()=>({select:()=>({lean:mocks.row})})}}));
vi.mock('@/lib/integrations/connections',()=>({readConnectionCredential:mocks.credential}));
vi.mock('@/lib/roundups/sources',()=>({secretFor:mocks.legacy,siteRequest:mocks.request}));
import { creativeKeys, signedCreativeUpload, signedCreativeDownload, readCreativeObject, promoteCreativeSource, openCreativeStorage, type CreativeStorageClient } from './roglyCreative';
const org='a'.repeat(24),company='b'.repeat(24),asset='c'.repeat(24);
const keys=creativeKeys(org,company,asset);
const client:CreativeStorageClient={organizationId:org,request:mocks.request,destroy(){}};
beforeEach(()=>{vi.resetAllMocks();});
afterEach(()=>vi.unstubAllGlobals());
describe('Rogly storage through existing game access',()=>{
  it('reuses the organization-scoped PlayBound connection without accepting new credentials',async()=>{
    mocks.row.mockResolvedValue({_id:new Types.ObjectId(),status:'connected',connectorConfig:{enabled:true},connectorTest:{ok:true,revision:2},revision:2});
    mocks.credential.mockResolvedValue('existing-synthetic-secret');mocks.request.mockResolvedValue({configured:true});
    const connection=await openCreativeStorage(new Types.ObjectId(org));
    await connection!.request('status');
    expect(mocks.request).toHaveBeenCalledWith('https://playbound.club/api/integrations/nucleas/creative-storage','existing-synthetic-secret','POST',{action:'status',organizationId:org});
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('does not fall back past a disabled connection or share legacy access with another organization',async()=>{
    mocks.row.mockResolvedValue({status:'disabled'});
    expect(await openCreativeStorage(new Types.ObjectId(org))).toBeNull();
    mocks.row.mockResolvedValue(null);mocks.profiles.mockResolvedValue([]);
    expect(await openCreativeStorage(new Types.ObjectId(org))).toBeNull();
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('reuses legacy access only for the organization which owns PlayBound',async()=>{
    mocks.row.mockResolvedValue(null);mocks.profiles.mockResolvedValue([{id:company,domain:'playbound.club',relationship:'owned'}]);mocks.legacy.mockReturnValue('synthetic-existing-legacy-secret');
    expect(await openCreativeStorage(new Types.ObjectId(org))).not.toBeNull();
    expect(mocks.legacy).toHaveBeenCalledWith(company,'https://playbound.club/api/integrations/nucleas/roundup');
  });
  it('restricts transfers to the creative prefix and exact signed destination',async()=>{
    mocks.request.mockResolvedValue({url:`https://s3.rogly.net/playbound/${keys.staging}?signature=test`});
    expect(await signedCreativeUpload(client,keys.staging,1024)).toContain('/playbound/nucleas/creative/staging/');
    await expect(signedCreativeUpload(client,keys.source,1024)).rejects.toThrow();
    await expect(signedCreativeDownload(client,'games/game.zip')).rejects.toThrow();
    await expect(signedCreativeDownload({...client,organizationId:'d'.repeat(24)},keys.source)).rejects.toThrow();
    mocks.request.mockResolvedValue({url:'https://wrong.example/file'});
    await expect(signedCreativeDownload(client,keys.source)).rejects.toThrow(/destination/);
  });
  it('rejects truncated or oversized streams and hashes the accepted bytes',async()=>{
    mocks.request.mockResolvedValue({url:`https://s3.rogly.net/playbound/${keys.staging}?signature=test`});
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
    fetchMock.mockResolvedValueOnce(new Response('four'));
    await expect(readCreativeObject(client,keys.staging,8)).rejects.toThrow(/incomplete/);
    fetchMock.mockResolvedValueOnce(new Response('too many bytes'));
    await expect(readCreativeObject(client,keys.staging,8)).rejects.toThrow(/declared size/);
    fetchMock.mockResolvedValueOnce(new Response('source',{headers:{etag:'etag'}}));
    const result=await readCreativeObject(client,keys.staging,6);
    expect(result.bytes.toString()).toBe('source');expect(result.sha256).toHaveLength(64);
  });
  it('promotes only the verified object in the matching company and version',async()=>{
    await promoteCreativeSource(client,keys.staging,keys.source,'verified-etag');
    expect(mocks.request).toHaveBeenCalledWith('promote',{companyId:company,assetId:asset,staging:false,etag:'verified-etag'});
    await expect(promoteCreativeSource(client,keys.staging,creativeKeys(org,'d'.repeat(24),asset).source,'etag')).rejects.toThrow();
  });
});
