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
import { PropertyOverview, PropertyPage } from '@/lib/models/PropertyOverview';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { answerQuestions, approveJob, archiveJob, claimDueJobRuns, createJob, createTemplateJob, decideRun, executeJobRun, getJob, pauseJob, runDesign, runNow, sweepJobs } from './jobs';
import type { JobDesign } from './schema';
import { updateLinkOpportunity, verifyLinkOpportunity } from './linkOpportunities';
import { completePropertyOverviewJob, createPropertyOverviewJob, startPropertyOverviewJob, updatePropertyOverviewJob } from '@/lib/propertyOverview/job';
import { processPropertyOverviewQueue } from '@/lib/propertyOverview/crawler';
import { replaceCompanyOverview } from '@/lib/propertyOverview/storage';
import { claimJobRunExecution, heartbeatJobRun, initialRunLease } from './runLifecycle';

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
  await Promise.all([Client.deleteMany({}), User.deleteMany({}), Employee.collection.deleteMany({}), Project.deleteMany({}), SeoBrief.deleteMany({}), Job.deleteMany({}), JobRun.deleteMany({}), LinkOpportunity.deleteMany({}), PropertyOverview.deleteMany({}), PropertyPage.deleteMany({})]);
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
    expect((await getJob(admin, created.job.id))?.runs[0].progressState).toMatchObject({ stage: 'preparing', percent: 5, label: 'Preparing the dry run' });
    await executeJobRun(approved.dryRunId!);
    let view = await getJob(admin, created.job.id);
    expect(view).toMatchObject({ status: 'ready' });
    expect(view?.nextRunAt).not.toBeNull();
    expect(view?.opportunities).toHaveLength(1);
    expect(view?.opportunities[0]).toMatchObject({ status: 'recommended', opportunityUrl: 'https://directory.example.org/submit' });
    expect(view?.runs[0].progressState).toMatchObject({ stage: 'complete', percent: 100, label: 'Ready for review' });

    await decideRun(admin, created.job.id, approved.dryRunId!, 'accept', 'Good fit');
    view = await getJob(admin, created.job.id);
    expect(view?.opportunities[0].status).toBe('approved');
    const moved = await updateLinkOpportunity(admin, created.job.id, view!.opportunities[0].id, { status: 'submitted', liveLinkUrl: 'https://directory.example.org/listing/playbound' });
    expect(moved).toEqual({ ok: true });
    expect(await LinkOpportunity.findById(view!.opportunities[0].id).lean()).toMatchObject({ status: 'submitted', note: 'Good fit', liveLinkUrl: 'https://directory.example.org/listing/playbound' });
    expect(await verifyLinkOpportunity(view!.opportunities[0].id)).toBe('found');
    expect(await LinkOpportunity.findById(view!.opportunities[0].id).lean()).toMatchObject({ status: 'live', verificationMessage: expect.stringContaining('found') });
  });

  it('keeps recurring link building scheduled while earlier recommendations await review', async () => {
    const config = { projectId, schedule: { kind: 'daily' as const, time: '09:00', timezone: 'UTC' }, recordsPerRun: 1, country: 'United States', language: 'English', exclusions: '' };
    const created = await createTemplateJob(admin, { companyId, template: 'link_building', config });
    if (!created.ok) throw new Error(created.error);
    mocks.chat.mockImplementation(async (input: { systemPrompt: string }) => input.systemPrompt.startsWith('You check one run')
      ? { requestId: 'r', role: 'assistant', text: '{"verdict":"pass","notes":"Sourced."}', costMicros: 0 }
      : { requestId: 'w', role: 'assistant', text: JSON.stringify({ records: [{ values: { strategic_reason: 'The priority page needs relevant citations.', strategy_evidence: 'The approved brief identifies the games page as a priority and the named directory has a matching video-game category.', opportunity_url: 'https://directory.example.org/submit', opportunity_type: 'Directory', relevance_score: 90, relevance_evidence: 'The directory exclusively catalogs video games and is used by players searching for games and community servers.', estimated_authority: 'Medium estimate', authority_basis: 'Indexed and used by peers.', target_keywords: ['games'], target_url: 'https://playbound.club/games', anchor_text: 'PlayBound games', submission_copy: 'A useful directory description.', requirements: 'Free account.', link_attribute: 'unknown', quality_risk: 'Relevant and moderated.', confidence: 'Medium', next_action: 'Submit the listing.' }, sources: ['https://directory.example.org/submit'] }], summary: 'Found one.', gaps: [] }), costMicros: 0 });

    const approved = await approveJob(admin, created.job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    const sample = await JobRun.findById(approved.dryRunId).lean();
    expect(sample?.status).toBe('needs_review');
    await Job.updateOne({ _id: created.job.id }, { $set: { nextRunAt: new Date('2026-10-01T09:00:00Z') } });

    const claimed = await claimDueJobRuns(new Date('2026-10-01T10:00:00Z'));
    expect(claimed).toHaveLength(1);
    expect(await JobRun.countDocuments({ jobId: created.job.id })).toBe(2);
    expect(await JobRun.findById(approved.dryRunId).lean()).toMatchObject({ status: 'needs_review' });
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
  it('tracks a VPS Company Overview as a durable background job', async () => {
    const overview = await PropertyOverview.create({ organizationId: org, companyId: new Types.ObjectId(companyId), rootUrl: 'https://playbound.club/', status: 'queued' });
    const linked = await createPropertyOverviewJob({ organizationId: org, companyId: new Types.ObjectId(companyId), userId: admin.userId, companyName: 'Playbound.club', overviewId: overview._id, rootUrl: overview.rootUrl });
    await PropertyOverview.updateOne({ _id: overview._id }, { $set: { jobId: linked.jobId, runId: linked.runId } });
    await startPropertyOverviewJob(linked);

    await updatePropertyOverviewJob({ ...linked, message: 'Archived 25 of 100 discovered pages…', processed: 25, discovered: 100 });
    expect(await JobRun.findById(linked.runId).lean()).toMatchObject({ status: 'running', progressState: { stage: 'researching', percent: 31 } });

    await completePropertyOverviewJob({ ...linked, rootUrl: overview.rootUrl, pageCount: 100, edgeCount: 450, issueCount: 12, templates: 4, orphanPages: 3 });
    expect(await Job.findById(linked.jobId).lean()).toMatchObject({ status: 'done', design: { skill: 'property_overview' } });
    expect(await JobRun.findById(linked.runId).lean()).toMatchObject({ status: 'completed', output: { records: [{ values: { pages_archived: 100, internal_links: 450, seo_findings: 12, templates: 4, orphan_pages: 3 } }] }, progressState: { percent: 100 } });
  });

  it('keeps Company Overview jobs queued while the VPS worker is busy and starts them oldest first', async () => {
    const previousUrl = process.env.NUCLEAS_EXECUTION_WORKER_URL;
    const previousToken = process.env.NUCLEAS_EXECUTION_WORKER_TOKEN;
    process.env.NUCLEAS_EXECUTION_WORKER_URL = 'https://worker.nucleas.app';
    process.env.NUCLEAS_EXECUTION_WORKER_TOKEN = 'x'.repeat(64);
    try {
      const firstOverview = await PropertyOverview.create({ organizationId: org, companyId: new Types.ObjectId(companyId), rootUrl: 'https://playbound.club/', status: 'queued', progress: 'Queued', createdAt: new Date('2026-10-01T10:00:00Z') });
      const firstJob = await createPropertyOverviewJob({ organizationId: org, companyId: new Types.ObjectId(companyId), userId: admin.userId, companyName: 'Playbound.club', overviewId: firstOverview._id, rootUrl: firstOverview.rootUrl });
      await PropertyOverview.updateOne({ _id: firstOverview._id }, { $set: { jobId: firstJob.jobId, runId: firstJob.runId } });
      const secondOverview = await PropertyOverview.create({ organizationId: org, companyId: new Types.ObjectId(companyId), rootUrl: 'https://frugalgambler.club/', status: 'queued', progress: 'Queued', createdAt: new Date('2026-10-01T10:01:00Z') });
      const secondJob = await createPropertyOverviewJob({ organizationId: org, companyId: new Types.ObjectId(companyId), userId: admin.userId, companyName: 'Frugal Gambler', overviewId: secondOverview._id, rootUrl: secondOverview.rootUrl });
      await PropertyOverview.updateOne({ _id: secondOverview._id }, { $set: { jobId: secondJob.jobId, runId: secondJob.runId } });

      const busyFetch = vi.fn(async () => new Response(JSON.stringify({ error: 'A property crawl is already running.' }), { status: 429 }));
      expect(await processPropertyOverviewQueue({ fetchImpl: busyFetch })).toBe('busy');
      expect(await PropertyOverview.findById(firstOverview._id).lean()).toMatchObject({ status: 'queued', progress: expect.stringContaining('waiting') });
      expect(await PropertyOverview.findById(secondOverview._id).lean()).toMatchObject({ status: 'queued' });
      expect(await JobRun.findById(firstJob.runId).lean()).toMatchObject({ status: 'running', leaseOwner: 'queue:property-overview' });

      const acceptedFetch = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }));
      expect(await processPropertyOverviewQueue({ fetchImpl: acceptedFetch })).toBe('started');
      expect(await PropertyOverview.findById(firstOverview._id).lean()).toMatchObject({ status: 'crawling' });
      expect(await PropertyOverview.findById(secondOverview._id).lean()).toMatchObject({ status: 'queued' });
      expect(await JobRun.findById(firstJob.runId).lean()).toMatchObject({ status: 'running', leaseOwner: 'vps:property-overview' });
    } finally {
      if (previousUrl === undefined) delete process.env.NUCLEAS_EXECUTION_WORKER_URL;
      else process.env.NUCLEAS_EXECUTION_WORKER_URL = previousUrl;
      if (previousToken === undefined) delete process.env.NUCLEAS_EXECUTION_WORKER_TOKEN;
      else process.env.NUCLEAS_EXECUTION_WORKER_TOKEN = previousToken;
    }
  });

  it('claims a due recurring job once and advances its next run', async () => {
    const id = await ready({ ...DESIGN, schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' } });
    await Job.updateOne({ _id: id }, { $set: { nextRunAt: new Date('2026-09-30T09:00:00Z') } });

    const first = await claimDueJobRuns(new Date('2026-09-30T10:00:00Z'));
    const second = await claimDueJobRuns(new Date('2026-09-30T10:00:00Z'));

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(await Job.findById(id).lean()).toMatchObject({ status: 'active', nextRunAt: new Date('2026-10-01T09:00:00Z') });
  });

  it('leases one executor at a time and reclaims only expired work', async () => {
    const job = await Job.create({ organizationId: org, companyId: new Types.ObjectId(companyId), createdByUserId: new Types.ObjectId(admin.userId), status: 'active', request: 'Test durable execution ownership' });
    const startedAt = new Date();
    const run = await JobRun.create({ organizationId: org, jobId: job._id, companyId: new Types.ObjectId(companyId), status: 'running', dryRun: false, startedAt, ...initialRunLease(undefined, startedAt) });

    const first = await claimJobRunExecution(String(run._id));
    expect(first).not.toBeNull();
    expect(await claimJobRunExecution(String(run._id))).toBeNull();
    expect(await heartbeatJobRun(run._id, first!.owner, { text: 'Still working', milestone: { stage: 'researching', percent: 25 } })).toBe(true);
    expect(await JobRun.findById(run._id).lean()).toMatchObject({ attempt: 1, leaseOwner: first!.owner, progressState: { percent: 25 } });

    await JobRun.updateOne({ _id: run._id }, { $set: { leaseExpiresAt: new Date(Date.now() - 1) } });
    const recovered = await claimJobRunExecution(String(run._id));
    expect(recovered?.owner).not.toBe(first!.owner);
    expect(await JobRun.findById(run._id).lean()).toMatchObject({ attempt: 2, progress: expect.arrayContaining(['Recovered an interrupted run']) });
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
    const sampleJob = await Job.collection.insertOne({ organizationId: org, companyId: new Types.ObjectId(companyId), createdByUserId: new Types.ObjectId(admin.userId), status: 'testing', request: 'x'.repeat(20), updatedAt: new Date(), createdAt: new Date() });
    await JobRun.collection.insertOne({ organizationId: org, jobId: sampleJob.insertedId, companyId: new Types.ObjectId(companyId), status: 'running', dryRun: true, startedAt: new Date(Date.now() - 3600_000), updatedAt: new Date(Date.now() - 3600_000), createdAt: new Date(Date.now() - 3600_000) });
    expect(await sweepJobs()).toEqual({ runsFailed: 1, designsFailed: 1 });
    expect(await Job.findById(sampleJob.insertedId).lean()).toMatchObject({ status: 'proposed' });
    expect(await JobRun.findOne({ jobId: sampleJob.insertedId }).lean()).toMatchObject({ status: 'failed', error: expect.stringContaining('stopped reporting progress'), progressState: { percent: 100 } });
  });

  it('removes oversized partial crawl data before failing an expired Company Overview', async () => {
    const companyObjectId = new Types.ObjectId(companyId);
    const job = await Job.create({ organizationId: org, companyId: companyObjectId, createdByUserId: new Types.ObjectId(admin.userId), status: 'active', request: 'Generate a Company Overview report.', updatedAt: new Date(), createdAt: new Date() });
    const overview = await PropertyOverview.create({ organizationId: org, companyId: companyObjectId, jobId: job._id, rootUrl: 'https://playbound.club/', status: 'crawling' });
    const run = await JobRun.create({ organizationId: org, jobId: job._id, companyId: companyObjectId, propertyOverviewId: overview._id, status: 'running', dryRun: false, startedAt: new Date(), ...initialRunLease('vps:property-overview'), leaseExpiresAt: new Date(Date.now() - 1) });
    await PropertyOverview.updateOne({ _id: overview._id }, { $set: { runId: run._id } });
    await PropertyPage.create({ overviewId: overview._id, organizationId: org, companyId: companyObjectId, url: 'https://playbound.club/page', routePattern: '/page', fetchedAt: new Date(), htmlSnapshot: '<html>large snapshot</html>' });

    expect(await sweepJobs()).toMatchObject({ runsFailed: 1 });
    expect(await PropertyPage.countDocuments({ overviewId: overview._id })).toBe(0);
    expect(await PropertyOverview.findById(overview._id).lean()).toMatchObject({ status: 'failed', error: expect.stringContaining('stopped reporting progress') });
  });

  it('keeps the last Company Overview until its successful replacement is finalized', async () => {
    const companyObjectId = new Types.ObjectId(companyId);
    const previous = await PropertyOverview.create({ organizationId: org, companyId: companyObjectId, rootUrl: 'https://playbound.club/', status: 'complete', completedAt: new Date() });
    await PropertyPage.create({ overviewId: previous._id, organizationId: org, companyId: companyObjectId, url: 'https://playbound.club/old', routePattern: '/old', fetchedAt: new Date() });
    const replacement = await PropertyOverview.create({ organizationId: org, companyId: companyObjectId, rootUrl: 'https://playbound.club/', status: 'crawling' });
    await PropertyPage.create({ overviewId: replacement._id, organizationId: org, companyId: companyObjectId, url: 'https://playbound.club/new', routePattern: '/new', fetchedAt: new Date() });

    expect(await PropertyOverview.exists({ _id: previous._id })).toBeTruthy();
    await replaceCompanyOverview({ overviewId: replacement._id, organizationId: org, companyId: companyObjectId, completion: { completedAt: new Date(), progress: 'Complete', pageCount: 1, edgeCount: 0, issueCount: 0, clusters: [], summary: {} } });

    expect(await PropertyOverview.exists({ _id: previous._id })).toBeNull();
    expect(await PropertyPage.exists({ overviewId: previous._id })).toBeNull();
    expect(await PropertyOverview.findById(replacement._id).lean()).toMatchObject({ status: 'complete', pageCount: 1 });
    expect(await PropertyPage.exists({ overviewId: replacement._id })).toBeTruthy();
  });

  it('cancels and removes an active Company Overview when its job is paused and archived', async () => {
    vi.stubEnv('NUCLEAS_EXECUTION_WORKER_URL', 'https://worker.nucleas.app');
    vi.stubEnv('NUCLEAS_EXECUTION_WORKER_TOKEN', 'test-worker-token');
    const overview = await PropertyOverview.create({ organizationId: org, companyId: new Types.ObjectId(companyId), rootUrl: 'https://playbound.club/', status: 'queued' });
    const linked = await createPropertyOverviewJob({ organizationId: org, companyId: new Types.ObjectId(companyId), userId: admin.userId, companyName: 'Playbound.club', overviewId: overview._id, rootUrl: overview.rootUrl });
    await PropertyOverview.updateOne({ _id: overview._id }, { $set: { jobId: linked.jobId, runId: linked.runId } });
    await startPropertyOverviewJob(linked);
    await PropertyPage.create({ overviewId: overview._id, organizationId: org, companyId: new Types.ObjectId(companyId), url: 'https://playbound.club/partial', routePattern: '/partial', fetchedAt: new Date() });
    const worker = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ cancelled: true }), { status: 202 }));

    expect(await pauseJob(admin, String(linked.jobId))).toMatchObject({ ok: true, job: { status: 'paused' } });
    expect(await PropertyOverview.findById(overview._id)).toBeNull();
    expect(await PropertyPage.exists({ overviewId: overview._id })).toBeNull();
    expect(await JobRun.findById(linked.runId).lean()).toMatchObject({ status: 'failed', error: expect.stringContaining('paused') });
    expect(String(worker.mock.calls[0]?.[0])).toContain(`/v1/property-crawls/${overview._id}`);
    expect(worker.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(await archiveJob(admin, String(linked.jobId))).toMatchObject({ ok: true, job: { status: 'archived' } });
    worker.mockRestore();
    vi.unstubAllEnvs();
  });

  it('uses the explicit lease instead of unrelated document updates when reconciling runs', async () => {
    const sampleJob = await Job.collection.insertOne({ organizationId: org, companyId: new Types.ObjectId(companyId), createdByUserId: new Types.ObjectId(admin.userId), status: 'active', request: 'x'.repeat(20), updatedAt: new Date(), createdAt: new Date() });
    const live = await JobRun.create({ organizationId: org, jobId: sampleJob.insertedId, companyId: new Types.ObjectId(companyId), status: 'running', dryRun: false, startedAt: new Date(Date.now() - 3600_000), ...initialRunLease('worker:live') });
    const expired = await JobRun.create({ organizationId: org, jobId: sampleJob.insertedId, companyId: new Types.ObjectId(companyId), status: 'running', dryRun: false, startedAt: new Date(), ...initialRunLease('worker:gone'), leaseExpiresAt: new Date(Date.now() - 1) });

    expect(await sweepJobs()).toMatchObject({ runsFailed: 1 });
    expect(await JobRun.findById(live._id).lean()).toMatchObject({ status: 'running' });
    expect(await JobRun.findById(expired._id).lean()).toMatchObject({ status: 'failed', progressState: { label: 'Worker lease expired' } });
  });

  it('recovers a context-window rejection with a compact evidence-only request', async () => {
    const job = await proposed();
    let workCalls = 0;
    mocks.chat.mockImplementation(async (input: { systemPrompt: string }) => {
      if (input.systemPrompt.startsWith('You check one run')) return { requestId: 'r', role: 'assistant', text: '{"verdict":"pass","notes":"Sourced."}', costMicros: 0 };
      workCalls += 1;
      return workCalls === 1
        ? { requestId: 'failed', role: 'status', text: "The model rejected the request because it exceeded that deployment’s context window. Rogly returned HTTP 400: maximum context length is 9216 tokens.", costMicros: 0 }
        : { requestId: 'compact', role: 'assistant', text: GOOD, costMicros: 0 };
    });

    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);

    expect((await getJob(admin, job.id))?.runs[0]).toMatchObject({ status: 'needs_review', progressState: { percent: 100 } });
    const compact = mocks.chat.mock.calls[1][0] as { forcePlain: boolean; forceToolLoop: boolean; includeRepoTools: boolean; toolProfile: string; maxOutputTokensOverride: number };
    expect(compact).toMatchObject({ forcePlain: true, forceToolLoop: false, includeRepoTools: false, toolProfile: 'none', maxOutputTokensOverride: 1800 });
  });

  it('clears a failed legacy dry run but refuses to archive an active one', async () => {
    const job = await proposed();
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    expect(await archiveJob(admin, job.id)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('still active') });
    await JobRun.updateOne({ _id: approved.dryRunId }, { $set: { status: 'failed', error: 'Previous deployment timed out.', finishedAt: new Date() } });
    expect(await archiveJob(admin, job.id)).toMatchObject({ ok: true, job: { status: 'archived' } });
  });
});
