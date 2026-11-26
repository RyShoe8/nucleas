import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
vi.mock('server-only', () => ({}));
const chat = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/companyChat', () => ({ attemptCompanyCredentialChat: (...args: unknown[]) => chat(...args) }));
vi.mock('@/lib/ai/company/assistantLedger', () => ({ assistantLedgerProjectId: () => new Types.ObjectId() }));
import { ContentEvaluation, contentModelScores, gradeContentEvaluation, runContentEvaluation } from './contentEvaluations';
import { CONTENT_CASES, CONTENT_SUITE_VERSION } from '@/lib/ai/eval/contentCases';
import { CompanyTeamBoard, addToBoard, readBoard, reviseBoardEvidence, teamBoardContext } from '@/lib/companies/teamBoard';

let db: MongoMemoryReplSet;
let org: string, company: string, user: string, profile: string;
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(db.getUri('content_quality_memory_test'));
  await ContentEvaluation.syncIndexes(); await CompanyTeamBoard.syncIndexes();
}, 120_000);
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  org = String(new Types.ObjectId()); company = String(new Types.ObjectId()); user = String(new Types.ObjectId()); profile = String(new Types.ObjectId());
  chat.mockReset().mockResolvedValue({ role: 'assistant', text: 'A grounded response.', model: 'test-model', costMicros: 100 });
  await Promise.all([ContentEvaluation.deleteMany({}), CompanyTeamBoard.deleteMany({})]);
});
const grades = () => CONTENT_CASES.map(c => ({ caseId: c.id, factuality: 4, coverage: 4, voice: 3, originality: 3, criticalError: false, notes: 'Verified against the source packet.' }));
const create = (status = 'running') => ContentEvaluation.create({ organizationId: org, profileId: profile, model: 'test-model', need: 'write', suite: CONTENT_SUITE_VERSION, status, createdBy: user, results: CONTENT_CASES.map(c => ({ caseId: c.id, text: 'Draft', model: 'test-model' })) });

describe('reviewed content evaluations', () => {
  it('does not affect routing before a complete human review, and isolates organizations', async () => {
    const run = await create('awaiting_review');
    expect((await contentModelScores(org)).size).toBe(0);
    expect(await gradeContentEvaluation(String(new Types.ObjectId()), String(run._id), user, grades())).toBe(false);
    expect(await gradeContentEvaluation(org, String(run._id), user, grades().slice(1))).toBe(false);
    expect(await gradeContentEvaluation(org, String(run._id), user, grades())).toBe(true);
    const scores = await contentModelScores(org);
    expect(scores.get(`${profile}:test-model`)?.[0]).toMatchObject({ need: 'write', cases: 3 });
    expect(scores.get(`${profile}:test-model`)?.[0].score).toBeGreaterThan(0.7);
    expect((await contentModelScores(String(new Types.ObjectId()))).size).toBe(0);
    expect(await gradeContentEvaluation(org, String(run._id), user, grades())).toBe(false);
  });
  it('caps a critical factual failure, excludes expired reviews and rejects invalid scores', async () => {
    const run = await create('awaiting_review');
    const invalid = grades(); invalid[0].factuality = 50;
    expect(await gradeContentEvaluation(org, String(run._id), user, invalid)).toBe(false);
    const critical = grades(); critical[0].criticalError = true;
    expect(await gradeContentEvaluation(org, String(run._id), user, critical)).toBe(true);
    expect((await ContentEvaluation.findById(run._id).lean())?.score).toBeLessThanOrEqual(0.4);
    await ContentEvaluation.updateOne({ _id: run._id }, { $set: { reviewedAt: new Date('2020-01-01') } });
    expect((await contentModelScores(org)).size).toBe(0);
  });
  it('runs bounded cases without tools or stand-ins and records the complete cost', async () => {
    const run = await create();
    await runContentEvaluation(String(run._id), user);
    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls[0][0]).toMatchObject({ toolProfile: 'none', forcePlain: true, standIn: false, disableLookupAssist: true });
    expect(await ContentEvaluation.findById(run._id).lean()).toMatchObject({ status: 'awaiting_review', costMicros: 300, costUnknown: false });
    expect((await contentModelScores(org)).size).toBe(0);
  });
  it('keeps partial results and unknown cost visible after a provider failure', async () => {
    const run = await create();
    chat.mockResolvedValueOnce({ role: 'assistant', text: 'First case.', model: 'test-model', costMicros: 100 });
    chat.mockResolvedValueOnce({ role: 'status', text: 'Provider unavailable.', costMicros: null });
    await runContentEvaluation(String(run._id), user);
    const saved = await ContentEvaluation.findById(run._id).lean();
    expect(saved).toMatchObject({ status: 'failed', costMicros: 100, costUnknown: true });
    expect(saved?.results).toHaveLength(1);
    expect((await contentModelScores(org)).size).toBe(0);
  });
});

describe('correctable company evidence', () => {
  it('keeps revisions, removes withdrawn claims from context, and rejects cross-company changes', async () => {
    await addToBoard(org, company, { member: 'marketing', evidence: [{ fact: 'The advertised fee is $5.', url: 'https://example.com/terms', status: 'supported', quote: 'The advertised fee is $5.', checkedAt: new Date().toISOString() }] });
    const initial = await readBoard(org, company);
    const edit = { id: initial.evidence[0].id!, fact: 'The advertised fee is $4.', url: 'https://example.com/terms', reason: 'The current terms show a lower fee.', withdraw: false };
    expect(await reviseBoardEvidence(String(new Types.ObjectId()), company, user, edit)).toBe(false);
    expect(await reviseBoardEvidence(org, String(new Types.ObjectId()), user, edit)).toBe(false);
    expect(await reviseBoardEvidence(org, company, user, edit)).toBe(true);
    const revised = await readBoard(org, company);
    expect(revised.evidence).toHaveLength(1);
    expect(revised.evidence[0]).toMatchObject({ fact: edit.fact, status: 'unverified', quote: '', correctedBy: user });
    expect(revised.history?.[0].fact).toBe('The advertised fee is $5.');
    expect(await reviseBoardEvidence(org, company, user, edit)).toBe(false);
    expect(await reviseBoardEvidence(org, company, user, { ...edit, id: revised.evidence[0].id!, withdraw: true })).toBe(true);
    expect((await readBoard(org, company)).evidence).toEqual([]);
    expect(await teamBoardContext(org, company)).toBe('');
    expect((await readBoard(org, company)).history).toHaveLength(3);
  });
});
