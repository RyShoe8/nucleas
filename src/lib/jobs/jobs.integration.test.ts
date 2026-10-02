import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ design: vi.fn(), chat: vi.fn(), browser: vi.fn() }));
vi.mock('./designer', () => ({ designJob: (...args: unknown[]) => mocks.design(...args) }));
vi.mock('@/lib/ai/companyChat', () => ({ attemptCompanyCredentialChat: (input: unknown) => mocks.chat(input) }));
vi.mock('@/lib/ai/engine/catalog', () => ({ listAvailableModels: async () => [] }));
vi.mock('@/lib/ai/engine/select', () => ({
  readEngineSettings: async () => ({ defaultCostLevel: 'low', priceCeilings: { low: 1.5, medium: 5, high: null }, pins: {} }),
  selectModel: async (_org: string, need: string) => ({
    primary: need === 'review' ? { profileId: 'r'.repeat(24), model: 'gpt-6-sol', free: false, label: 'OpenAI' } : { profileId: 'w'.repeat(24), model: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', free: true, label: 'Rogly' },
    fallback: null,
  }),
  isCostLevel: (v: unknown) => v === 'low' || v === 'medium' || v === 'high',
}));
vi.mock('@/lib/building/companyCode', () => ({ resolveCompanyRepository: async () => null }));
vi.mock('@/lib/ai/tools/browserClient', () => ({ browserNavigate: (...args: unknown[]) => mocks.browser(...args) }));

import Client from '@/lib/models/Client';
import User from '@/lib/models/User';
import Employee from '@/lib/models/Employee';
import { Job, JobRun } from '@/lib/models/Job';
import { LinkOpportunity } from '@/lib/models/LinkOpportunity';
import Project from '@/lib/models/Project';
import { SeoBrief } from '@/lib/models/SeoBrief';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { answerQuestions, approveJob, claimDueJobRuns, createJob, createTemplateJob, decideRun, executeJobRun, getJob, runDesign, runNow, sweepJobs } from './jobs';
import type { JobDesign } from './schema';
import { updateLinkOpportunity, verifyLinkOpportunity } from './linkOpportunities';

let replica: MongoMemoryReplSet;
const org = new Types.ObjectId();
let admin: CompanyViewer;
let member: CompanyViewer;
let companyId: string;
let projectId: string;

const DESIGN: JobDesign = {
  title: 'Add Deadlock to the catalog',
  category: 'data',
  instructions: 'Research the game Deadlock and collect its catalog details from primary sources.',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, description: '' },
    { key: 'release_date', label: 'Release date', type: 'date', required: true, description: '' },
    { key: 'website', label: 'Website', type: 'url', required: false, description: '' },
  ],
  sourcePolicy: 'Official sites and major outlets.',
  delivery: { method: 'nucleas', detail: 'Kept in Nucleas as a table.', setupSteps: [] },
  schedule: { kind: 'once' },
  recordsPerRun: 1,
  safeguards: [],
  recommendedCompletion: 'review',
  findings: ['The catalog lives in the PlayBound database with no write API.'],
  questions: [],
};

const QUESTION = {
  id: 'destination',
  question: 'How should new games reach the catalog?',
  why: 'Nothing outside the app can write to it.',
  options: [
    { id: 'intake', label: 'Signed intake endpoint (pull request)', detail: '' },
    { id: 'manual', label: 'A checklist I apply', detail: '' },
  ],
  recommended: 'intake',
};

const GOOD = JSON.stringify({ records: [{ values: { name: 'Deadlock', release_date: '2026-03-01', website: 'https://deadlock.example' }, sources: ['https://store.example/deadlock'] }], summary: 'Found it.', gaps: [] });

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_jobs_test'));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([Client.deleteMany({}), User.deleteMany({}), Employee.collection.deleteMany({}), Project.deleteMany({}), SeoBrief.deleteMany({}), Job.deleteMany({}), JobRun.deleteMany({}), LinkOpportunity.deleteMany({})]);
  const user = await User.create({ email: 'owner@example.invalid', password: 'synthetic-pass', organizationId: String(org) });
  // Runs act as the job's creator, resolved from their employee record.
  await Employee.collection.insertOne({ userId: user._id, organizationId: String(org), role: 'Administrator', name: 'Owner', email: 'owner@example.invalid' });
  admin = { userId: String(user._id), organizationId: org, employeeId: null, role: 'Administrator' };
  member = { ...admin, role: 'User' };
  const company = await Client.create({ organizationId: org, name: 'Playbound.club', color: '#222', relationship: 'owned', domain: 'playbound.club' });
  companyId = String(company._id);
  const project = await Project.create({ userId: user._id, name: 'PlayBound', description: 'Game discovery', projectType: 'internal', category: 'website', color: '#222', status: 'launched', clientId: company._id });
  projectId = String(project._id);
  await SeoBrief.create({ organizationId: org, companyId: company._id, projectId: project._id, status: 'approved', projectName: 'PlayBound', summary: 'A game discovery site.', audience: 'Players looking for games and servers.', goals: ['Grow game discovery traffic'], primaryTopics: ['video games'], excludedTopics: ['schools'], geographicTargets: ['United States'], positioning: 'Useful game discovery.', priorityPages: [{ url: 'https://playbound.club/games', purpose: 'Discover games', keywords: ['games'] }], revision: 1, updatedByUserId: user._id, approvedByUserId: user._id, approvedAt: new Date() });
  mocks.chat.mockImplementation(async (input: { systemPrompt: string }) =>
    input.systemPrompt.startsWith('You check one run')
      ? { requestId: 'r', role: 'assistant', text: '{"verdict":"pass","notes":"Consistent and sourced."}', costMicros: 400 }
      : { requestId: 'w', role: 'assistant', text: GOOD, costMicros: 0 }
  );
  mocks.browser.mockResolvedValue({ url: 'https://directory.example.org/listing/playbound', title: 'PlayBound', text: 'Listing', note: 'Rendered', images: [], links: ['https://playbound.club/games'] });
});

async function proposed(design: JobDesign = DESIGN) {
  mocks.design.mockResolvedValue({ ok: true, design, costMicros: 1000, model: 'gpt-6-sol' });
  const created = await createJob(admin, { companyId, request: 'Research Deadlock and add it to the PlayBound catalog' });
  if (!created.ok) throw new Error(created.error);
  return created.job;
}

describe('designing', () => {
  it('configures at most one open link-building skill per property', async () => {
    const config = { projectId, schedule: { kind: 'daily', time: '09:00', timezone: 'America/Chicago' }, recordsPerRun: 1, country: 'United States', language: 'English', exclusions: '' };
    const first = await createTemplateJob(admin, { companyId, template: 'link_building', config });
    const duplicate = await createTemplateJob(admin, { companyId, template: 'link_building', config });

    expect(first).toMatchObject({ ok: true, job: { status: 'proposed', design: { skill: 'link_building' } } });
    expect(duplicate).toMatchObject({ ok: false, status: 409 });
  });

  it('persists Free Orchestrated jobs', async () => {
    mocks.design.mockResolvedValue({ ok: true, design: DESIGN, costMicros: 0, model: 'Rogly/model' });
    const created = await createJob(admin, { companyId, request: 'Research Deadlock and update the catalog', level: 'free' });

    expect(created).toMatchObject({ ok: true, job: { status: 'proposed', level: 'free' } });
    expect(await Job.findById(created.ok ? created.job.id : null).lean()).toMatchObject({ level: 'free' });
  });

  it('asks its questions, then finishes the design with the answers', async () => {
    mocks.design.mockResolvedValueOnce({ ok: true, design: { ...DESIGN, questions: [QUESTION] }, costMicros: 1000, model: 'm' });
    const created = await createJob(admin, { companyId, request: 'Research Deadlock and add it to the PlayBound catalog' });
    if (!created.ok) throw new Error(created.error);
    expect(created.job).toMatchObject({ status: 'needs_answers', design: { questions: [{ id: 'destination' }] } });

    expect(await answerQuestions(admin, created.job.id, { destination: { option: 'manual', text: 'I will paste them in' } })).toMatchObject({ ok: true, job: { status: 'designing' } });
    mocks.design.mockResolvedValueOnce({ ok: true, design: { ...DESIGN, delivery: { method: 'handoff', detail: 'Checklist', setupSteps: [] } }, costMicros: 800, model: 'm' });
    await runDesign(admin, created.job.id);
    expect(mocks.design.mock.calls[1][1]).toMatchObject({ answers: { destination: { option: 'manual', text: 'I will paste them in' } }, previous: { questions: [{ id: 'destination' }] } });
    expect(await getJob(admin, created.job.id)).toMatchObject({ status: 'proposed', deliveryLabel: 'Handed to a person to apply' });
  });

  it('records a failed design instead of leaving it hanging', async () => {
    mocks.design.mockResolvedValue({ ok: false, error: 'No model is available for designing jobs.', costMicros: 0 });
    const created = await createJob(admin, { companyId, request: 'Research Deadlock and add it to the catalog' });
    expect(created.ok && created.job).toMatchObject({ status: 'failed', error: 'No model is available for designing jobs.' });
  });
});

describe('approving and the dry run', () => {
  it('tracks link recommendations through approval and submission with feedback history', async () => {
    const config = { projectId, schedule: { kind: 'daily', time: '09:00', timezone: 'America/Chicago' }, recordsPerRun: 1, country: 'United States', language: 'English', exclusions: '' };
    const created = await createTemplateJob(admin, { companyId, template: 'link_building', config });
    if (!created.ok) throw new Error(created.error);
    mocks.chat.mockImplementation(async (input: { systemPrompt: string }) => input.systemPrompt.startsWith('You check one run')
      ? { requestId: 'r', role: 'assistant', text: '{"verdict":"pass","notes":"Sourced."}', costMicros: 0 }
      : { requestId: 'w', role: 'assistant', text: JSON.stringify({ records: [{ values: { strategic_reason: 'A new page needs authority.', strategy_evidence: 'The games page is a newly launched priority page in the approved brief and currently has no directory citations.', opportunity_url: 'https://directory.example.org/submit', opportunity_type: 'Directory', relevance_score: 90, relevance_evidence: 'The directory exclusively catalogs video games and is used by players searching for games and community servers.', estimated_authority: 'Medium estimate', authority_basis: 'Indexed and used by peers.', target_keywords: ['games'], target_url: 'https://playbound.club/games', anchor_text: 'PlayBound games', submission_copy: 'A useful directory description.', requirements: 'Free account.', link_attribute: 'unknown', quality_risk: 'Relevant and moderated.', confidence: 'Medium', next_action: 'Submit the listing.' }, sources: ['https://directory.example.org/submit'] }], summary: 'Found one.', gaps: [] }), costMicros: 0 });

    const approved = await approveJob(admin, created.job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    let view = await getJob(admin, created.job.id);
    expect(view?.opportunities).toHaveLength(1);
    expect(view?.opportunities[0]).toMatchObject({ status: 'recommended', opportunityUrl: 'https://directory.example.org/submit' });

    await decideRun(admin, created.job.id, approved.dryRunId!, 'accept', 'Good fit');
    view = await getJob(admin, created.job.id);
    expect(view?.opportunities[0].status).toBe('approved');
    const moved = await updateLinkOpportunity(admin, created.job.id, view!.opportunities[0].id, { status: 'submitted', liveLinkUrl: 'https://directory.example.org/listing/playbound' });
    expect(moved).toEqual({ ok: true });
    expect(await LinkOpportunity.findById(view!.opportunities[0].id).lean()).toMatchObject({ status: 'submitted', note: 'Good fit', liveLinkUrl: 'https://directory.example.org/listing/playbound' });
    expect(await verifyLinkOpportunity(view!.opportunities[0].id)).toBe('found');
    expect(await LinkOpportunity.findById(view!.opportunities[0].id).lean()).toMatchObject({ status: 'live', verificationMessage: expect.stringContaining('found') });
  });

  it('only managers approve; approval fixes completion and budget and starts one dry run', async () => {
    const job = await proposed();
    expect(await approveJob(member, job.id, { completion: 'review' })).toMatchObject({ ok: false, status: 403 });
    const [a, b] = await Promise.all([approveJob(admin, job.id, { completion: 'review', monthlyBudgetMicros: 3_000_000 }), approveJob(admin, job.id, { completion: 'review', monthlyBudgetMicros: 3_000_000 })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await JobRun.countDocuments({ dryRun: true })).toBe(1);
    expect(await getJob(admin, job.id)).toMatchObject({ status: 'testing', completion: 'review', monthlyBudgetMicros: 3_000_000 });
  });

  it('a clean dry run waits for review; accepting it finishes a one-off job kept in Nucleas', async () => {
    const job = await proposed();
    const approved = await approveJob(admin, job.id, { completion: 'automatic' });
    await executeJobRun(approved.dryRunId!);
    let view = await getJob(admin, job.id);
    expect(view?.runs[0]).toMatchObject({ dryRun: true, status: 'needs_review', issues: [], review: { verdict: 'pass' }, costMicros: 400 });
    expect(view?.runs[0].output?.records[0].values.name).toBe('Deadlock');
    expect(mocks.chat.mock.calls[0][0]).toMatchObject({ toolProfile: 'full', forceToolLoop: true, model: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ' });

    const decided = await decideRun(admin, job.id, approved.dryRunId!, 'accept');
    view = decided.ok ? decided.job : null;
    expect(view).toMatchObject({ status: 'done' });
    expect(view?.runs[0].status).toBe('completed');
  });

  it('rejecting the sample sends the job back to its design', async () => {
    const job = await proposed();
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    const decided = await decideRun(admin, job.id, approved.dryRunId!, 'reject', 'Wrong game');
    expect(decided.ok && decided.job.status).toBe('proposed');
  });
});

describe('real runs', () => {
  it('claims a due recurring job once and advances its next run', async () => {
    const id = await ready({ ...DESIGN, schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' } });
    await Job.updateOne({ _id: id }, { $set: { nextRunAt: new Date('2026-09-30T09:00:00Z') } });

    const first = await claimDueJobRuns(new Date('2026-09-30T10:00:00Z'));
    const second = await claimDueJobRuns(new Date('2026-09-30T10:00:00Z'));

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(await Job.findById(id).lean()).toMatchObject({ status: 'active', nextRunAt: new Date('2026-10-01T09:00:00Z') });
  });

  async function ready(design: JobDesign) {
    const job = await proposed(design);
    const approved = await approveJob(admin, job.id, { completion: 'automatic' });
    await executeJobRun(approved.dryRunId!);
    await decideRun(admin, job.id, approved.dryRunId!, 'accept');
    return job.id;
  }

  it('automatic runs complete only when every check passes; otherwise they wait for review', async () => {
    const id = await ready({ ...DESIGN, schedule: { kind: 'daily', time: '09:00' } });
    expect((await getJob(admin, id))?.status).toBe('ready');

    const clean = await runNow(admin, id);
    await executeJobRun(clean.runId!);
    expect((await getJob(admin, id))?.runs[0].status).toBe('completed');

    // A record without a source and with a bad date fails the checks: it waits for a person.
    mocks.chat.mockImplementation(async (input: { systemPrompt: string }) =>
      input.systemPrompt.startsWith('You check one run')
        ? { requestId: 'r', role: 'assistant', text: '{"verdict":"pass","notes":"ok"}', costMicros: 0 }
        : { requestId: 'w', role: 'assistant', text: JSON.stringify({ records: [{ values: { name: 'Deadlock', release_date: 'soon' }, sources: [] }], summary: '', gaps: [] }), costMicros: 0 }
    );
    const dirty = await runNow(admin, id);
    await executeJobRun(dirty.runId!);
    const run = (await getJob(admin, id))?.runs[0];
    expect(run?.status).toBe('needs_review');
    expect(run?.issues.map((i) => i.problem)).toEqual(['Release date is not a valid date.', 'No source link for this record.']);
  });

  it('earlier results are shown to later runs so repeating jobs do not redo work', async () => {
    const id = await ready({ ...DESIGN, schedule: { kind: 'daily' } });
    const run = await runNow(admin, id);
    await executeJobRun(run.runId!);
    const second = await runNow(admin, id);
    await executeJobRun(second.runId!);
    const lastWorkCall = mocks.chat.mock.calls.filter((c) => !(c[0] as { systemPrompt: string }).systemPrompt.startsWith('You check one run')).at(-1)![0] as { userText: string };
    expect(lastWorkCall.userText).toContain('Already done (do not repeat)');
    expect(lastWorkCall.userText).toContain('Deadlock');
  });

  it('refuses to run a delivery method that still needs its setup, and stops at the monthly budget', async () => {
    const needsSetup = await ready({ ...DESIGN, schedule: { kind: 'daily' }, delivery: { method: 'intake_endpoint', detail: 'Signed endpoint', setupSteps: ['Merge the pull request adding /api/nucleas/intake'] } });
    expect(await runNow(admin, needsSetup)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('Merge the pull request') });

    const id = await ready({ ...DESIGN, schedule: { kind: 'daily' } });
    await Job.updateOne({ _id: id }, { $set: { monthlyBudgetMicros: 100 } });
    const run = await runNow(admin, id);
    await executeJobRun(run.runId!);
    expect((await getJob(admin, id))?.runs[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('monthly budget') });
  });

  it('the sweep fails runs and designs stuck for too long', async () => {
    await Job.collection.insertOne({ organizationId: org, companyId: new Types.ObjectId(companyId), createdByUserId: new Types.ObjectId(admin.userId), status: 'designing', request: 'x'.repeat(20), updatedAt: new Date(Date.now() - 3600_000), createdAt: new Date() });
    await JobRun.collection.insertOne({ organizationId: org, jobId: new Types.ObjectId(), companyId: new Types.ObjectId(companyId), status: 'running', dryRun: false, startedAt: new Date(Date.now() - 3600_000) });
    expect(await sweepJobs()).toEqual({ runsFailed: 1, designsFailed: 1 });
  });
});
