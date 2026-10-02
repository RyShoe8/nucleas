import 'server-only';
import { Types } from 'mongoose';
import { Job, JobRun } from '@/lib/models/Job';
import type { JobDesign, JobRunOutput } from '@/lib/jobs/schema';
import { heartbeatJobRun, initialRunLease, leaseExpiry } from '@/lib/jobs/runLifecycle';

export const PROPERTY_OVERVIEW_OWNER = 'vps:property-overview';
export const PROPERTY_OVERVIEW_QUEUE_OWNER = 'queue:property-overview';

export function propertyOverviewJobDesign(companyName: string, rootUrl: string): JobDesign {
  return {
    skill: 'property_overview',
    title: `Company overview · ${companyName}`,
    category: 'data',
    instructions: `Crawl and archive the complete public site at ${rootUrl}. Audit technical SEO, group page templates, and map internal links.`,
    fields: [
      { key: 'pages_archived', label: 'Pages archived', type: 'number', required: true, description: '' },
      { key: 'internal_links', label: 'Internal links', type: 'number', required: true, description: '' },
      { key: 'seo_findings', label: 'SEO findings', type: 'number', required: true, description: '' },
      { key: 'templates', label: 'Templates', type: 'number', required: true, description: '' },
      { key: 'orphan_pages', label: 'Orphan pages', type: 'number', required: true, description: '' },
      { key: 'property_description', label: 'Property description', type: 'long_text', required: true, description: 'Grounded description synthesized from first-party crawl evidence.' },
      { key: 'primary_keywords', label: 'Primary keywords', type: 'list', required: true, description: 'Primary search topics supported by crawled pages.' },
      { key: 'demographic_target', label: 'Demographic target', type: 'long_text', required: true, description: 'Supported audience and intent, with uncertainty stated explicitly.' },
      { key: 'competitors', label: 'Competitors', type: 'list', required: false, description: 'Up to ten likely direct competitors; uncertain candidates are omitted.' },
    ],
    sourcePolicy: 'First-party pages from the selected production property. Every archived page retains its URL and crawl evidence.',
    delivery: { method: 'nucleas', detail: 'Saved as a browsable Company Overview in Nucleas.', setupSteps: [] },
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
    request: `Generate a complete Company Overview for ${input.rootUrl}.`,
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
    ...initialRunLease(PROPERTY_OVERVIEW_QUEUE_OWNER, now),
    progress: ['Queued · waiting for the VPS crawl worker'],
    progressState: { stage: 'preparing', label: 'Queued · waiting for the VPS crawl worker', percent: 5, updatedAt: now },
  });
  return { jobId: job._id, runId: run._id };
}

export async function startPropertyOverviewJob(input: { jobId?: Types.ObjectId; runId?: Types.ObjectId; now?: Date }): Promise<void> {
  if (!input.runId) return;
  const now = input.now ?? new Date();
  const started = await JobRun.updateOne(
    { _id: input.runId, status: 'running', leaseOwner: PROPERTY_OVERVIEW_QUEUE_OWNER },
    {
      $set: {
        leaseOwner: PROPERTY_OVERVIEW_OWNER,
        executionStartedAt: now,
        heartbeatAt: now,
        leaseExpiresAt: leaseExpiry(now),
        progressState: { stage: 'preparing', label: 'VPS worker is discovering pages…', percent: 5, updatedAt: now },
      },
      $push: { progress: 'VPS worker accepted the crawl' },
    }
  );
  if (started.modifiedCount && input.jobId) {
    await Job.updateOne({ _id: input.jobId, status: 'active' }, { $set: { lastRunAt: now }, $push: { events: { at: now, action: 'property_crawl_dispatched' } } });
  }
}

export async function queuePropertyOverviewJob(input: { runId?: Types.ObjectId; now?: Date }): Promise<void> {
  if (!input.runId) return;
  const now = input.now ?? new Date();
  await JobRun.updateOne(
    { _id: input.runId, status: 'running', leaseOwner: { $in: [PROPERTY_OVERVIEW_OWNER, PROPERTY_OVERVIEW_QUEUE_OWNER] } },
    {
      $set: {
        leaseOwner: PROPERTY_OVERVIEW_QUEUE_OWNER,
        heartbeatAt: now,
        leaseExpiresAt: leaseExpiry(now),
        progressState: { stage: 'preparing', label: 'Queued · waiting for the VPS crawl worker', percent: 5, updatedAt: now },
      },
      $unset: { executionStartedAt: '' },
      $push: { progress: { $each: ['Queued · waiting for the VPS crawl worker'], $slice: -40 } },
    }
  );
}

export async function updatePropertyOverviewJob(input: { jobId?: Types.ObjectId; runId?: Types.ObjectId; message: string; processed: number; discovered: number }): Promise<void> {
  if (!input.runId) return;
  const percent = Math.min(95, Math.max(10, 10 + Math.floor((input.processed / Math.max(1, input.discovered)) * 85)));
  const now = new Date();
  await heartbeatJobRun(input.runId, PROPERTY_OVERVIEW_OWNER, { text: input.message, milestone: { stage: 'researching', percent } });
  if (input.jobId) await Job.updateOne({ _id: input.jobId, status: 'active' }, { $set: { updatedAt: now } });
}

export async function completePropertyOverviewJob(input: { jobId?: Types.ObjectId; runId?: Types.ObjectId; rootUrl: string; pageCount: number; edgeCount: number; issueCount: number; templates: number; orphanPages: number; propertyDescription?: string; primaryKeywords?: string[]; demographicTarget?: string; competitors?: { name: string; domain: string; reason: string }[] }): Promise<void> {
  if (!input.runId || !input.jobId) return;
  const now = new Date();
  const output: JobRunOutput = {
    records: [{ values: { pages_archived: input.pageCount, internal_links: input.edgeCount, seo_findings: input.issueCount, templates: input.templates, orphan_pages: input.orphanPages, property_description: input.propertyDescription ?? '', primary_keywords: input.primaryKeywords ?? [], demographic_target: input.demographicTarget ?? '', competitors: (input.competitors ?? []).map((competitor) => `${competitor.name} (${competitor.domain})`) }, sources: [input.rootUrl] }],
    summary: `Archived ${input.pageCount} pages, mapped ${input.edgeCount} internal links, and recorded ${input.issueCount} SEO findings.`,
    gaps: [],
  };
  await Promise.all([
    JobRun.updateOne({ _id: input.runId, status: 'running', leaseOwner: PROPERTY_OVERVIEW_OWNER }, { $set: { status: 'completed', output, finishedAt: now, progressState: { stage: 'complete', label: 'Company Overview complete', percent: 100, updatedAt: now } }, $unset: { leaseExpiresAt: '' }, $push: { progress: 'Company Overview complete' } }),
    Job.updateOne({ _id: input.jobId, status: 'active' }, { $set: { status: 'done' }, $push: { events: { at: now, action: 'property_crawl_completed' } } }),
  ]);
}

export async function failPropertyOverviewJob(input: { jobId?: Types.ObjectId; runId?: Types.ObjectId; error: string }): Promise<void> {
  const now = new Date();
  await Promise.all([
    input.runId ? JobRun.updateOne({ _id: input.runId, status: 'running', leaseOwner: { $in: [PROPERTY_OVERVIEW_OWNER, PROPERTY_OVERVIEW_QUEUE_OWNER] } }, { $set: { status: 'failed', error: input.error.slice(0, 1000), finishedAt: now, progressState: { stage: 'complete', label: 'Company Overview failed', percent: 100, updatedAt: now } }, $unset: { leaseExpiresAt: '' } }) : Promise.resolve(),
    input.jobId ? Job.updateOne({ _id: input.jobId, status: 'active' }, { $set: { status: 'failed', error: input.error.slice(0, 1000) }, $push: { events: { at: now, action: 'property_crawl_failed', note: input.error.slice(0, 500) } } }) : Promise.resolve(),
  ]);
}
