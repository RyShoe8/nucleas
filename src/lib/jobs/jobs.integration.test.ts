import { PublishItem, PublishDelivery } from '@/lib/models/Publishing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));
// Teammate advice has its own tests; here it would use up the model replies these tests queue.
vi.mock('@/lib/companies/teamConsult', () => ({ teamAdviceForJob: async () => [], renderAdvice: () => '' }));
vi.mock('./linkProspects', () => ({ linkProspectContext: async () => 'UNVERIFIED_DIRECTORY_QUEUE_MARKER', priorPlacementProblems: async () => [], rememberProspectOutcome: async () => undefined }));

const mocks = vi.hoisted(() => ({ design: vi.fn(), chat: vi.fn(), browser: vi.fn(), models: vi.fn(), select: vi.fn(), verify: vi.fn() }));
vi.mock('@/lib/casinoDiscovery/intake', () => ({ casinoIntake: async () => ({ inventory: async () => ({ casinos: [] }) }) }));
vi.mock('./designer', () => ({ designJob: (...args: unknown[]) => mocks.design(...args) }));
// The gap check has its own mock, so a test about something else sees only the calls it is about.
const research = vi.hoisted(() => ({ gaps: vi.fn(), pages: vi.fn() }));
vi.mock('@/lib/ai/companyChat', () => ({
  attemptCompanyCredentialChat: (input: { systemPrompt?: string }) => (input.systemPrompt?.startsWith('You check research') ? research.gaps(input) : mocks.chat(input)),
}));
vi.mock('@/lib/ai/research/pageChecks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/research/pageChecks')>()),
  checkPages: (...args: unknown[]) => research.pages(...args),
}));
vi.mock('@/lib/ai/engine/catalog', () => ({ listAvailableModels: (...args: unknown[]) => mocks.models(...args) }));
vi.mock('@/lib/ai/engine/select', () => ({
  readEngineSettings: async () => ({ defaultCostLevel: 'low', priceCeilings: { low: 1.5, medium: 5, high: null }, overrides: {} }),
  selectModel: (...args: unknown[]) => mocks.select(...args),
  isCostLevel: (v: unknown) => v === 'low' || v === 'medium' || v === 'high',
}));
vi.mock('@/lib/building/companyCode', () => ({ resolveCompanyRepository: async () => null }));
const search = vi.hoisted(() => ({ hits: [{ provider: 'searxng' }] as { provider: string }[] }));
vi.mock('@/lib/ai/tools/webSearch', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/ai/tools/webSearch')>()), researchSearch: async () => ({ hits: search.hits, note: 'No hits from: searxng.' }) }));
// Page verification opens real pages; it has its own tests (opportunityPages.test.ts).
vi.mock('./opportunityPages', async (importOriginal) => ({ ...(await importOriginal<typeof import('./opportunityPages')>()), verifyOpportunity: (...args: unknown[]) => mocks.verify(...args) }));
vi.mock('@/lib/ai/tools/browserClient', () => ({ browserNavigate: (...args: unknown[]) => mocks.browser(...args) }));

import Client from '@/lib/models/Client';
import User from '@/lib/models/User';
import Employee from '@/lib/models/Employee';
import { Job, JobRun } from '@/lib/models/Job';
import { LinkOpportunity } from '@/lib/models/LinkOpportunity';
import Project from '@/lib/models/Project';
import { SeoBrief } from '@/lib/models/SeoBrief';
import { MarketingPlan } from '@/lib/models/MarketingPlan';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { brandVoiceContext, getBrandVoice, updateBrandVoice } from '@/lib/brandVoice/service';
import { ArtifactRevision, artifactHistory } from './artifactHistory';
import { PropertyOverview, PropertyPage } from '@/lib/models/PropertyOverview';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { updateJobBudget, publishingAction, answerQuestions, approveJob, archiveJob, claimDueJobRuns, createJob, createTemplateJob, decideRun, executeJobRun, getJob, listJobs, pauseJob, renameJob, runDesign, runNow, sweepJobs } from './jobs';
import type { JobDesign } from './schema';
import { updateLinkOpportunity, verifyLinkOpportunity, syncLinkOpportunities } from './linkOpportunities';
import { completePropertyOverviewJob, createPropertyOverviewJob, startPropertyOverviewJob, updatePropertyOverviewJob } from '@/lib/propertyOverview/job';
import { processPropertyOverviewQueue } from '@/lib/propertyOverview/crawler';
import { replaceCompanyOverview } from '@/lib/propertyOverview/storage';
import { claimJobRunExecution, heartbeatJobRun, initialRunLease, nextQueuedRunId, queueIfBusy, wakeJobQueue } from './runLifecycle';
import { updateMarketingPlan } from './marketingPlans';
import { ResearchEvidence } from './researchEvidence';

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
  mocks.verify.mockReset().mockResolvedValue({ hard: [], soft: [] });
  await BrandVoice.deleteMany({});
  await ArtifactRevision.deleteMany({});
  mocks.models.mockResolvedValue([]);
  mocks.select.mockImplementation(async (_org: string, need: string) => ({
    primary: need === 'review' ? { profileId: 'r'.repeat(24), model: 'gpt-6-sol', free: false, label: 'OpenAI' } : { profileId: 'w'.repeat(24), model: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', free: true, label: 'Rogly' },
    fallback: null,
  }));
  await Promise.all([Client.deleteMany({}), User.deleteMany({}), Employee.collection.deleteMany({}), Project.deleteMany({}), SeoBrief.deleteMany({}), MarketingPlan.deleteMany({}), Job.deleteMany({}), JobRun.deleteMany({}), LinkOpportunity.deleteMany({}), PropertyOverview.deleteMany({}), PropertyPage.deleteMany({})]);
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

describe('ongoing job settings', () => {
  it('edits budget independently of schedule and enforces management rights', async () => {
    const job = await proposed();
    const nextRunAt = new Date(Date.now() + 86400000);
    await Job.updateOne({ _id: job.id }, { $set: { status: 'active', nextRunAt } });
    expect(await updateJobBudget(admin, job.id, 25)).toMatchObject({ ok: true });
    expect(await Job.findById(job.id).lean()).toMatchObject({ monthlyBudgetMicros: 25_000_000, status: 'active', nextRunAt });
    expect(await updateJobBudget(member, job.id, 40)).toMatchObject({ ok: false });
    for (const value of [0, -1, Infinity, '20', 1001]) expect(await updateJobBudget(admin, job.id, value)).toMatchObject({ ok: false });
  });

  it('keeps a due schedule when creating its run fails', async () => {
    const job = await proposed({ ...DESIGN, schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' } });
    const due = new Date('2026-11-09T09:00:00Z');
    await Job.updateOne({ _id: job.id }, { $set: { status: 'active', nextRunAt: due } });
    const create = vi.spyOn(JobRun, 'create').mockRejectedValueOnce(new Error('Simulated storage failure'));
    try { await expect(claimDueJobRuns(new Date('2026-11-09T09:01:00Z'))).rejects.toThrow('Simulated storage failure'); }
    finally { create.mockRestore(); }
    expect((await Job.findById(job.id).lean())?.nextRunAt).toEqual(due);
    expect(await JobRun.countDocuments({ jobId: job.id })).toBe(0);
    expect(await claimDueJobRuns(new Date('2026-11-09T09:02:00Z'))).toHaveLength(1);
  });

  it('posting a Spotlight sample enables its recurring schedule and completes review', async () => {
    const job = await proposed({ ...DESIGN, skill: 'signature_outreach', schedule: { kind: 'weekly', weekday: 1, time: '09:00', timezone: 'America/Chicago' } });
    await Job.updateOne({ _id: job.id }, { $set: { status: 'testing' } });
    const run = await JobRun.create({ organizationId: org, companyId, jobId: job.id, dryRun: true, status: 'needs_review', startedAt: new Date(), output: { records: [{ values: { prospect_domain: 'transistor.fm' }, sources: [] }], summary: '', gaps: [] } });
    const item = await PublishItem.create({ organizationId: org, companyId, jobId: job.id, key: 'signature:transistor.fm', status: 'processed' });
    const delivery = await PublishDelivery.create({ organizationId: org, companyId, jobId: job.id, itemId: item._id, platform: 'bluesky', mode: 'manual', status: 'ready', body: 'Signature concept' });
    expect(await publishingAction(admin, job.id, 'mark_posted', { deliveryId: String(delivery._id) })).toMatchObject({ ok: true });
    expect(await JobRun.findById(run._id).lean()).toMatchObject({ status: 'completed' });
    const updated = await Job.findById(job.id).lean();
    expect(updated?.status).toBe('ready');
    expect(updated?.nextRunAt?.getTime()).toBeGreaterThan(Date.now());
    await Job.updateOne({ _id: job.id }, { $set: { status: 'paused' } });
    expect(await publishingAction(admin, job.id, 'mark_posted', { deliveryId: String(delivery._id) })).toMatchObject({ ok: true });
    expect((await Job.findById(job.id).lean())?.status).toBe('paused');
  });
});

describe('completed job visibility', () => {
  it('hides completed jobs at three days, keeps active jobs and preserves history access', async () => {
    const now = Date.now();
    const cutoff = now - 3 * 86_400_000;
    const make = (title: string, extra: Record<string, unknown>) => Job.create({ organizationId: org, companyId, createdByUserId: admin.userId, request: title, design: { ...DESIGN, title }, status: 'done', ...extra });
    const [recent, boundary, old, legacy, active] = await Promise.all([
      make('Recent completion', { completedAt: new Date(cutoff + 1) }),
      make('Exactly three days', { completedAt: new Date(cutoff) }),
      make('Older completion', { completedAt: new Date(cutoff - 1) }),
      make('Legacy completion edited today', { events: [{ action: 'dry_run_accepted', at: new Date(cutoff - 1) }] }),
      make('Recurring job', { status: 'ready', completedAt: new Date(cutoff - 1) }),
    ]);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      expect((await listJobs(admin)).map((j) => j.id).sort()).toEqual([String(recent._id), String(active._id)].sort());
      expect((await listJobs(admin, { includeClosed: true })).map((j) => j.id)).toEqual(expect.arrayContaining([String(boundary._id), String(old._id), String(legacy._id)]));
      expect(await getJob(admin, String(old._id))).toMatchObject({ status: 'done' });
    } finally {
      clock.mockRestore();
    }
  });
});

describe('designing', () => {
  it('persists generated Voice as a draft, then uses only approved company-scoped personas', async () => {
    const created = await createTemplateJob(admin, { companyId, template: 'brand_voice', config: {} });
    expect(created).toMatchObject({ ok: true, job: { design: { skill: 'brand_voice' }, projectId: null, level: 'high' } });
    if (!created.ok) throw new Error(created.error);
    const run = await JobRun.create({ organizationId: org, companyId, jobId: created.job.id, startedAt: new Date(), status: 'needs_review', dryRun: true,
      output: { records: [{ values: { brand_profile: { positioning: { primary: 'Game discovery with practical advice.' }, audienceRelationship: { style: 'Fellow players' }, rhetoricalPatterns: ['Open with the game and a concrete reason to play.'] } }, sources: ['https://playbound.club/'] }], summary: 'Brand persona', gaps: [] },
    });
    expect(await decideRun(admin, created.job.id, String(run._id), 'accept')).toMatchObject({ ok: true });
    const voice = await getBrandVoice(admin, companyId);
    expect(voice).toMatchObject({ status: 'draft', revision: 1 });
    expect(voice?.persona).toContain('Fellow players');
    expect(await brandVoiceContext(org, new Types.ObjectId(companyId))).toBe('');
    expect(await updateBrandVoice(member, companyId, { ...voice, status: 'approved' })).toMatchObject({ ok: false, status: 403 });
    expect(await updateBrandVoice(admin, companyId, { ...voice, status: 'approved' })).toMatchObject({ ok: true, voice: { status: 'approved', revision: 2 } });
    expect(await brandVoiceContext(org, new Types.ObjectId(companyId))).toContain('Fellow players');
    const history = await artifactHistory(admin, companyId, 'brand_voice');
    expect(history?.versions).toHaveLength(0); // Approval alone does not create different content.
    expect(await artifactHistory({ ...admin, organizationId: new Types.ObjectId() }, companyId, 'brand_voice')).toBeNull();
    expect(await brandVoiceContext(new Types.ObjectId(), new Types.ObjectId(companyId))).toBe('');
    expect(await getBrandVoice({ ...admin, organizationId: new Types.ObjectId() }, companyId)).toBeNull();
    expect(await updateBrandVoice(admin, companyId, { ...voice, status: 'draft' })).toMatchObject({ ok: false, status: 409 });
  });

  it('keeps malformed Voice results reviewable instead of accepting them', async () => {
    const created = await createTemplateJob(admin, { companyId, template: 'brand_voice', config: {} });
    if (!created.ok) throw new Error(created.error);
    const run = await JobRun.create({ organizationId: org, companyId, jobId: created.job.id, startedAt: new Date(), status: 'needs_review', output: { records: [{ values: { brand_profile: '{}' }, sources: [] }] } });
    expect(await decideRun(admin, created.job.id, String(run._id), 'accept')).toMatchObject({ ok: false, status: 400 });
    expect(await JobRun.findById(run._id).lean()).toMatchObject({ status: 'needs_review' });
    expect(await getBrandVoice(admin, companyId)).toBeNull();
  });

  it('creates a company Marketing Plan job without requiring a project selection', async () => {
    const created = await createTemplateJob(admin, { companyId, template: 'marketing_plan', config: { companyName: 'Playbound.club' } });
    expect(created).toMatchObject({ ok: true, job: { companyId, projectId: null, status: 'proposed', design: { skill: 'marketing_plan', title: 'Marketing plan · Playbound.club' } } });
  });

  it('creates separate proposed execution jobs only after the Marketing Plan is approved', async () => {
    const saved = await updateMarketingPlan(admin, companyId, {
      status: 'approved', summary: 'A game discovery and server hosting property.', audience: 'PC players and gaming communities.', goals: ['Grow qualified discovery'], positioning: 'Practical game discovery.', messagingPillars: ['Find games worth playing'],
      primaryTopics: ['multiplayer games'], competitors: ['example.com'], excludedTopics: ['education'], geographicTargets: ['United States'], priorityPages: [{ url: 'https://playbound.club/games', purpose: 'Game discovery', keywords: ['multiplayer games'] }], seoStrategy: 'Build topic authority around game discovery.',
      aiCitationStrategy: 'Publish source-worthy game facts.', aiTargetQuestions: ['What free multiplayer game should I play?'], aiSourceTargets: ['Gaming publications'], socialStrategy: 'Share useful discoveries.', socialPlatforms: ['LinkedIn'], socialContentPillars: ['Game discoveries'], socialCadence: 'One daily post.', kpis: ['Organic clicks'], notes: '',
    });
    expect(saved).toMatchObject({ ok: true, plan: { status: 'approved' } });
    const generated = await Job.find({ organizationId: org, companyId, 'design.skill': { $in: ['link_building', 'social_media', 'ai_citations'] } }).lean();
    expect(generated.map((job) => job.design.skill).sort()).toEqual(['ai_citations', 'link_building', 'social_media']);
    expect(generated.every((job) => job.status === 'proposed')).toBe(true);
    if (!saved.ok) throw new Error(saved.error);
    await updateMarketingPlan(admin, companyId, { ...saved.plan, summary: 'Updated company strategy.', status: 'draft' });
    const history = await artifactHistory(admin, companyId, 'marketing_plan');
    expect(history?.versions[0].text).toContain('A game discovery and server hosting property.');
    expect(history?.current?.text).toContain('Updated company strategy.');
    const updated = await updateMarketingPlan(admin, companyId, { ...saved.plan, summary: 'Updated company strategy.', status: 'approved' });
    expect(updated.ok).toBe(true);
    const afterApproval = await artifactHistory(admin, companyId, 'marketing_plan');
    expect(afterApproval?.versions).toHaveLength(1);
    expect(afterApproval?.versions[0].text).toContain('A game discovery and server hosting property.');
  });

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

beforeEach(() => {
  research.gaps.mockReset();
  research.gaps.mockResolvedValue({ requestId: 'gaps', role: 'assistant', text: '{"complete":true}', costMicros: 0 });
  research.pages.mockReset();
  research.pages.mockImplementation(async (urls: string[]) => urls.map((url) => ({ url, status: 'opened', title: 'Page', text: 'Page text' })));
});

describe('the research standard in a run', () => {
  const run = async () => {
    const job = await proposed();
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    return JobRun.findById(approved.dryRunId).lean();
  };
  const reviewOrWork = (work: () => unknown, reviews: { userText: string }[] = []) => async (input: { systemPrompt: string; userText: string }) => {
    if (input.systemPrompt.startsWith('You check one run')) {
      reviews.push(input);
      return { requestId: 'review', role: 'assistant', text: '{"verdict":"pass","notes":"Sourced."}', costMicros: 0 };
    }
    return work();
  };

  it('opens every link, tells the reviewer what it found, and drops sources that do not exist', async () => {
    const reviews: { userText: string }[] = [];
    research.pages.mockImplementation(async (urls: string[]) => urls.map((url) => ({ url, status: url.includes('gone') ? 'gone' : 'opened', title: 'Page', text: 'Excerpt of the page' })));
    const parsed = JSON.parse(GOOD) as { records: { sources: string[] }[] };
    parsed.records[0]!.sources.push('https://gone-page.com/review');
    mocks.chat.mockImplementation(reviewOrWork(() => ({ requestId: 'work', role: 'assistant', text: JSON.stringify(parsed), costMicros: 0, toolsUsed: ['web_fetch'] }), reviews));
    const saved = await run();
    expect(saved?.output?.records[0]?.sources).not.toContain('https://gone-page.com/review');
    expect(saved?.output?.gaps.join(' ')).toContain('https://gone-page.com/review');
    expect(reviews.at(-1)?.userText).toContain('# Pages Nucleas opened itself');
    expect(reviews.at(-1)?.userText).toContain('GONE https://gone-page.com/review');
    expect(saved?.modelPath?.some((step: { note?: string }) => step.note === 'Opened the pages in code')).toBe(true);
  });

  it('follows up on what is missing, and keeps a better result', async () => {
    const better = JSON.parse(GOOD) as { summary: string };
    better.summary = 'Followed up and found more';
    research.gaps.mockResolvedValueOnce({ requestId: 'gaps', role: 'assistant', text: '{"complete":false,"note":"more evidence","missing":[{"task":"Open the release notes page"}]}', costMicros: 0 });
    const prompts: string[] = [];
    mocks.chat.mockImplementation(async (input: { systemPrompt: string; userText: string }) => {
      if (input.systemPrompt.startsWith('You check one run')) return { requestId: 'review', role: 'assistant', text: '{"verdict":"pass","notes":"Sourced."}', costMicros: 0 };
      prompts.push(input.userText);
      return { requestId: 'work', role: 'assistant', text: input.userText.includes('Follow up on this gap') ? JSON.stringify(better) : GOOD, costMicros: 0, toolsUsed: ['web_fetch'] };
    });
    const saved = await run();
    expect(prompts.some((prompt) => prompt.includes('Open the release notes page'))).toBe(true);
    expect(saved?.output?.summary).toBe('Followed up and found more');
    expect(research.gaps).toHaveBeenCalledTimes(2);
    expect(saved?.modelPath?.some((step: { note?: string; outcome?: string }) => step.note === 'Check what is still missing' && step.outcome?.includes('more evidence'))).toBe(true);
    expect(saved?.modelPath?.some((step: { note?: string }) => step.note === 'Follow up on a gap')).toBe(true);
  });

  it('keeps what it has when a follow-up opened nothing', async () => {
    const worse = JSON.parse(GOOD) as { summary: string };
    worse.summary = 'A guess from memory';
    research.gaps.mockResolvedValueOnce({ requestId: 'gaps', role: 'assistant', text: '{"complete":false,"missing":[{"task":"Open the release notes page"}]}', costMicros: 0 });
    mocks.chat.mockImplementation(async (input: { systemPrompt: string; userText: string }) => {
      if (input.systemPrompt.startsWith('You check one run')) return { requestId: 'review', role: 'assistant', text: '{"verdict":"pass","notes":"Sourced."}', costMicros: 0 };
      const following = input.userText.includes('Follow up on this gap');
      return { requestId: 'work', role: 'assistant', text: following ? JSON.stringify(worse) : GOOD, costMicros: 0, toolsUsed: following ? [] : ['web_fetch'] };
    });
    const saved = await run();
    expect(saved?.output?.summary).not.toBe('A guess from memory');
  });

  it('goes ahead when a gap check cannot be read', async () => {
    research.gaps.mockResolvedValue({ requestId: 'gaps', role: 'assistant', text: 'not json', costMicros: 0 });
    mocks.chat.mockImplementation(reviewOrWork(() => ({ requestId: 'work', role: 'assistant', text: GOOD, costMicros: 0, toolsUsed: ['web_fetch'] })));
    const saved = await run();
    expect(saved?.status).toBe('needs_review');
    expect(research.gaps).toHaveBeenCalledTimes(1);
  });
});

describe('approving and the dry run', () => {
  it('reroutes a timed-out free dry run to another eligible free model', async () => {
    const qwen = { profileId: 'w'.repeat(24), model: 'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ', free: true, label: 'Rogly' };
    const gemma = { profileId: 'w'.repeat(24), model: 'google/gemma-4-12B-it-qat-w4a16-ct', free: true, label: 'Rogly' };
    mocks.models.mockResolvedValue([qwen, gemma]);
    mocks.select.mockImplementation(async (_org: string, need: string, _level: string, options?: { models?: { model: string }[] }) => ({
      primary: need === 'review'
        ? { profileId: 'r'.repeat(24), model: 'gpt-6-sol', free: false, label: 'OpenAI' }
        : options?.models?.length === 1 && options.models[0].model === gemma.model ? gemma : qwen,
      fallback: null,
    }));
    mocks.chat.mockImplementation(async (input: { systemPrompt: string; model: string }) => {
      if (input.systemPrompt.startsWith('You check one run')) return { requestId: 'review', role: 'assistant', text: '{"verdict":"pass","notes":"Sourced."}', costMicros: 0 };
      if (input.model === qwen.model) return { requestId: 'timeout', role: 'status', text: 'HTTP 504 (upstream timeout): The upstream model gateway timed out.', failureCategory: 'unavailable', debugHint: 'httpStatus=504', costMicros: 0 };
      return { requestId: 'work', role: 'assistant', text: GOOD, costMicros: 0 };
    });

    const job = await proposed();
    await Job.updateOne({ _id: job.id }, { $set: { level: 'free' } });
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);

    const run = await JobRun.findById(approved.dryRunId).lean();
    expect(run).toMatchObject({ status: 'needs_review', models: [qwen.model, gemma.model, qwen.model, 'gpt-6-sol'] });
    expect(mocks.models).toHaveBeenLastCalledWith({ force: true });
  });

  it('reroutes HTTP 402 to another credential, preferring direct OpenAI', async () => {
    const router = { profileId: 'a'.repeat(24), model: 'router-model', free: false, label: 'OpenRouter', provider: 'openrouter' };
    const sibling = { ...router, model: 'router-sibling' };
    const openai = { profileId: 'b'.repeat(24), model: 'openai-model', free: false, label: 'OpenAI', provider: 'openai' };
    mocks.models.mockResolvedValue([router, sibling, openai]);
    mocks.select.mockImplementation(async (_org: string, _need: string, _level: string, options?: { models?: { model: string }[] }) => ({ primary: options?.models?.length === 1 && options.models[0].model === openai.model ? openai : router, fallback: null }));
    mocks.chat.mockImplementation(async (input: { systemPrompt: string; model: string }) => {
      if (input.systemPrompt.startsWith('You check one run')) return { requestId: 'review', role: 'assistant', text: '{"verdict":"pass","notes":"Sourced."}', costMicros: 0 };
      if (input.model === router.model) return { requestId: 'credits', role: 'status', text: 'OpenRouter returned HTTP 402: This request requires more credits, or fewer max_tokens.', debugHint: 'httpStatus=402', costMicros: 0 };
      return { requestId: 'work', role: 'assistant', text: GOOD, costMicros: 0 };
    });
    const job = await proposed();
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    expect(await JobRun.findById(approved.dryRunId).lean()).toMatchObject({ status: 'needs_review', models: [router.model, openai.model, openai.model, openai.model] });
    expect(mocks.chat.mock.calls.some(([input]) => input.model === sibling.model)).toBe(false);
  });

  it('continues past consecutive exhausted credentials in work and review', async () => {
    const google = { profileId: 'a'.repeat(24), model: 'google-model', free: false, label: 'Google', provider: 'google' };
    const emptyOpenai = { profileId: 'b'.repeat(24), model: 'empty-openai', free: false, label: 'OpenAI empty', provider: 'openai' };
    const working = { profileId: 'c'.repeat(24), model: 'working-openai', free: false, label: 'OpenAI working', provider: 'openai' };
    const reviewer = { profileId: 'd'.repeat(24), model: 'empty-reviewer', free: false, label: 'Review', provider: 'openrouter' };
    mocks.models.mockResolvedValue([google, emptyOpenai, working, reviewer]);
    mocks.select.mockImplementation(async (_org: string, need: string, _level: string, options?: { models?: { model: string }[] }) => ({ primary: options?.models && options.models.length < 4 ? options.models[0] ?? null : need === 'review' ? reviewer : google, fallback: null }));
    mocks.chat.mockImplementation(async (input: { systemPrompt: string; model: string }) => {
      if (input.model !== working.model) return { requestId: 'credits', role: 'status', text: 'Provider returned HTTP 402: credits depleted.', costMicros: 0 };
      return { requestId: 'success', role: 'assistant', text: input.systemPrompt.startsWith('You check one run') ? '{"verdict":"pass","notes":"Sourced."}' : GOOD, costMicros: 0 };
    });
    const job = await proposed();
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    expect(await JobRun.findById(approved.dryRunId).lean()).toMatchObject({ status: 'needs_review', models: [google.model, emptyOpenai.model, working.model, working.model, reviewer.model, working.model], review: { verdict: 'pass' } });
  });

  it('caps failing review calls and keeps the missing review visible', async () => {
    const pool = Array.from({ length: 12 }, (_, i) => ({ profileId: 'a'.repeat(24), model: `candidate-${i}`, free: false, label: 'Provider', provider: 'openai' }));
    mocks.models.mockResolvedValue(pool);
    mocks.select.mockImplementation(async (_org: string, _need: string, _level: string, options?: { models?: typeof pool }) => ({ primary: options?.models?.[0] ?? null, fallback: null }));
    mocks.chat.mockImplementation(async (input: { systemPrompt: string }) => input.systemPrompt.startsWith('You check one run')
      ? { requestId: 'error', role: 'status', text: 'HTTP 503: provider unavailable', costMicros: null }
      : { requestId: 'work', role: 'assistant', text: GOOD, costMicros: 0 });
    const job = await proposed();
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    const run = await JobRun.findById(approved.dryRunId).lean();
    expect(mocks.chat.mock.calls.filter(([input]) => input.systemPrompt.startsWith('You check one run'))).toHaveLength(3);
    expect(run).toMatchObject({ status: 'needs_review', issues: expect.arrayContaining([expect.objectContaining({ field: 'review' })]) });
    expect((run?.modelPath as { error?: string }[]).filter((step) => step.error)).toHaveLength(3);
  });

  it('rolls back approval when creating the dry run fails', async () => {
    const job = await proposed();
    const create = vi.spyOn(JobRun, 'create').mockRejectedValueOnce(new Error('Connection interrupted'));
    try {
      await expect(approveJob(admin, job.id, { completion: 'review' })).rejects.toThrow('Connection interrupted');
    } finally { create.mockRestore(); }
    expect(await Job.findById(job.id).lean()).toMatchObject({ status: 'proposed' });
    expect(await JobRun.countDocuments({ jobId: job.id })).toBe(0);
    expect(await approveJob(admin, job.id, { completion: 'review' })).toMatchObject({ ok: true, dryRunId: expect.any(String) });
    expect(await JobRun.countDocuments({ jobId: job.id })).toBe(1);
  });

  it('skips a gateway-wide outage and stops at a shared budget refusal', async () => {
    const free = { profileId: 'a'.repeat(24), model: 'free-a', free: true, label: 'Rogly', provider: 'custom' };
    const sibling = { ...free, model: 'free-b' };
    const paid = { profileId: 'b'.repeat(24), model: 'paid', free: false, label: 'OpenAI', provider: 'openai' };
    mocks.models.mockResolvedValue([free, sibling, paid]);
    mocks.select.mockImplementation(async (_org: string, _need: string, _level: string, options?: { models?: { model: string }[] }) => ({ primary: options?.models?.length === 1 ? paid : free, fallback: paid }));
    mocks.chat.mockImplementation(async (input: { model: string }) => input.model === free.model
      ? { requestId: 'outage', role: 'status', text: 'Rogly returned HTTP 503: the authentication database is temporarily unreachable.', costMicros: 0 }
      : { requestId: 'budget', role: 'status', text: 'AI budget cannot reserve $1.00: $0.66 available.', failureCategory: 'budget_exhausted', costMicros: 0 });
    const job = await proposed();
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    expect(mocks.chat.mock.calls.map(([input]) => input.model)).toEqual([free.model, paid.model]);
    expect(await JobRun.findById(approved.dryRunId).lean()).toMatchObject({ status: 'failed', error: expect.stringContaining('AI budget cannot reserve') });
  });


  it('remembers 404 candidates before replacing them and never delivers the dead recommendation', async () => {
    const job = await proposed({ ...DESIGN, skill: 'link_building' });
    mocks.select.mockImplementation(async (_org: string, need: string) => ({
      primary: { profileId: (need === 'review' ? 'r' : 'w').repeat(24), model: need === 'review' ? 'review-model' : 'first-researcher', free: true, label: 'Test' },
      fallback: need === 'review' ? null : { profileId: 'f'.repeat(24), model: 'fallback-researcher', free: true, label: 'Test fallback' },
    }));
    let calls = 0;
    const result = (url: string) => JSON.stringify({ ...JSON.parse(GOOD), records: [{ values: {
      ...JSON.parse(GOOD).records[0].values, opportunity_url: url, relevance_score: 90,
      relevance_evidence: 'A directly relevant gaming resource for players with a visible free submission flow and clear evidence.',
      strategy_evidence: 'The approved strategy prioritizes the games directory and this resource serves the same player audience.',
    }, sources: [url] }] });
    mocks.chat.mockImplementation(async (input: { systemPrompt: string }) => ({ requestId: 'test', role: 'assistant', costMicros: 0,
      text: input.systemPrompt.startsWith('You check one run') ? '{"verdict":"pass","notes":"Verified."}' : result(++calls === 1 ? 'https://directory.example/missing/' : 'https://directory.example/real') }));
    mocks.verify.mockResolvedValueOnce({ hard: ['HTTP 404'], soft: [], missing: true }).mockResolvedValue({ hard: [], soft: [] });
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    expect(await LinkOpportunity.findOne({ opportunityUrl: 'https://directory.example/missing' }).lean()).toMatchObject({ status: 'nonexistent' });
    expect(mocks.chat.mock.calls.slice(0, 2).map(([input]) => input.model)).toEqual(['first-researcher', 'first-researcher']);
    expect(mocks.chat.mock.calls.find(([input]) => String(input.systemPrompt).startsWith('You carry out one run'))?.[0].userText.slice(0, 1000)).toContain('UNVERIFIED_DIRECTORY_QUEUE_MARKER');
    expect(await LinkOpportunity.countDocuments({ status: 'recommended' })).toBe(1);
    expect((await JobRun.findById(approved.dryRunId).lean())?.output.records[0].values.opportunity_url).toBe('https://directory.example/real');
    await syncLinkOpportunities({ organizationId: org, companyId: new Types.ObjectId(companyId), jobId: new Types.ObjectId(), runId: new Types.ObjectId(),
      output: { records: [{ values: { opportunity_url: 'https://directory.example/missing/#again', target_url: 'https://playbound.club/another-page' }, sources: [] }], summary: '', gaps: [] } });
    expect(await LinkOpportunity.countDocuments({ status: 'recommended' })).toBe(1);
  });

  it('never escalates malformed link research to a paid model and stops after two free attempts', async () => {
    const job = await proposed({ ...DESIGN, skill: 'link_building' });
    mocks.select.mockImplementation(async (_org: string, need: string) => ({ primary: { profileId: (need === 'review' ? 'p' : 'w').repeat(24), model: need === 'review' ? 'paid-reviewer' : 'free-researcher', free: need !== 'review', label: 'Test' }, fallback: { profileId: 'f'.repeat(24), model: 'paid-researcher', free: false, label: 'Paid fallback' } }));
    mocks.chat.mockResolvedValue({ requestId: 'bad', role: 'assistant', text: 'No valid result JSON.', costMicros: 0 });
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    expect(mocks.chat.mock.calls.map(([input]) => input.model)).toEqual(['free-researcher', 'free-researcher']);
    expect(await JobRun.findById(approved.dryRunId).lean()).toMatchObject({ status: 'failed', costMicros: 0 });
  });

  it.each(['signature_outreach', 'casino_discovery'] as const)('replans %s from observed gaps without delivering an empty result', async skill => {
    const job = await proposed({ ...DESIGN, skill });
    await JobRun.create({ organizationId: org, companyId: new Types.ObjectId(), jobId: new Types.ObjectId(),
      researchSkill: skill, researchFamily: 'association', startedAt: new Date(), finishedAt: new Date(),
      status: 'completed', costMicros: 123, review: { verdict: 'pass', notes: 'Other company private notes' },
      output: { records: [{ sources: ['https://other-company.invalid/private'] }], summary: 'Private candidate', gaps: [] } });
    let plans = 0;
    const empty = JSON.stringify({ records: [], summary: 'Screened prospects', gaps: ['Official page inaccessible'] });
    mocks.chat.mockImplementation(async ({ systemPrompt, userText }) => {
      let text = empty;
      if (systemPrompt.startsWith('Choose a concrete research method')) {
        plans++;
        if (plans === 1) {
          expect(userText).toContain('association');
          expect(userText).toContain('"reviewedRecords":1');
          expect(userText).not.toMatch(/other-company|Private candidate|private notes/);
        }
        if (plans === 2) expect(userText).toContain('Official page inaccessible');
        text = JSON.stringify({ source: plans === 1 ? 'Industry directory' : 'Partner announcements', rationale: 'Public launch evidence', discovery: 'Find new entries', verification: 'Open the official page', pivot: 'Start from partners' });
      } else if (skill === 'signature_outreach' && userText.includes('Prospect search retry 1 of 3') && !userText.includes('Format the previous reply')) {
        text = 'Found a report but could not format the record.';
      } else if (systemPrompt.startsWith('Scout public sources')) {
        text = 'Discovery source was inaccessible.';
      } else if (systemPrompt.startsWith('You check one run')) {
        text = '{"verdict":"fail","notes":"No evidence"}';
      }
      return { requestId: 'test', role: 'assistant', text, costMicros: 100 };
    });
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    const run = await JobRun.findById(approved.dryRunId).lean();
    expect(run?.status).toBe('failed');
    expect(plans).toBe(2);
    if (skill === 'signature_outreach') expect(run?.modelPath).toEqual(expect.arrayContaining([expect.objectContaining({ note: 'Format retry' })]));
    expect(run?.modelPath.map((step: { note: string }) => step.note)).toContain('Scout candidate sources');
    expect(mocks.chat.mock.calls.some(([input]) => input.forceToolLoop && input.userText.includes('Partner announcements'))).toBe(true);
  });

  it('uses one Medium paid research retry on the existing Spotlight candidate', async () => {
    const job = await proposed({ ...DESIGN, skill: 'signature_outreach' });
    await Job.updateOne({ _id: job.id }, { $set: { level: 'medium' } });
    const free = { model: 'local', profileId: 'a'.repeat(24), free: true };
    const paid = { model: 'paid-research', profileId: 'b'.repeat(24), free: false };
    mocks.select.mockResolvedValue({ primary: free, fallback: paid });
    mocks.chat.mockImplementation(async ({ systemPrompt, userText }) => {
      let text = GOOD;
      if (systemPrompt.startsWith('Choose a concrete')) text = JSON.stringify({ source: 'Founders', discovery: 'Find dated launches', rationale: 'Current prospects' });
      else if (systemPrompt.startsWith('Scout public')) text = 'Scouted founder listings.';
      else if (userText.includes('Prospect search retry')) text = JSON.stringify({ records: [], summary: 'Unavailable', gaps: [] });
      return { requestId: 'test', role: 'assistant', text, costMicros: 0 };
    });
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    const calls = mocks.chat.mock.calls.filter(([input]) => input.model === paid.model);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({ forceToolLoop: true, userText: expect.stringContaining('Verify the existing candidate') });
    expect(calls[0][0].userText).toContain('Deadlock');
    const planner = mocks.chat.mock.calls.find(([input]) => input.systemPrompt.startsWith('Choose a concrete'));
    expect(planner?.[0].userText).toContain('Start from the rarest requirement, a company Bluesky profile');
  });

  describe('the job queue', () => {
    const running = async (at: Date, extra: Record<string, unknown> = {}) => {
      const job = await proposed({ ...DESIGN, title: `Job ${at.getTime()}` });
      const run = await JobRun.create({ organizationId: admin.organizationId, jobId: job.id, companyId, dryRun: true, status: 'running', startedAt: at, executionStartedAt: at, leaseExpiresAt: new Date(Date.now() + 600_000), leaseOwner: 'x', ...extra });
      return { job, run };
    };

    it('runs the first job and queues the next, saying what it waits for', async () => {
      const first = await running(new Date(Date.now() - 60_000));
      const second = await running(new Date());
      expect(await queueIfBusy(first.run._id)).toBe(false);
      expect(await queueIfBusy(second.run._id)).toBe(true);
      const queued = (await JobRun.findById(second.run._id).lean())!;
      expect(queued.status).toBe('running');
      expect(queued.executionStartedAt).toBeUndefined();
      expect(queued.leaseOwner).toBeUndefined();
      expect(queued.progressState?.label).toContain('Queued: starts when');
      expect(queued.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
      await JobRun.deleteMany({});
    });

    it('survives the stuck-run sweep while it waits, and can be claimed when its turn comes', async () => {
      const first = await running(new Date(Date.now() - 60_000));
      const second = await running(new Date());
      await queueIfBusy(first.run._id);
      await queueIfBusy(second.run._id);
      await sweepJobs();
      expect((await JobRun.findById(second.run._id).lean())?.status).toBe('running');
      expect(await nextQueuedRunId()).toBe(String(second.run._id));
      await JobRun.updateOne({ _id: first.run._id }, { $set: { status: 'completed' } });
      const claim = await claimJobRunExecution(String(second.run._id));
      expect(claim).not.toBeNull();
      expect(await queueIfBusy(second.run._id)).toBe(false);
      expect((await JobRun.findById(second.run._id).lean())?.queuedAt).toBeUndefined();
      expect(await nextQueuedRunId()).toBeNull();
      await JobRun.deleteMany({});
    });

    it('takes the longest waiting run first, and keeps its place if it has to wait again', async () => {
      const holder = await running(new Date(Date.now() - 120_000));
      await queueIfBusy(holder.run._id);
      const older = await running(new Date(Date.now() - 60_000));
      const newer = await running(new Date());
      await queueIfBusy(older.run._id, new Date(Date.now() - 30_000));
      await queueIfBusy(newer.run._id);
      expect(await nextQueuedRunId()).toBe(String(older.run._id));
      const before = (await JobRun.findById(older.run._id).lean())!.queuedAt;
      await claimJobRunExecution(String(older.run._id));
      expect(await queueIfBusy(older.run._id)).toBe(true);
      expect((await JobRun.findById(older.run._id).lean())?.queuedAt).toEqual(before);
      await JobRun.deleteMany({});
    });

    it('does not let a dead run block the queue', async () => {
      const dead = await running(new Date(Date.now() - 60_000), { queueSlot: true, leaseExpiresAt: new Date(Date.now() - 1000) });
      const next = await running(new Date());
      expect(await queueIfBusy(next.run._id)).toBe(false);
      await JobRun.deleteOne({ _id: dead.run._id });
      await JobRun.deleteMany({});
    });

    it('queues a real run without doing any work or waking itself, then wakes the next when one finishes', async () => {
      process.env.CRON_SECRET = 'test-cron';
      const realFetch = globalThis.fetch;
      const wakes = vi.fn<typeof fetch>(async () => new Response('{}'));
      globalThis.fetch = wakes;
      try {
        const holder = await running(new Date(Date.now() - 60_000));
        await queueIfBusy(holder.run._id);
        const job = await proposed(DESIGN);
        mocks.chat.mockClear();
        mocks.chat.mockImplementation(async () => ({ requestId: 'test', role: 'assistant', text: GOOD, costMicros: 0 }));
        const approved = await approveJob(admin, job.id, { completion: 'review' });
        await executeJobRun(approved.dryRunId!);
        expect(mocks.chat).not.toHaveBeenCalled();
        expect(wakes).not.toHaveBeenCalled();
        expect((await JobRun.findById(approved.dryRunId).lean())?.queuedAt).toBeDefined();
        await JobRun.updateOne({ _id: holder.run._id }, { $set: { status: 'completed' } });
        await executeJobRun(approved.dryRunId!);
        expect(mocks.chat).toHaveBeenCalled();
        expect((await JobRun.findById(approved.dryRunId).lean())?.status).not.toBe('running');
      } finally {
        globalThis.fetch = realFetch;
        delete process.env.CRON_SECRET;
        await JobRun.deleteMany({});
      }
    });

    it('wakes the queue only when something is waiting', async () => {
      process.env.CRON_SECRET = 'test-cron';
      try {
        const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'));
        await wakeJobQueue(fetcher);
        expect(fetcher).not.toHaveBeenCalled();
        const first = await running(new Date(Date.now() - 60_000));
        const second = await running(new Date());
        await queueIfBusy(first.run._id);
        await queueIfBusy(second.run._id);
        await wakeJobQueue(fetcher);
        expect(String(fetcher.mock.calls[0]?.[0])).toContain('/api/cron/job-queue');
        await expect(wakeJobQueue(vi.fn<typeof fetch>(async () => { throw new Error('offline'); }))).resolves.toBeUndefined();
        await JobRun.deleteMany({});
      } finally {
        delete process.env.CRON_SECRET;
      }
    });
  });

  describe('free model legwork on a Spotlight run', () => {
    const free = { model: 'local', profileId: 'a'.repeat(24), free: true };
    const bare = JSON.stringify({ records: [], summary: 'Nobody', gaps: [] });
    const planner = JSON.stringify({ source: 'Bluesky', discovery: 'Find profiles', rationale: 'Rarest first' });
    const answer = (text: string, toolsUsed: string[] = []) => ({ requestId: 'test', role: 'assistant', text, costMicros: 0, toolsUsed });
    const saved = () => ResearchEvidence.create({ organizationId: admin.organizationId, companyId, skill: 'signature_outreach', domain: 'transistor.com', name: 'Transistor', website: 'https://transistor.com/', pageStatus: 'opened', checkedAt: new Date(), facts: [{ field: 'bluesky', value: 'https://bsky.app/profile/transistor.com', source: 'https://transistor.com/', method: 'Link found on the official homepage in a real browser' }] });

    beforeEach(() => { process.env.NUCLEAS_BROWSER_WORKER_URL = 'https://worker.test'; process.env.NUCLEAS_BROWSER_WORKER_SECRET = 'test-secret'; });
    afterEach(async () => {
      delete process.env.NUCLEAS_BROWSER_WORKER_URL;
      delete process.env.NUCLEAS_BROWSER_WORKER_SECRET;
      search.hits = [{ provider: 'searxng' }];
      await ResearchEvidence.deleteMany({});
    });

    it('gives each saved lead a small job, saves what checks out, and passes it on', async () => {
      await saved();
      const job = await proposed({ ...DESIGN, skill: 'signature_outreach' });
      mocks.select.mockResolvedValue({ primary: free, fallback: null });
      mocks.browser.mockImplementation(async (url: string) => ({ url, text: 'x', plainText: 'Email hello@transistor.com any time', links: [] }));
      const prompts: string[] = [];
      mocks.chat.mockImplementation(async ({ systemPrompt, userText }) => {
        prompts.push(userText);
        if (systemPrompt.startsWith('Choose a concrete')) return answer(planner);
        if (systemPrompt.startsWith('Scout public') && userText.includes('Check one company')) return answer(JSON.stringify({ contact_source: 'https://transistor.com/contact', email: 'hello@transistor.com', team_source: 'https://transistor.com/about', team_quote: 'A made up quote' }), ['web_fetch']);
        return answer(bare, ['web_fetch']);
      });
      const approved = await approveJob(admin, job.id, { completion: 'review' });
      await executeJobRun(approved.dryRunId!);
      const lead = await ResearchEvidence.findOne({ domain: 'transistor.com' }).lean();
      expect(lead?.facts?.map((fact) => fact.field)).toEqual(['bluesky', 'email']);
      const run = await JobRun.findById(approved.dryRunId).lean();
      expect(run?.researchProgress).toMatchObject({ verified: 1, recalled: 1, searchDown: false });
      expect(prompts.find((text) => text.includes('Check one company'))?.length).toBeLessThan(1500);
      expect(prompts.some((text) => text.includes('Anything under verified was confirmed') && text.includes('hello@transistor.com'))).toBe(true);
      const step = (run?.modelPath as { outcome?: string }[]).find((entry) => entry.outcome?.includes('Confirmed by Nucleas'));
      expect(step?.outcome).toContain('Not confirmed, team: the quote is not on that page');
    });

    it('tells a free model that opened nothing, and gives it one more try', async () => {
      const job = await proposed({ ...DESIGN, skill: 'signature_outreach' });
      mocks.select.mockResolvedValue({ primary: free, fallback: null });
      const pushes: string[] = [];
      mocks.chat.mockImplementation(async ({ systemPrompt, userText }) => {
        if (systemPrompt.startsWith('Choose a concrete')) return answer(planner);
        if (userText.includes('You answered without opening any page')) { pushes.push(userText); return answer(bare, ['web_fetch']); }
        return answer(bare, ['web_search']);
      });
      const approved = await approveJob(admin, job.id, { completion: 'review' });
      await executeJobRun(approved.dryRunId!);
      expect(pushes.length).toBeGreaterThan(0);
    });

    it('survives an unreadable reply and still gives the next attempt its turn', async () => {
      const paid = { model: 'paid-research', profileId: 'b'.repeat(24), free: false };
      const job = await proposed({ ...DESIGN, skill: 'signature_outreach' });
      await Job.updateOne({ _id: job.id }, { $set: { level: 'medium' } });
      mocks.select.mockResolvedValue({ primary: free, fallback: paid });
      mocks.chat.mockImplementation(async ({ systemPrompt, model }) => {
        if (systemPrompt.startsWith('Choose a concrete')) return answer(planner);
        if (systemPrompt.startsWith('Scout public')) return answer('{"candidates":[]}', ['web_fetch']);
        if (model === paid.model) return answer(bare, ['web_fetch']);
        return answer(mocks.chat.mock.calls.length > 4 ? '{"records": [{"values": {}}, "summary": "broken"}' : bare, ['web_fetch']);
      });
      const approved = await approveJob(admin, job.id, { completion: 'review' });
      await executeJobRun(approved.dryRunId!);
      expect(mocks.chat.mock.calls.some(([input]) => input.model === paid.model)).toBe(true);
      const run = await JobRun.findById(approved.dryRunId).lean();
      expect(run?.error).not.toContain('failed output validation');
    });

    it('says when search is down', async () => {
      search.hits = [{ provider: 'wikipedia' }];
      const job = await proposed({ ...DESIGN, skill: 'signature_outreach' });
      mocks.select.mockResolvedValue({ primary: free, fallback: null });
      mocks.chat.mockImplementation(async ({ systemPrompt }) => answer(systemPrompt.startsWith('Choose a concrete') ? planner : bare, ['web_fetch']));
      const approved = await approveJob(admin, job.id, { completion: 'review' });
      await executeJobRun(approved.dryRunId!);
      expect((await JobRun.findById(approved.dryRunId).lean())?.researchProgress).toMatchObject({ searchDown: true });
    });
  });

  it('keeps what workers screened when a Spotlight run finds nobody, but only from calls that opened pages', async () => {
    process.env.NUCLEAS_BROWSER_WORKER_URL = 'https://worker.test';
    process.env.NUCLEAS_BROWSER_WORKER_SECRET = 'test-secret';
    try {
      const job = await proposed({ ...DESIGN, skill: 'signature_outreach' });
      const free = { model: 'local', profileId: 'a'.repeat(24), free: true };
      mocks.select.mockResolvedValue({ primary: free, fallback: null });
      mocks.browser.mockImplementation(async (url: string) => ({ url, title: 'Site', text: 'x'.repeat(400), note: '', images: [], links: [`${url}about`, 'https://bsky.app/profile/company.com', `${url}pricing`] }));
      const screened = (name: string, website: string) => JSON.stringify({ records: [], summary: 'Nobody qualified', gaps: [], screened: [{ name, website, checked: [website], gap: 'No growth evidence' }] });
      let attempts = 0;
      mocks.chat.mockImplementation(async ({ systemPrompt }) => {
        if (systemPrompt.startsWith('Choose a concrete')) return { requestId: 'test', role: 'assistant', text: JSON.stringify({ source: 'Bluesky', discovery: 'Find profiles', rationale: 'Rarest first' }), costMicros: 0 };
        if (systemPrompt.startsWith('Scout public')) return { requestId: 'test', role: 'assistant', text: 'No candidates yet.', costMicros: 0, toolsUsed: ['web_search'] };
        attempts += 1;
        // The first call opened pages. The next only searched, so what it claims is repeating what it was told.
        return attempts === 1
          ? { requestId: 'test', role: 'assistant', text: screened('Buttondown', 'https://buttondown.com/'), costMicros: 0, toolsUsed: ['web_search', 'web_fetch'] }
          : { requestId: 'test', role: 'assistant', text: screened('Plausible', 'https://plausible.io/'), costMicros: 0, toolsUsed: ['web_search'] };
      });
      const approved = await approveJob(admin, job.id, { completion: 'review' });
      await executeJobRun(approved.dryRunId!);
      const saved = await ResearchEvidence.find({ skill: 'signature_outreach' }).lean();
      expect(saved.map((row) => row.domain)).toEqual(['buttondown.com']);
      expect(saved[0]).toMatchObject({ qualificationGap: 'No growth evidence', pageStatus: 'opened', facts: expect.arrayContaining([expect.objectContaining({ field: 'bluesky' })]) });
      const retry = mocks.chat.mock.calls.map(([input]) => input.userText as string).find((text) => text.includes('Prospect search retry'));
      expect(retry).toContain('Already screened this run and saved, so find others: Buttondown');
      expect(retry).toContain('Finish verifying these saved leads');
      expect(retry).toContain('https://buttondown.com/');
      const run = await JobRun.findById(approved.dryRunId).lean();
      expect(run?.researchProgress).toMatchObject({ discovered: 1, opened: 1, needsCheck: 1 });
    } finally {
      delete process.env.NUCLEAS_BROWSER_WORKER_URL;
      delete process.env.NUCLEAS_BROWSER_WORKER_SECRET;
      await ResearchEvidence.deleteMany({});
    }
  });

  it('lets a paid model rescue link building when the free attempts end with nothing, but never at the Free level', async () => {
    const free = { profileId: 'f'.repeat(24), model: 'free-worker', free: true, label: 'Rogly' };
    const paid = { profileId: 'p'.repeat(24), model: 'paid-reviewer', free: false, label: 'OpenAI', blendedPricePer1M: 0.1 };
    mocks.models.mockResolvedValue([free, paid]);
    mocks.select.mockImplementation(async (_org: string, need: string, level: string) => ({ primary: need === 'review' && level !== 'free' ? paid : free, fallback: null }));
    const values = { ...JSON.parse(GOOD).records[0].values, opportunity_url: 'https://directory.example/page', relevance_score: 90,
      relevance_evidence: 'A directly relevant gaming directory with a visible free submission flow and exact evidence on the page.',
      strategy_evidence: 'The approved strategy prioritizes games directories that reach this same audience and match the target page.' };
    const models: string[] = [];
    mocks.chat.mockImplementation(async (input: { systemPrompt: string; model: string }) => {
      if (input.systemPrompt.startsWith('You check one run')) return { requestId: 'review', role: 'assistant', text: '{"verdict":"pass","notes":"Sourced."}', costMicros: 0 };
      models.push(input.model);
      // The free model keeps naming a dead page; the paid one finds a real one.
      const found = { ...values, opportunity_url: input.model === paid.model ? 'https://directory.example/real' : 'https://directory.example/dead' };
      return { requestId: 'work', role: 'assistant', costMicros: 0, toolsUsed: ['web_fetch'], text: JSON.stringify({ records: [{ values: found, sources: [found.opportunity_url] }], summary: `From ${input.model}`, gaps: [] }) };
    });
    mocks.verify.mockImplementation(async (input: { url: string }) => (input.url.endsWith('/real') ? { hard: [], soft: [] } : { hard: ['HTTP 404'], soft: [], missing: true }));

    const job = await proposed({ ...DESIGN, skill: 'link_building' });
    await Job.updateOne({ _id: job.id }, { $set: { level: 'low' } });
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    const run = await JobRun.findById(approved.dryRunId).lean();
    expect(models[0]).toBe(free.model);
    expect(models).toContain(paid.model);
    expect(run?.status).toBe('needs_review');
    expect(run?.output?.summary).toBe(`From ${paid.model}`);

    models.length = 0;
    mocks.verify.mockImplementation(async () => ({ hard: ['HTTP 404'], soft: [], missing: true }));
    const freeJob = await proposed({ ...DESIGN, skill: 'link_building' });
    await Job.updateOne({ _id: freeJob.id }, { $set: { level: 'free' } });
    const freeRun = await approveJob(admin, freeJob.id, { completion: 'review' });
    await executeJobRun(freeRun.dryRunId!);
    expect(models).not.toContain(paid.model);
    expect((await JobRun.findById(freeRun.dryRunId).lean())?.status).toBe('failed');
  });

  it('bounds failed discovery and waits for the next scheduled check without delivering dead pages', async () => {
    const job = await proposed({ ...DESIGN, skill: 'link_building', schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' } });
    await Job.updateOne({ _id: job.id }, { $set: { status: 'active', nextRunAt: new Date(Date.now() + 86400000) } });
    const values = { ...JSON.parse(GOOD).records[0].values, opportunity_url: 'https://directory.example/missing', relevance_score: 90,
      relevance_evidence: 'A directly relevant gaming directory with a visible free submission flow and exact evidence on the page.',
      strategy_evidence: 'The approved strategy prioritizes games directories that reach this same audience and match the target page.' };
    mocks.chat.mockResolvedValue({ requestId: 'dead', role: 'assistant', costMicros: 0, text: JSON.stringify({ records: [{ values, sources: [values.opportunity_url] }], summary: 'Claimed live.', gaps: [] }) });
    mocks.verify.mockResolvedValue({ hard: ['HTTP 404'], soft: [], missing: true });
    for (let attempt = 0; attempt < 3; attempt++) {
      await Job.updateOne({ _id: job.id }, { $set: { nextRunAt: new Date(Date.now() + 86400000) } });
      const started = await runNow(admin, job.id);
      await executeJobRun(started.runId!);
      const run = await JobRun.findById(started.runId).lean();
      expect(run).toMatchObject({ status: 'failed', error: expect.stringContaining('No verified link-building opportunity') });
      expect(run?.output).toBeUndefined();
      const parent = await Job.findById(job.id).lean();
      expect(parent!.nextRunAt!.getTime() - Date.now()).toBeGreaterThan(0);
      expect(parent!.nextRunAt!.getTime() - Date.now()).toBeLessThanOrEqual(86400000);
      expect(parent!.nextRunAt!.toISOString()).toMatch(/T09:00:00\.000Z$/);
    }
    expect(await LinkOpportunity.countDocuments({ status: 'recommended' })).toBe(0);
    expect(await LinkOpportunity.countDocuments({ status: 'nonexistent' })).toBe(1);
    expect(mocks.verify).toHaveBeenCalledTimes(1);
  });
  it('tracks link recommendations through approval and submission with feedback history', async () => {
    mocks.models.mockResolvedValue([{ profileId: 'r'.repeat(24), model: 'gpt-6-sol', free: false, blendedPricePer1M: 0.01 }]);
    const config = { projectId, schedule: { kind: 'daily', time: '09:00', timezone: 'America/Chicago' }, recordsPerRun: 1, country: 'United States', language: 'English', exclusions: '' };
    const created = await createTemplateJob(admin, { companyId, template: 'link_building', config });
    if (!created.ok) throw new Error(created.error);
    mocks.chat.mockImplementation(async (input: { systemPrompt: string }) => input.systemPrompt.startsWith('You check one run')
      ? { requestId: 'r', role: 'assistant', text: '{"verdict":"pass","notes":"Sourced."}', costMicros: 0 }
      : { requestId: 'w', role: 'assistant', text: JSON.stringify({ records: [{ values: { strategic_reason: 'A new page needs authority.', strategy_evidence: 'The games page is a newly launched priority page in the approved brief and currently has no directory citations.', opportunity_url: 'https://directory.example.org/submit', opportunity_type: 'Directory', relevance_score: 90, relevance_evidence: 'The directory exclusively catalogs video games and is used by players searching for games and community servers.', estimated_authority: 'Medium estimate', authority_basis: 'Indexed and used by peers.', target_keywords: ['games'], target_url: 'https://playbound.club/games', anchor_text: 'PlayBound games', submission_copy: 'A useful directory description.', requirements: 'Free account.', link_attribute: 'unknown', quality_risk: 'Relevant and moderated.', confidence: 'Medium', next_action: 'Submit the listing.' }, sources: ['https://directory.example.org/submit'] }], summary: 'Found one.', gaps: [] }), costMicros: 0 });

    const approved = await approveJob(admin, created.job.id, { completion: 'review' });
    expect(approved.ok && approved.job).toMatchObject({
      status: 'testing',
      runs: [{ status: 'running', progressState: { stage: 'preparing', percent: 5, label: 'Preparing the dry run' } }],
    });
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

  it('renames a job for managers only, with a sensible name, and records it', async () => {
    const config = { projectId, schedule: { kind: 'daily' as const, time: '09:00', timezone: 'UTC' }, recordsPerRun: 1, country: 'United States', language: 'English', exclusions: '' };
    const created = await createTemplateJob(admin, { companyId, template: 'link_building', config });
    if (!created.ok) throw new Error(created.error);
    const before = created.job.design?.title;
    expect(before).toBeTruthy();

    expect(await renameJob(admin, created.job.id, '  Frugal   Gambler backlinks  ')).toMatchObject({ ok: true, job: { design: { title: 'Frugal Gambler backlinks' } } });
    expect((await Job.findById(created.job.id).lean())?.events?.some((e) => e.action === 'renamed' && e.note === 'Frugal Gambler backlinks')).toBe(true);
    expect((await getJob(admin, created.job.id))?.design?.skill).toBe('link_building');

    expect(await renameJob(admin, created.job.id, 'ab')).toMatchObject({ ok: false, status: 400 });
    expect(await renameJob(admin, created.job.id, 'x'.repeat(121))).toMatchObject({ ok: false, status: 400 });
    expect(await renameJob(admin, created.job.id, 42)).toMatchObject({ ok: false, status: 400 });
    expect(await renameJob({ ...admin, role: 'User' }, created.job.id, 'A fine name')).toMatchObject({ ok: false, status: 403 });
    expect(await renameJob(admin, 'not-an-id', 'A fine name')).toMatchObject({ ok: false, status: 404 });
    expect((await getJob(admin, created.job.id))?.design?.title).toBe('Frugal Gambler backlinks');
  });

  it('keeps recurring link building scheduled while earlier recommendations await review', async () => {
    mocks.models.mockResolvedValue([{ profileId: 'r'.repeat(24), model: 'gpt-6-sol', free: false, blendedPricePer1M: 0.01 }]);
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
  it('recovers Voice output without a records wrapper and keeps it for human review', async () => {
    await Client.updateOne({ _id: companyId }, { $unset: { domain: '' } });
    const created = await createTemplateJob(admin, { companyId, template: 'brand_voice', config: {} });
    if (!created.ok) throw new Error(created.error);
    const approved = await approveJob(admin, created.job.id, { completion: 'automatic' });
    mocks.chat.mockResolvedValueOnce({ role: 'assistant', text: JSON.stringify({ brand_profile: { positioning: { primary: 'Practical game discovery.' }, audienceRelationship: { style: 'Fellow players' }, rhetoricalPatterns: ['Start with a concrete reason to play.'] }, sources: ['https://playbound.club/'] }), costMicros: 0 });
    await executeJobRun(approved.dryRunId!);
    expect((await getJob(admin, created.job.id))?.runs[0]).toMatchObject({ status: 'needs_review', issues: [], output: { records: [{ values: { brand_profile: { positioning: { primary: 'Practical game discovery.' } } } }] } });
    expect(mocks.chat.mock.calls[0][0].maxOutputTokensOverride).toBe(6000);
  });

  it('gives a Voice no spending cap, and still caps other jobs', async () => {
    await Client.updateOne({ _id: companyId }, { $unset: { domain: '' } });
    const created = await createTemplateJob(admin, { companyId, template: 'brand_voice', config: {} });
    if (!created.ok) throw new Error(created.error);
    // Even a budget sent with the approval is ignored: a voice is generated once.
    const approved = await approveJob(admin, created.job.id, { completion: 'review', monthlyBudgetMicros: 100 });
    expect(approved).toMatchObject({ ok: true });
    expect(await getJob(admin, created.job.id)).toMatchObject({ monthlyBudgetMicros: 0 });
    mocks.chat.mockResolvedValueOnce({ role: 'assistant', text: JSON.stringify({ brand_profile: { positioning: { primary: 'Practical game discovery.' }, audienceRelationship: { style: 'Fellow players' }, rhetoricalPatterns: ['Start with a concrete reason to play.'] }, sources: ['https://playbound.club/'] }), costMicros: 5_000_000 });
    await executeJobRun(approved.dryRunId!);
    const run = (await getJob(admin, created.job.id))?.runs[0];
    expect(run?.status).toBe('needs_review');
    expect(run?.error ?? '').not.toContain('monthly budget');
  });

  it('gives a Marketing plan no spending cap either', async () => {
    const created = await createTemplateJob(admin, { companyId, template: 'marketing_plan', config: { companyName: 'PlayBound' } });
    if (!created.ok) throw new Error(created.error);
    expect(await approveJob(admin, created.job.id, { completion: 'review', monthlyBudgetMicros: 100 })).toMatchObject({ ok: true });
    expect(await getJob(admin, created.job.id)).toMatchObject({ monthlyBudgetMicros: 0 });
  });

  it('never schedules Voice or Marketing overview, even with legacy recurring settings', async () => {
    for (const template of ['brand_voice', 'marketing_plan'] as const) {
      const created = await createTemplateJob(admin, { companyId, template, config: { companyName: 'PlayBound' } });
      if (!created.ok) throw new Error(created.error);
      await Job.updateOne({ _id: created.job.id }, { $set: { 'design.schedule': { kind: 'daily', time: '09:00', timezone: 'UTC' }, status: 'active', nextRunAt: new Date(0) } });
    }
    expect(await claimDueJobRuns()).toEqual([]);
    const job = await Job.findOne({ 'design.skill': 'brand_voice' });
    await Job.updateOne({ _id: job!._id }, { $set: { status: 'proposed' } });
    expect(await approveJob(admin, String(job!._id), { completion: 'automatic' })).toMatchObject({ ok: true, job: { completion: 'review', design: { schedule: { kind: 'once' } } } });
  });

  it('passes the approved Voice to both the content worker and reviewer', async () => {
    const persona = 'Write like a fellow player: practical, specific, and clear about what makes each game worth trying.';
    expect(await updateBrandVoice(admin, companyId, { persona, examples: '', status: 'approved', revision: 0 })).toMatchObject({ ok: true });
    const job = await proposed({ ...DESIGN, category: 'content' });
    const approved = await approveJob(admin, job.id, { completion: 'review' });
    await executeJobRun(approved.dryRunId!);
    expect(mocks.chat.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [input] of mocks.chat.mock.calls) expect(input.userText).toContain(persona);
  });

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
