import 'server-only';
import { Types } from 'mongoose';
import { Job, JobRun } from '@/lib/models/Job';
import type { JobDesign, JobRunOutput } from '@/lib/jobs/schema';
import { heartbeatJobRun, initialRunLease } from '@/lib/jobs/runLifecycle';

const PROPERTY_OVERVIEW_OWNER = 'vps:property-overview';

export function propertyOverviewJobDesign(companyName: string, rootUrl: string): JobDesign {
  return {
    skill: 'property_overview',
    title: `Property overview · ${companyName}`,
    category: 'data',
    instructions: `Crawl and archive up to 250 pages from ${rootUrl}. Audit technical SEO, group page templates, and map internal links.`,
    fields: [
      { key: 'pages_archived', label: 'Pages archived', type: 'number', required: true, description: '' },
      { key: 'internal_links', label: 'Internal links', type: 'number', required: true, description: '' },
      { key: 'seo_findings', label: 'SEO findings', type: 'number', required: true, description: '' },
      { key: 'templates', label: 'Templates', type: 'number', required: true, description: '' },
      { key: 'orphan_pages', label: 'Orphan pages', type: 'number', required: true, description: '' },
    ],
    sourcePolicy: 'First-party pages from the selected production property. Every archived page retains its URL and crawl evidence.',
    delivery: { method: 'nucleas', detail: 'Saved as a browsable Property Overview in Nucleas.', setupSteps: [] },
    schedule: { kind: 'once' },
    recordsPerRun: 1,
    safeguards: ['Read-only crawl; never submit forms or change the property.', 'Stay on the selected production hostname.', 'Keep crawl evidence auditable.'],
    recommendedCompletion: 'automatic',
    findings: ['The crawl runs on the isolated VPS worker and can continue after every Nucleas window is closed.'],
    questions: [],
  };
}

export async function createPropertyOverviewJob(input: { organizationId: Types.ObjectId; companyId: Types.ObjectId; userId: string; companyName: string; overviewId: Types.ObjectId; rootUrl: string }): Promise<{ jobId: Types.ObjectId; runId: Types.ObjectId }> {
  const now = new Date();
  const job = await Job.create({
    organizationId: input.organizationId,
    companyId: input.companyId,
    createdByUserId: new Types.ObjectId(input.userId),
    status: 'active',
    request: `Generate a complete Property Overview for ${input.rootUrl}.`,
    design: propertyOverviewJobDesign(input.companyName, input.rootUrl),
    completion: 'automatic',
    level: 'free',
    monthlyBudgetMicros: 0,
    lastRunAt: now,
    events: [{ at: now, userId: new Types.ObjectId(input.userId), action: 'property_crawl_started' }],
  });
  const run = await JobRun.create({
    organizationId: input.organizationId,
    jobId: job._id,
    companyId: input.companyId,
    propertyOverviewId: input.overviewId,
    dryRun: false,
    status: 'running',
    startedAt: now,
    ...initialRunLease(PROPERTY_OVERVIEW_OWNER, now),
    progress: ['Queued on the VPS crawl worker'],
    progressState: { stage: 'preparing', label: 'Queued on the VPS crawl worker', percent: 5, updatedAt: now },
  });
  return { jobId: job._id, runId: run._id };
}

export async function updatePropertyOverviewJob(input: { jobId?: Types.ObjectId; runId?: Types.ObjectId; message: string; processed: number; discovered: number }): Promise<void> {
  if (!input.runId) return;
  const percent = Math.min(95, Math.max(10, 10 + Math.floor((input.processed / Math.max(1, input.discovered)) * 85)));
  const now = new Date();
  await heartbeatJobRun(input.runId, PROPERTY_OVERVIEW_OWNER, { text: input.message, milestone: { stage: 'researching', percent } });
  if (input.jobId) await Job.updateOne({ _id: input.jobId, status: 'active' }, { $set: { updatedAt: now } });
}

export async function completePropertyOverviewJob(input: { jobId?: Types.ObjectId; runId?: Types.ObjectId; rootUrl: string; pageCount: number; edgeCount: number; issueCount: number; templates: number; orphanPages: number }): Promise<void> {
  if (!input.runId || !input.jobId) return;
  const now = new Date();
  const output: JobRunOutput = {
    records: [{ values: { pages_archived: input.pageCount, internal_links: input.edgeCount, seo_findings: input.issueCount, templates: input.templates, orphan_pages: input.orphanPages }, sources: [input.rootUrl] }],
    summary: `Archived ${input.pageCount} pages, mapped ${input.edgeCount} internal links, and recorded ${input.issueCount} SEO findings.`,
    gaps: [],
  };
  await Promise.all([
    JobRun.updateOne({ _id: input.runId, status: 'running', leaseOwner: PROPERTY_OVERVIEW_OWNER }, { $set: { status: 'completed', output, finishedAt: now, progressState: { stage: 'complete', label: 'Property Overview complete', percent: 100, updatedAt: now } }, $unset: { leaseExpiresAt: '' }, $push: { progress: 'Property Overview complete' } }),
    Job.updateOne({ _id: input.jobId, status: 'active' }, { $set: { status: 'done' }, $push: { events: { at: now, action: 'property_crawl_completed' } } }),
  ]);
}

export async function failPropertyOverviewJob(input: { jobId?: Types.ObjectId; runId?: Types.ObjectId; error: string }): Promise<void> {
  const now = new Date();
  await Promise.all([
    input.runId ? JobRun.updateOne({ _id: input.runId, status: 'running', leaseOwner: PROPERTY_OVERVIEW_OWNER }, { $set: { status: 'failed', error: input.error.slice(0, 1000), finishedAt: now, progressState: { stage: 'complete', label: 'Property Overview failed', percent: 100, updatedAt: now } }, $unset: { leaseExpiresAt: '' } }) : Promise.resolve(),
    input.jobId ? Job.updateOne({ _id: input.jobId, status: 'active' }, { $set: { status: 'failed', error: input.error.slice(0, 1000) }, $push: { events: { at: now, action: 'property_crawl_failed', note: input.error.slice(0, 500) } } }) : Promise.resolve(),
  ]);
}
