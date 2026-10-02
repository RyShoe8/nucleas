import 'server-only';
import { Types } from 'mongoose';
import { Job, JobRun, type JobRunProgressStage, type JobRunStatus, type JobStatus } from '@/lib/models/Job';
import { getCompanyProfile, isCompanyManager, listCompanyProfiles, type CompanyViewer } from '@/lib/companies/companyProfile';
import { readEngineSettings, type CostLevel } from '@/lib/ai/engine/select';
import type { ProgressFn } from '@/lib/ai/progress';
import { designJob } from './designer';
import { executeJobRun, monthSpendMicros } from './runner';
import { DELIVERY_LABEL, RUNNABLE_DELIVERY, jobDesignSchema, type JobDesign, type JobRunOutput, type RecordIssue } from './schema';
import { nextScheduledAt } from './schedule';
import { linkBuildingConfigSchema, linkBuildingDesign } from './templates/linkBuilding';
import { seoBriefConfigSchema, seoBriefDesign } from './templates/seoBrief';
import { approvedSeoBrief, saveGeneratedSeoBrief } from './seoBriefs';
import Project from '@/lib/models/Project';
import { bulkDecideRunOpportunities, listLinkOpportunities, type LinkOpportunityView } from './linkOpportunities';

/**
 * Jobs: Nucleas designs them, a manager approves them (choosing review or automatic completion and
 * a monthly budget), a dry run shows a sample, then real runs deliver results.
 */

const OPEN: JobStatus[] = ['designing', 'needs_answers', 'proposed', 'testing', 'ready', 'active', 'paused', 'failed'];
const STUCK_MS = 20 * 60 * 1000;

export interface JobRunView {
  id: string;
  dryRun: boolean;
  status: JobRunStatus;
  startedAt: string;
  finishedAt: string | null;
  progress: string[];
  progressState: { stage: JobRunProgressStage; label: string; percent: number; updatedAt: string };
  output: JobRunOutput | null;
  issues: RecordIssue[];
  review: { verdict: 'pass' | 'fail'; notes: string; model: string } | null;
  costMicros: number;
  error: string | null;
}

export interface JobView {
  id: string;
  companyId: string;
  projectId: string | null;
  companyName: string;
  status: JobStatus;
  request: string;
  design: JobDesign | null;
  answers: Record<string, { option?: string; text?: string }>;
  completion: 'review' | 'automatic' | null;
  level: CostLevel | null;
  monthlyBudgetMicros: number;
  spentThisMonthMicros: number;
  deliveryLabel: string | null;
  /** The chosen delivery method can run today (others need their one-time setup first). */
  deliveryRunnable: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  error: string | null;
  runs: JobRunView[];
  canManage: boolean;
  opportunities: LinkOpportunityView[];
}

type JobLean = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  companyId: Types.ObjectId;
  projectId?: Types.ObjectId;
  createdByUserId: Types.ObjectId;
  status: JobStatus;
  request: string;
  design?: unknown;
  answers?: Record<string, { option?: string; text?: string }>;
  completion?: 'review' | 'automatic';
  level?: CostLevel;
  monthlyBudgetMicros?: number;
  designCostMicros?: number;
  createdAt: Date;
  updatedAt: Date;
  lastRunAt?: Date;
  nextRunAt?: Date;
  error?: string;
};

type RunLean = {
  _id: Types.ObjectId;
  jobId: Types.ObjectId;
  dryRun: boolean;
  status: JobRunStatus;
  startedAt: Date;
  finishedAt?: Date;
  progress?: string[];
  progressState?: { stage: JobRunProgressStage; label: string; percent: number; updatedAt: Date };
  output?: JobRunOutput;
  issues?: RecordIssue[];
  review?: { verdict: 'pass' | 'fail'; notes: string; model: string };
  costMicros?: number;
  error?: string;
};

function runView(r: RunLean): JobRunView {
  const terminal = r.status !== 'running';
  const fallbackLabel = r.status === 'needs_review' ? 'Ready for review' : r.status === 'completed' ? 'Complete' : r.status === 'failed' ? 'Stopped' : r.status === 'rejected' ? 'Rejected' : r.progress?.at(-1) ?? 'Starting';
  const progressState = r.progressState ?? { stage: terminal ? 'complete' : 'preparing', label: fallbackLabel, percent: terminal ? 100 : 5, updatedAt: r.finishedAt ?? r.startedAt };
  return {
    id: String(r._id),
    dryRun: r.dryRun,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    progress: r.progress ?? [],
    progressState: { ...progressState, updatedAt: progressState.updatedAt.toISOString() },
    output: r.output ?? null,
    issues: r.issues ?? [],
    review: r.review?.verdict ? r.review : null,
    costMicros: r.costMicros ?? 0,
    error: r.error ?? null,
  };
}

async function toView(job: JobLean, companyName: string, canManage: boolean, runs: RunLean[]): Promise<JobView> {
  const parsed = jobDesignSchema.safeParse(job.design);
  const design = parsed.success ? parsed.data : null;
  return {
    id: String(job._id),
    companyId: String(job.companyId),
    projectId: job.projectId ? String(job.projectId) : null,
    companyName,
    status: job.status,
    request: job.request,
    design,
    answers: job.answers ?? {},
    completion: job.completion ?? null,
    level: job.level ?? null,
    monthlyBudgetMicros: job.monthlyBudgetMicros ?? 0,
    spentThisMonthMicros: (await monthSpendMicros(job._id)) + (job.createdAt >= new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)) ? job.designCostMicros ?? 0 : 0),
    deliveryLabel: design ? DELIVERY_LABEL[design.delivery.method] : null,
    deliveryRunnable: design ? RUNNABLE_DELIVERY.includes(design.delivery.method) : false,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    lastRunAt: job.lastRunAt?.toISOString() ?? null,
    nextRunAt: job.nextRunAt?.toISOString() ?? null,
    error: job.error ?? null,
    runs: runs.map(runView),
    canManage,
    opportunities: design?.skill === 'link_building' ? await listLinkOpportunities(job._id) : [],
  };
}

function event(viewer: CompanyViewer | null, action: string, note?: string) {
  return { at: new Date(), userId: viewer ? new Types.ObjectId(viewer.userId) : undefined, action, ...(note ? { note: note.slice(0, 500) } : {}) };
}

// ---------- Reading ----------

export async function listJobs(viewer: CompanyViewer, options: { includeClosed?: boolean; companyId?: string } = {}): Promise<JobView[]> {
  const companies = await listCompanyProfiles(viewer);
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const allowed = companies.map((c) => new Types.ObjectId(c.id)).filter((id) => !options.companyId || String(id) === options.companyId);
  const jobs = await Job.find({ organizationId: viewer.organizationId, companyId: { $in: allowed }, ...(options.includeClosed ? {} : { status: { $in: [...OPEN, 'done'] } }) })
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean<JobLean[]>();
  const runs = await JobRun.find({ jobId: { $in: jobs.map((j) => j._id) } })
    .sort({ createdAt: -1 })
    .lean<RunLean[]>();
  const byJob = new Map<string, RunLean[]>();
  for (const r of runs) {
    const list = byJob.get(String(r.jobId)) ?? [];
    if (list.length < 5) byJob.set(String(r.jobId), [...list, r]);
  }
  const canManage = isCompanyManager(viewer);
  return Promise.all(jobs.map((j) => toView(j, names.get(String(j.companyId)) ?? 'Company', canManage, byJob.get(String(j._id)) ?? [])));
}

export async function getJob(viewer: CompanyViewer, id: string): Promise<JobView | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const job = await Job.findOne({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }).lean<JobLean>();
  if (!job) return null;
  const profile = await getCompanyProfile(viewer, String(job.companyId));
  if (!profile) return null;
  const runs = await JobRun.find({ jobId: job._id }).sort({ createdAt: -1 }).limit(20).lean<RunLean[]>();
  return toView(job, profile.name, isCompanyManager(viewer), runs);
}

// ---------- Designing ----------

export type CreateResult = { ok: true; job: JobView } | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/** Creates a job from a request and designs it (Nucleas investigates, then designs or asks). */
export async function createJob(
  viewer: CompanyViewer,
  input: { companyId: string; request: string; level?: CostLevel; signal?: AbortSignal; onProgress?: ProgressFn; background?: boolean }
): Promise<CreateResult> {
  const request = input.request.trim();
  if (request.length < 10 || request.length > 6000) return { ok: false, status: 400, error: 'Describe the job in 10–6000 characters.' };
  const profile = await getCompanyProfile(viewer, input.companyId);
  if (!profile) return { ok: false, status: 404, error: 'Company not found.' };
  const level = input.level ?? (await readEngineSettings(String(viewer.organizationId))).defaultCostLevel;
  const doc = await Job.create({
    organizationId: viewer.organizationId,
    companyId: new Types.ObjectId(input.companyId),
    createdByUserId: new Types.ObjectId(viewer.userId),
    status: 'designing',
    request,
    level,
    events: [event(viewer, 'requested')],
  });
  // In the background the route hands runDesign to after(), so the response can return at once.
  if (!input.background) await runDesign(viewer, String(doc._id), { signal: input.signal, onProgress: input.onProgress });
  const view = await getJob(viewer, String(doc._id));
  return view ? { ok: true, job: view } : { ok: false, status: 404, error: 'Job not found.' };
}

/** Creates a reviewed first-party skill job without spending a model call redesigning known instructions. */
export async function createTemplateJob(
  viewer: CompanyViewer,
  input: { companyId: string; template: 'link_building' | 'seo_brief'; config: unknown; level?: CostLevel }
): Promise<CreateResult> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can configure skills.' };
  const profile = await getCompanyProfile(viewer, input.companyId);
  if (!profile) return { ok: false, status: 404, error: 'Company not found.' };
  const parsed = input.template === 'link_building' ? linkBuildingConfigSchema.safeParse(input.config) : seoBriefConfigSchema.safeParse(input.config);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? 'Invalid skill settings.' };
  const project = await Project.findOne({ _id: parsed.data.projectId, clientId: new Types.ObjectId(input.companyId) }).select('name').lean<{ _id: Types.ObjectId; name: string }>();
  if (!project) return { ok: false, status: 404, error: 'Project not found for this company.' };
  if (input.template === 'link_building' && !(await approvedSeoBrief(viewer.organizationId, new Types.ObjectId(input.companyId), project._id))) {
    return { ok: false, status: 409, error: `Create and approve the SEO brief for ${project.name} before configuring link building.` };
  }
  const existing = await Job.exists({
    organizationId: viewer.organizationId,
    companyId: new Types.ObjectId(input.companyId),
    projectId: project._id,
    'design.skill': input.template,
    status: { $nin: ['rejected', 'archived', 'done'] },
  });
  if (existing) return { ok: false, status: 409, error: `${project.name} already has an open ${input.template === 'link_building' ? 'Link Building job' : 'SEO brief job'}. Open it to review or archive it.` };
  const level = input.level ?? (await readEngineSettings(String(viewer.organizationId))).defaultCostLevel;
  const design = input.template === 'link_building'
    ? linkBuildingDesign(parsed.data as ReturnType<typeof linkBuildingConfigSchema.parse>)
    : seoBriefDesign({ ...(parsed.data as ReturnType<typeof seoBriefConfigSchema.parse>), projectName: project.name });
  const doc = await Job.create({
    organizationId: viewer.organizationId,
    companyId: new Types.ObjectId(input.companyId),
    projectId: project._id,
    createdByUserId: new Types.ObjectId(viewer.userId),
    status: 'proposed',
    request: input.template === 'link_building' ? `Find the best free, self-service link-building opportunities for ${project.name}.` : `Create an SEO brief for ${project.name}.`,
    design,
    level,
    designCostMicros: 0,
    events: [event(viewer, 'skill_configured', input.template)],
  });
  const view = await getJob(viewer, String(doc._id));
  return view ? { ok: true, job: view } : { ok: false, status: 404, error: 'Job not found.' };
}

/** Designs (or redesigns with the person's answers) a job that is in 'designing'. */
export async function runDesign(viewer: CompanyViewer, jobId: string, options: { signal?: AbortSignal; onProgress?: ProgressFn } = {}): Promise<void> {
  const job = await Job.findById(jobId).lean<JobLean>();
  if (!job) return;
  const previous = jobDesignSchema.safeParse(job.design);
  const result = await designJob(viewer, {
    companyId: String(job.companyId),
    request: job.request,
    level: job.level ?? 'low',
    answers: job.answers,
    previous: previous.success ? { design: previous.data, questions: previous.data.questions } : undefined,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  if (!result.ok) {
    await Job.updateOne({ _id: job._id }, { $set: { status: 'failed', error: result.error }, $inc: { designCostMicros: result.costMicros }, $push: { events: event(null, 'design_failed', result.error) } });
    return;
  }
  const status: JobStatus = result.design.questions.length ? 'needs_answers' : 'proposed';
  await Job.updateOne(
    { _id: job._id },
    {
      $set: { status, design: result.design, error: null },
      $inc: { designCostMicros: result.costMicros },
      $push: { events: event(null, status === 'needs_answers' ? 'questions_asked' : 'designed') },
    }
  );
}

// ---------- Decisions ----------

export type ActionResult = { ok: true; job: JobView } | { ok: false; status: 400 | 403 | 404 | 409; error: string };

async function managed(viewer: CompanyViewer, id: string, options: { anyMember?: boolean } = {}): Promise<{ ok: true; job: JobLean } | { ok: false; status: 403 | 404; error: string }> {
  if (!options.anyMember && !isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers and administrators can decide on jobs.' };
  if (!Types.ObjectId.isValid(id)) return { ok: false, status: 404, error: 'Job not found.' };
  const job = await Job.findOne({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }).lean<JobLean>();
  if (!job || !(await getCompanyProfile(viewer, String(job.companyId)))) return { ok: false, status: 404, error: 'Job not found.' };
  return { ok: true, job };
}

async function done(viewer: CompanyViewer, id: string): Promise<ActionResult> {
  const view = await getJob(viewer, id);
  return view ? { ok: true, job: view } : { ok: false, status: 404, error: 'Job not found.' };
}

/** Moves a job only from the expected states, so double clicks and races do nothing. */
async function transition(viewer: CompanyViewer, job: JobLean, from: JobStatus[], set: Record<string, unknown>, action: string, note?: string): Promise<ActionResult> {
  const updated = await Job.findOneAndUpdate({ _id: job._id, status: { $in: from } }, { $set: set, $push: { events: event(viewer, action, note) } }, { new: true });
  if (!updated) return { ok: false, status: 409, error: `This job is ${job.status.replace('_', ' ')}; it cannot be ${action.replace('_', ' ')} now.` };
  return done(viewer, String(job._id));
}

/** Answers the designer's questions; the job is redesigned with them (in the background). */
export async function answerQuestions(viewer: CompanyViewer, id: string, answers: Record<string, { option?: string; text?: string }>): Promise<ActionResult> {
  const found = await managed(viewer, id, { anyMember: true });
  if (!found.ok) return found;
  const clean = Object.fromEntries(
    Object.entries(answers)
      .filter(([k]) => /^[a-z][a-z0-9_]{0,39}$/.test(k))
      .map(([k, v]) => [k, { ...(typeof v.option === 'string' ? { option: v.option.slice(0, 40) } : {}), ...(typeof v.text === 'string' && v.text.trim() ? { text: v.text.trim().slice(0, 1000) } : {}) }])
  );
  if (!Object.keys(clean).length) return { ok: false, status: 400, error: 'Answer at least one question.' };
  // The caller redesigns with runDesign (in after(), from the route).
  return transition(viewer, found.job, ['needs_answers'], { status: 'designing', answers: { ...(found.job.answers ?? {}), ...clean } }, 'answered');
}

/** Approves the design: fixes review vs automatic and the budget, then starts a dry run. */
export async function approveJob(viewer: CompanyViewer, id: string, input: { completion: 'review' | 'automatic'; monthlyBudgetMicros?: number }): Promise<ActionResult & { dryRunId?: string }> {
  const found = await managed(viewer, id);
  if (!found.ok) return found;
  if (input.completion !== 'review' && input.completion !== 'automatic') return { ok: false, status: 400, error: 'Choose review or automatic completion.' };
  const budget = input.monthlyBudgetMicros === undefined ? found.job.monthlyBudgetMicros ?? 2_000_000 : Math.round(input.monthlyBudgetMicros);
  if (!(budget > 0 && budget <= 1_000_000_000)) return { ok: false, status: 400, error: 'Set a monthly budget above $0.' };
  const result = await transition(viewer, found.job, ['proposed'], { status: 'testing', completion: input.completion, monthlyBudgetMicros: budget }, 'approved', input.completion);
  if (!result.ok) return result;
  const startedAt = new Date();
  const run = await JobRun.create({ organizationId: found.job.organizationId, jobId: found.job._id, companyId: found.job.companyId, dryRun: true, status: 'running', startedAt, progress: ['Starting the dry run'], progressState: { stage: 'preparing', label: 'Preparing the dry run', percent: 5, updatedAt: startedAt } });
  return { ...result, dryRunId: String(run._id) };
}

export function rejectJob(viewer: CompanyViewer, id: string, note?: string): Promise<ActionResult> {
  return managed(viewer, id).then((f) => (f.ok ? transition(viewer, f.job, ['needs_answers', 'proposed', 'testing', 'ready', 'failed'], { status: 'rejected' }, 'rejected', note) : f));
}

/** Starts a real run (ready or active jobs whose delivery can run today). */
export async function runNow(viewer: CompanyViewer, id: string): Promise<ActionResult & { runId?: string }> {
  const found = await managed(viewer, id);
  if (!found.ok) return found;
  const design = jobDesignSchema.safeParse(found.job.design);
  if (!design.success) return { ok: false, status: 409, error: 'This job has no design yet.' };
  if (!['ready', 'active'].includes(found.job.status)) return { ok: false, status: 409, error: 'Approve the job and its dry run first.' };
  if (!RUNNABLE_DELIVERY.includes(design.data.delivery.method)) {
    return { ok: false, status: 409, error: `${DELIVERY_LABEL[design.data.delivery.method]} needs its one-time setup first: ${design.data.delivery.setupSteps.join('; ') || 'see the design'}.` };
  }
  if (await JobRun.exists({ jobId: found.job._id, status: 'running' })) return { ok: false, status: 409, error: 'A run is already in progress.' };
  const startedAt = new Date();
  const run = await JobRun.create({ organizationId: found.job.organizationId, jobId: found.job._id, companyId: found.job.companyId, dryRun: false, status: 'running', startedAt, progress: ['Starting'], progressState: { stage: 'preparing', label: 'Preparing the run', percent: 5, updatedAt: startedAt } });
  await Job.updateOne({ _id: found.job._id }, { $set: { lastRunAt: new Date() }, $push: { events: event(viewer, 'run_started') } });
  const view = await done(viewer, id);
  return view.ok ? { ...view, runId: String(run._id) } : view;
}

/** Accepts or rejects a run that is waiting for review. Accepting the dry run readies the job. */
export async function decideRun(viewer: CompanyViewer, jobId: string, runId: string, decision: 'accept' | 'reject', note?: string): Promise<ActionResult> {
  const found = await managed(viewer, jobId);
  if (!found.ok) return found;
  if (!Types.ObjectId.isValid(runId)) return { ok: false, status: 404, error: 'Run not found.' };
  const run = await JobRun.findOneAndUpdate(
    { _id: new Types.ObjectId(runId), jobId: found.job._id, status: 'needs_review' },
    { $set: { status: decision === 'accept' ? 'completed' : 'rejected', decidedByUserId: new Types.ObjectId(viewer.userId), ...(note ? { decisionNote: note.slice(0, 500) } : {}) } },
    { new: true }
  ).lean<RunLean>();
  if (!run) return { ok: false, status: 409, error: 'That run is not waiting for review.' };
  await bulkDecideRunOpportunities(run._id, decision, viewer, note);
  const design = jobDesignSchema.safeParse(found.job.design);
  if (decision === 'accept' && design.success && design.data.skill === 'seo_brief' && found.job.projectId && run.output) {
    await saveGeneratedSeoBrief({ organizationId: found.job.organizationId, companyId: found.job.companyId, projectId: found.job.projectId, userId: viewer.userId, output: run.output });
  }
  if (run.dryRun) {
    // The sample was right: the job is ready. A one-off job whose results stay in Nucleas is done.
    const once = design.success && design.data.schedule.kind === 'once';
    const deliverable = design.success && RUNNABLE_DELIVERY.includes(design.data.delivery.method);
    const next: JobStatus = decision === 'reject' ? 'proposed' : once && deliverable ? 'done' : 'ready';
    const nextRunAt = decision === 'accept' && design.success && deliverable ? nextScheduledAt(design.data.schedule, new Date()) : null;
    await Job.updateOne(
      { _id: found.job._id, status: 'testing' },
      {
        $set: { status: next, ...(nextRunAt ? { nextRunAt } : {}) },
        ...(!nextRunAt ? { $unset: { nextRunAt: '' } } : {}),
        $push: { events: event(viewer, decision === 'accept' ? 'dry_run_accepted' : 'dry_run_rejected', note) },
      }
    );
  } else {
    await Job.updateOne({ _id: found.job._id }, { $push: { events: event(viewer, decision === 'accept' ? 'run_accepted' : 'run_rejected', note) } });
  }
  return done(viewer, jobId);
}

export function pauseJob(viewer: CompanyViewer, id: string): Promise<ActionResult> {
  return managed(viewer, id).then(async (f) => {
    if (!f.ok) return f;
    const result = await transition(viewer, f.job, ['active', 'ready'], { status: 'paused' }, 'paused');
    if (result.ok) await Job.updateOne({ _id: f.job._id }, { $unset: { nextRunAt: '' } });
    return result.ok ? done(viewer, id) : result;
  });
}

export async function resumeJob(viewer: CompanyViewer, id: string): Promise<ActionResult> {
  const found = await managed(viewer, id);
  if (!found.ok) return found;
  const design = jobDesignSchema.safeParse(found.job.design);
  if (!design.success) return { ok: false, status: 409, error: 'This job has no valid design.' };
  const nextRunAt = nextScheduledAt(design.data.schedule, new Date());
  return transition(viewer, found.job, ['paused'], { status: 'active', ...(nextRunAt ? { nextRunAt } : {}) }, 'resumed');
}

export function archiveJob(viewer: CompanyViewer, id: string): Promise<ActionResult> {
  return managed(viewer, id).then((f) => (f.ok ? transition(viewer, f.job, ['proposed', 'ready', 'active', 'paused', 'done', 'failed', 'needs_answers'], { status: 'archived' }, 'archived') : f));
}

// ---------- Background ----------

export { executeJobRun };

/** Claims due recurring jobs and creates their runs. Each job advances before its run starts, so cron retries cannot duplicate it. */
export async function claimDueJobRuns(now = new Date(), limit = 2): Promise<string[]> {
  const candidates = await Job.find({ status: { $in: ['ready', 'active'] }, nextRunAt: { $lte: now } })
    .sort({ nextRunAt: 1 })
    .limit(Math.max(1, Math.min(limit, 10)))
    .lean<JobLean[]>();
  const runIds: string[] = [];
  for (const job of candidates) {
    const design = jobDesignSchema.safeParse(job.design);
    if (!design.success || design.data.schedule.kind === 'once' || !RUNNABLE_DELIVERY.includes(design.data.delivery.method)) continue;
    if (await JobRun.exists({ jobId: job._id, status: 'running' })) continue;
    const nextRunAt = nextScheduledAt(design.data.schedule, now);
    const claimed = await Job.findOneAndUpdate(
      { _id: job._id, status: { $in: ['ready', 'active'] }, nextRunAt: job.nextRunAt },
      { $set: { status: 'active', lastRunAt: now, ...(nextRunAt ? { nextRunAt } : {}) }, $push: { events: event(null, 'scheduled_run_started') } },
      { new: true }
    );
    if (!claimed) continue;
    const startedAt = new Date();
    const run = await JobRun.create({
      organizationId: job.organizationId,
      jobId: job._id,
      companyId: job.companyId,
      dryRun: false,
      status: 'running',
      startedAt,
      progress: ['Starting scheduled run'],
      progressState: { stage: 'preparing', label: 'Preparing the scheduled run', percent: 5, updatedAt: startedAt },
    });
    runIds.push(String(run._id));
  }
  return runIds;
}

/** Cron: fails runs and designs that have been stuck too long. */
export async function sweepJobs(now = new Date()): Promise<{ runsFailed: number; designsFailed: number }> {
  const cutoff = new Date(now.getTime() - STUCK_MS);
  const runs = await JobRun.updateMany({ status: 'running', startedAt: { $lt: cutoff } }, { $set: { status: 'failed', error: 'The run timed out.', finishedAt: now } });
  const designs = await Job.updateMany({ status: 'designing', updatedAt: { $lt: cutoff } }, { $set: { status: 'failed', error: 'Designing the job timed out. Try again.' } });
  return { runsFailed: runs.modifiedCount ?? 0, designsFailed: designs.modifiedCount ?? 0 };
}
