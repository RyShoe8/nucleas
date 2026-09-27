import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { AiBudget, AiRun, AiSearchApiUsage } from '@/lib/models/AiControl';
import Project from '@/lib/models/Project';
import Client from '@/lib/models/Client';
import User from '@/lib/models/User';
import { freeChatLedgerProjectId } from '@/lib/ide/freeChat';
import { assistantLedgerProjectId } from '@/lib/ai/company/assistantLedger';
import { getOrgAiSpend, isValidPeriod } from './spendReport';

let replica: MongoMemoryReplSet;
const org = String(new Types.ObjectId());
const ryan = new Types.ObjectId();
const sam = new Types.ObjectId();

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_spend_test'));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

function run(fields: { projectId: Types.ObjectId; user: Types.ObjectId; costMicros?: number; model?: string; createdAt: string; organizationId?: string; status?: string }) {
  return AiRun.collection.insertOne({
    organizationId: fields.organizationId ?? org,
    projectId: fields.projectId,
    role: 'architect',
    status: fields.status ?? 'completed',
    revision: 1,
    inputDigest: 'x',
    policyDigest: 'y',
    createdByUserId: fields.user,
    model: fields.model ?? 'gpt-5',
    inputTokens: 100,
    outputTokens: 50,
    ...(fields.costMicros === undefined ? {} : { costMicros: fields.costMicros }),
    createdAt: new Date(fields.createdAt),
    updatedAt: new Date(fields.createdAt),
  });
}

beforeEach(async () => {
  await Promise.all([AiRun.deleteMany({}), AiBudget.deleteMany({}), AiSearchApiUsage.deleteMany({}), Project.deleteMany({}), Client.deleteMany({}), User.collection.deleteMany({})]);
  await User.collection.insertMany([
    { _id: ryan, name: 'Ryan', email: 'ryan@example.com' },
    { _id: sam, name: 'Sam', email: 'sam@example.com' },
  ]);
});

describe('organization AI spend', () => {
  it('totals the month, labels sources, splits by model and person, and excludes other months and orgs', async () => {
    const client = await Client.create({ organizationId: new Types.ObjectId(), name: 'Tailnote', color: '#111' });
    const project = await Project.create({ name: 'Tailnote', projectType: 'internal', category: 'website', status: 'launched', color: '#111', userId: ryan, clientId: client._id });
    const assistant = assistantLedgerProjectId(org);
    const freeChat = freeChatLedgerProjectId(org);

    await run({ projectId: assistant, user: ryan, costMicros: 2_000_000, model: 'claude-sonnet', createdAt: '2026-09-03T10:00:00Z' });
    await run({ projectId: assistant, user: ryan, costMicros: 1_000_000, model: 'claude-sonnet', createdAt: '2026-09-03T12:00:00Z' });
    await run({ projectId: freeChat, user: sam, costMicros: 500_000, model: 'gpt-5', createdAt: '2026-09-10T09:00:00Z' });
    await run({ projectId: project._id as Types.ObjectId, user: sam, costMicros: 250_000, model: 'gpt-5', createdAt: '2026-09-11T09:00:00Z' });
    await run({ projectId: project._id as Types.ObjectId, user: sam, model: 'gpt-5', createdAt: '2026-09-12T09:00:00Z' });
    await run({ projectId: assistant, user: ryan, costMicros: 9_000_000, createdAt: '2026-08-31T23:59:00Z' });
    await run({ projectId: assistant, user: ryan, costMicros: 9_000_000, createdAt: '2026-09-05T00:00:00Z', organizationId: 'someone-else' });

    await AiBudget.create({ organizationId: org, scopeKey: 'organization', period: '2026-09', limitMicros: 50_000_000, spentMicros: 3_750_000, reservedMicros: 200_000 });
    await AiSearchApiUsage.create({ organizationId: org, periodMonth: '2026-09', braveQueries: 10, googleCseWebQueries: 5, googleCseImageQueries: 0 });

    const spend = await getOrgAiSpend(org, '2026-09', new Date('2026-09-28T12:00:00Z'));
    expect(spend.totals).toEqual({ costMicros: 3_750_000, runs: 5, unknownCostRuns: 1, inputTokens: 500, outputTokens: 250 });
    expect(spend.budget).toEqual({ limitMicros: 50_000_000, spentMicros: 3_750_000, reservedMicros: 200_000 });
    expect(spend.byDay).toEqual([
      { date: '2026-09-03', costMicros: 3_000_000, runs: 2 },
      { date: '2026-09-10', costMicros: 500_000, runs: 1 },
      { date: '2026-09-11', costMicros: 250_000, runs: 1 },
      { date: '2026-09-12', costMicros: 0, runs: 1 },
    ]);
    expect(spend.bySource.map((s) => [s.label, s.costMicros, s.runs])).toEqual([
      ['Ask Nucleas', 3_000_000, 2],
      ['Free Chat', 500_000, 1],
      ['Tailnote', 250_000, 2],
    ]);
    expect(spend.byModel.map((m) => [m.label, m.costMicros])).toEqual([
      ['claude-sonnet', 3_000_000],
      ['gpt-5', 750_000],
    ]);
    expect(spend.byUser.map((u) => [u.label, u.costMicros])).toEqual([
      ['Ryan', 3_000_000],
      ['Sam', 750_000],
    ]);
    expect(spend.search.braveQueries + spend.search.googleQueries).toBe(15);
  });

  it('returns an empty month cleanly and validates periods', async () => {
    const spend = await getOrgAiSpend(org, '2026-07');
    expect(spend.totals.runs).toBe(0);
    expect(spend.budget.limitMicros).toBeNull();
    expect(isValidPeriod('2026-09')).toBe(true);
    expect(isValidPeriod('2026-13')).toBe(false);
    expect(isValidPeriod('26-9')).toBe(false);
  });
});
