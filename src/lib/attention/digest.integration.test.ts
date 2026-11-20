import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import mongoose,{Types} from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server-core';
const mocks=vi.hoisted(()=>({attention:vi.fn(),viewer:vi.fn()}));
vi.mock('./service',()=>({attentionFor:mocks.attention}));
vi.mock('@/lib/companies/companyProfile',()=>({loadCompanyViewer:mocks.viewer}));
vi.mock('@/lib/services/email',()=>({sendEmail:vi.fn()}));
import {sendDueAttentionDigests,digestContent} from './digest';
import {AttentionPreference} from '@/lib/models/AttentionPreference';
import User from '@/lib/models/User';
import type {AttentionItem} from './types';
let db:MongoMemoryServer;
const org=new Types.ObjectId(),user=new Types.ObjectId(),now=new Date('2026-11-19T18:00:00Z');
const item:AttentionItem={id:'run:1',companyId:String(org),companyName:'Example & Co',employeeName:'Growth editor',title:'Review <draft>',detail:'Approve & publish',since:now.toISOString(),moduleId:'team',payload:{jobId:'1'},href:'https://nucleas.app/os/desktop?module=team&payload=%7B%7D'};
const due=()=>AttentionPreference.create({organizationId:org,userId:user,intervalMinutes:30,nextDigestAt:new Date(now.getTime()-1)});
beforeAll(async()=>{db=await MongoMemoryServer.create();await mongoose.connect(db.getUri('digest_test'));await AttentionPreference.init();});
afterAll(async()=>{await mongoose.disconnect();await db.stop();});
beforeEach(async()=>{await AttentionPreference.deleteMany({});await User.deleteMany({});vi.clearAllMocks();
 await User.collection.insertOne({_id:user,email:'reviewer@example.test'});
 mocks.viewer.mockResolvedValue({userId:String(user),organizationId:org});mocks.attention.mockResolvedValue([item]);
});
it('claims a due recipient only once across concurrent cron calls, with complete linked content',async()=>{
 await due();const send=vi.fn(async(_message:unknown)=>{await new Promise(resolve=>setTimeout(resolve,30));});
 await Promise.all([sendDueAttentionDigests(now,send),sendDueAttentionDigests(now,send)]);
 expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0]).toMatchObject({to:'reviewer@example.test'});
 const saved=await AttentionPreference.findOne().lean();expect(saved?.lastDigestAt).toEqual(now);expect(saved?.nextDigestAt).toEqual(new Date(now.getTime()+30*60000));expect(saved?.leaseToken).toBeUndefined();
 expect(digestContent([item]).html).toContain('Review &lt;draft&gt;');expect(digestContent([item]).text).toContain(item.href);
});
it('sends nothing when resolved, empty, disabled or not due',async()=>{
 const pref=await due();const send=vi.fn();mocks.attention.mockResolvedValue([]);
 expect(await sendDueAttentionDigests(now,send)).toEqual({checked:1,sent:0});expect(send).not.toHaveBeenCalled();
 expect(await sendDueAttentionDigests(now,send)).toEqual({checked:0,sent:0});
 await AttentionPreference.updateOne({_id:pref._id},{$set:{intervalMinutes:0,nextDigestAt:now}});mocks.attention.mockResolvedValue([item]);
 expect((await sendDueAttentionDigests(now,send)).checked).toBe(0);
});
it('retries a failed email without recording a successful delivery',async()=>{
 await due();const error=vi.spyOn(console,'error').mockImplementation(()=>{});
 await sendDueAttentionDigests(now,vi.fn().mockRejectedValue(Error('Unavailable')));
 error.mockRestore();const saved=await AttentionPreference.findOne().lean();expect(saved?.lastDigestAt).toBeUndefined();expect(saved?.leaseToken).toBeUndefined();expect(saved?.nextDigestAt).toEqual(new Date(now.getTime()+600000));
});
it('honors a frequency change made while gathering the summary',async()=>{
 const pref=await due();mocks.attention.mockImplementationOnce(async()=>{await AttentionPreference.updateOne({_id:pref._id},{$set:{intervalMinutes:0,nextDigestAt:null}});return [item];});
 const send=vi.fn();await sendDueAttentionDigests(now,send);expect(send).not.toHaveBeenCalled();expect((await AttentionPreference.findById(pref._id).lean())?.leaseToken).toBeUndefined();
});
it('disables a preference if the user moved to another organization',async()=>{
 await due();mocks.viewer.mockResolvedValue({organizationId:new Types.ObjectId()});const send=vi.fn();await sendDueAttentionDigests(now,send);expect(send).not.toHaveBeenCalled();expect((await AttentionPreference.findOne().lean())?.intervalMinutes).toBe(0);
});
it('keeps the complete outstanding set, including more than a display page',()=>{
 const content=digestContent(Array.from({length:50},(_,i)=>({...item,title:`Review ${i}`})));expect(content.html).toContain('Review 49');expect(content.text.match(/https:\/\/nucleas.app\/os\/desktop/g)).toHaveLength(51);
});
