import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { LinkProspect } from '@/lib/models/LinkProspect';
import { LinkOpportunity } from '@/lib/models/LinkOpportunity';
import { linkProspectContext, priorPlacementProblems, rememberProspectOutcome } from './linkProspects';
import seeds from './directoryLeads.json';
let replica: MongoMemoryReplSet;
const scope = { organizationId: new Types.ObjectId(), companyId: new Types.ObjectId() };
beforeAll(async () => { replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(replica.getUri()); await LinkProspect.init(); }, 120000);
afterAll(async () => { await mongoose.disconnect(); await replica?.stop(); });
beforeEach(async () => { await Promise.all([LinkProspect.deleteMany({}), LinkOpportunity.deleteMany({})]); });
it('imports source provenance and advances past checked leads instead of starting over', async () => {
  const visited: string[] = [];
  const read = async (url: string) => { visited.push(url); return { ok: false as const, status: 403, reason: 'Blocked' }; };
  const job = { ...scope, _id: new Types.ObjectId(), status: 'active', design: { skill: 'link_building' } };
  await linkProspectContext(job, read);
  const first = [...visited];
  await linkProspectContext(job, read);
  expect(visited).toHaveLength(12);
  expect(visited.slice(6).some(url => first.includes(url))).toBe(false);
  expect(await LinkProspect.countDocuments()).toBe(seeds.length);
  expect(await LinkProspect.exists({ _id: job._id })).toBeNull();
  expect((await LinkProspect.findOne({ ...scope, domain: 'webwiki.com' }).lean())?.sources).toHaveLength(2);
});
it('remembers company-specific ineligibility without excluding another company', async () => {
  const job = { ...scope, _id: new Types.ObjectId(), lastRunAt: new Date(), status: 'active' };
  await rememberProspectOutcome(job, 'https://itch.io/', 'This company cannot use the creator-upload placement.', 'ineligible');
  const records = [{ values: { opportunity_url: 'https://itch.io/games', opportunity_type: 'Directory' } }];
  expect(await priorPlacementProblems(job, records)).toHaveLength(1);
  expect(await priorPlacementProblems({ ...scope, companyId: new Types.ObjectId() }, records)).toEqual([]);
});
it('deduplicates directory placements across jobs while allowing different forum threads', async () => {
  await LinkOpportunity.create({ ...scope, jobId: new Types.ObjectId(), runId: new Types.ObjectId(), fingerprint: 'existing', opportunityUrl: 'https://directory.test/add', status: 'submitted', values: { opportunity_type: 'Directory' } });
  expect(await priorPlacementProblems(scope, [{ values: { opportunity_url: 'https://directory.test/submit', opportunity_type: 'Directory' } }])).toHaveLength(1);
  expect(await priorPlacementProblems(scope, [{ values: { opportunity_url: 'https://forum.test/thread/2', opportunity_type: 'Forum' } }])).toEqual([]);
});
