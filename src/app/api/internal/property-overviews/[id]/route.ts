import { timingSafeEqual } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import connectDB from '@/lib/db/mongodb';
import { PropertyOverview, PropertyPage } from '@/lib/models/PropertyOverview';
import { completePropertyOverviewJob, failPropertyOverviewJob, heartbeatPropertyOverviewJob, startPropertyOverviewJob, updatePropertyOverviewJob } from '@/lib/propertyOverview/job';
import { processPropertyOverviewQueue } from '@/lib/propertyOverview/crawler';
import { replaceCompanyOverview } from '@/lib/propertyOverview/storage';
import { templateName } from '@/lib/propertyOverview/templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const short = z.string().max(4_000);
const pageSchema = z.object({
  action: z.literal('page'), processed: z.number().int().min(1).max(1_000_000), discovered: z.number().int().min(1).max(1_000_000),
  page: z.object({
    url: z.string().url().max(4_000), routePattern: z.string().max(2_000), statusCode: z.number().int().min(0).max(599).optional(), contentType: z.string().max(300).optional(), title: short.optional(), description: short.optional(), canonical: z.string().max(4_000).optional(), robots: z.string().max(500).optional(), language: z.string().max(100).optional(),
    h1: z.array(short).max(50).default([]), h2: z.array(short).max(100).default([]), h3: z.array(short).max(150).default([]), metaKeywords: z.array(short).max(100).default([]), wordCount: z.number().int().min(0).max(10_000_000).default(0),
    internalLinks: z.array(z.string().url().max(4_000)).max(5_000).default([]), externalLinks: z.array(z.string().url().max(4_000)).max(5_000).default([]), imageCount: z.number().int().min(0).max(1_000_000).default(0), imagesMissingAlt: z.number().int().min(0).max(1_000_000).default(0), structuredDataTypes: z.array(short).max(100).default([]),
    datePublished: z.string().datetime().optional(), dateModified: z.string().datetime().optional(), indexable: z.boolean().default(true), templateKey: z.string().max(100).optional(), issues: z.array(short).max(100).default([]), fetchedAt: z.string().datetime(), renderMode: z.enum(['html', 'rendered']).default('html'),
  }).strict(),
}).strict();
const progressSchema = z.object({ action: z.literal('progress'), processed: z.number().int().min(0).max(1_000_000), discovered: z.number().int().min(1).max(1_000_000), message: z.string().max(300) }).strict();
const heartbeatSchema = z.object({ action: z.literal('heartbeat'), processed: z.number().int().min(0).max(1_000_000), discovered: z.number().int().min(1).max(1_000_000) }).strict();
const analysisSchema = z.object({
  action: z.literal('analysis'),
  analysis: z.object({
    description: z.string().max(2_000),
    primaryKeywords: z.array(z.string().min(1).max(200)).max(20),
    demographicTarget: z.string().max(2_000),
    competitors: z.array(z.object({ name: z.string().min(1).max(160), domain: z.string().min(1).max(253), reason: z.string().min(1).max(500) }).strict()).max(10),
    sources: z.array(z.string().url().max(4_000)).max(30),
    model: z.string().max(200).nullable(),
  }).strict(),
}).strict();
const terminalSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('complete') }).strict(), z.object({ action: z.literal('failed'), error: z.string().min(1).max(1500) }).strict()]);

function authorized(request: NextRequest): boolean {
  const secret = process.env.NUCLEAS_EXECUTION_WORKER_TOKEN?.trim();
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  return Boolean(secret && actual.length === expected.length && timingSafeEqual(actual, expected));
}

async function finalize(id: Types.ObjectId): Promise<void> {
  const overview = await PropertyOverview.findById(id).select('organizationId companyId jobId runId rootUrl propertyDescription primaryKeywords demographicTarget competitors').lean<{ organizationId: Types.ObjectId; companyId: Types.ObjectId; jobId?: Types.ObjectId; runId?: Types.ObjectId; rootUrl: string; propertyDescription?: string; primaryKeywords?: string[]; demographicTarget?: string; competitors?: { name: string; domain: string; reason: string }[] }>();
  if (!overview) throw new Error('The active Company Overview no longer exists.');
  const pages = await PropertyPage.find({ overviewId: id }).select('url templateKey routePattern issues internalLinks statusCode').lean();
  const incoming = new Map<string, number>(); const clusters = new Map<string, string[]>();
  let issueCount = 0; let edgeCount = 0;
  for (const page of pages) {
    for (const link of page.internalLinks ?? []) incoming.set(link, (incoming.get(link) ?? 0) + 1);
    const key = page.templateKey || 'unclassified'; clusters.set(key, [...(clusters.get(key) ?? []), page.routePattern]);
    issueCount += page.issues?.length ?? 0; edgeCount += page.internalLinks?.length ?? 0;
  }
  if (incoming.size) await PropertyPage.bulkWrite([...incoming].map(([url, count]) => ({ updateOne: { filter: { overviewId: id, url }, update: { $set: { incomingLinks: count } } } })), { ordered: false });
  const orphanPages = pages.filter((page) => page.routePattern !== '/' && !(incoming.get(page.url) ?? 0)).length;
  const clusterRows = [...clusters].map(([templateKey, routes]) => { const uniqueRoutes = [...new Set(routes)]; return { templateKey, name: templateName(uniqueRoutes), count: routes.length, sampleRoutes: uniqueRoutes.slice(0, 8) }; }).sort((a, b) => b.count - a.count);
  await replaceCompanyOverview({ overviewId: id, organizationId: overview.organizationId, companyId: overview.companyId, completion: { completedAt: new Date(), progress: 'Complete', pageCount: pages.length, edgeCount, issueCount, clusters: clusterRows, summary: { orphanPages, issuePages: pages.filter((page) => (page.issues?.length ?? 0) > 0).length, errorPages: pages.filter((page) => (page.statusCode ?? 0) >= 400).length, templates: clusters.size } } });
  await completePropertyOverviewJob({ jobId: overview.jobId, runId: overview.runId, rootUrl: overview.rootUrl, pageCount: pages.length, edgeCount, issueCount, templates: clusters.size, orphanPages, propertyDescription: overview.propertyDescription, primaryKeywords: overview.primaryKeywords, demographicTarget: overview.demographicTarget, competitors: overview.competitors });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  await connectDB();
  const overviewId = new Types.ObjectId(id);
  const overview = await PropertyOverview.findOne({ _id: overviewId, status: { $in: ['queued', 'dispatching', 'crawling'] } }).select('_id organizationId companyId jobId runId rootUrl status').lean<{ _id: Types.ObjectId; organizationId: Types.ObjectId; companyId: Types.ObjectId; jobId?: Types.ObjectId; runId?: Types.ObjectId; rootUrl: string; status: string }>();
  if (!overview) return NextResponse.json({ error: 'Active report not found.' }, { status: 404 });
  if (overview.status !== 'crawling') {
    const now = new Date();
    await Promise.all([
      startPropertyOverviewJob({ jobId: overview.jobId, runId: overview.runId, now }),
      PropertyOverview.updateOne({ _id: overviewId }, { $set: { status: 'crawling', startedAt: now } }),
    ]);
  }
  const raw = await request.json().catch(() => null);
  const action = raw && typeof raw === 'object' ? (raw as { action?: unknown }).action : null;
  if (action === 'page') {
    const parsed = pageSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid page record.' }, { status: 400 });
    const { page } = parsed.data;
    await PropertyPage.updateOne(
      { overviewId, url: page.url },
      { $set: { ...page, datePublished: page.datePublished ? new Date(page.datePublished) : undefined, dateModified: page.dateModified ? new Date(page.dateModified) : undefined, organizationId: overview.organizationId, companyId: overview.companyId }, $unset: { htmlSnapshot: '', renderedText: '' } },
      { upsert: true }
    );
    const message = `Archived ${parsed.data.processed} of ${parsed.data.discovered} discovered pages…`;
    await PropertyOverview.updateOne({ _id: overviewId }, { $set: { status: 'crawling', progress: message, pageCount: parsed.data.processed } });
    await updatePropertyOverviewJob({ jobId: overview.jobId, runId: overview.runId, message, processed: parsed.data.processed, discovered: parsed.data.discovered });
  } else if (action === 'progress') {
    const parsed = progressSchema.safeParse(raw); if (!parsed.success) return NextResponse.json({ error: 'Invalid progress update.' }, { status: 400 });
    await PropertyOverview.updateOne({ _id: overviewId }, { $set: { status: 'crawling', progress: parsed.data.message, pageCount: parsed.data.processed } });
    await updatePropertyOverviewJob({ jobId: overview.jobId, runId: overview.runId, message: parsed.data.message, processed: parsed.data.processed, discovered: parsed.data.discovered });
  } else if (action === 'heartbeat') {
    const parsed = heartbeatSchema.safeParse(raw); if (!parsed.success) return NextResponse.json({ error: 'Invalid heartbeat.' }, { status: 400 });
    await heartbeatPropertyOverviewJob(overview.runId);
  } else if (action === 'analysis') {
    const parsed = analysisSchema.safeParse(raw); if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid property analysis.' }, { status: 400 });
    const analysis = parsed.data.analysis;
    await PropertyOverview.updateOne({ _id: overviewId }, { $set: { propertyDescription: analysis.description, primaryKeywords: analysis.primaryKeywords, demographicTarget: analysis.demographicTarget, competitors: analysis.competitors, analysisSources: analysis.sources, ...(analysis.model ? { analysisModel: analysis.model } : {}) } });
    await updatePropertyOverviewJob({ jobId: overview.jobId, runId: overview.runId, message: 'Property analysis complete; finalizing report…', processed: 1, discovered: 1 });
  } else {
    const parsed = terminalSchema.safeParse(raw); if (!parsed.success) return NextResponse.json({ error: 'Invalid terminal update.' }, { status: 400 });
    if (parsed.data.action === 'failed') {
      await PropertyOverview.updateOne({ _id: overviewId }, { $set: { status: 'failed', completedAt: new Date(), progress: 'Failed', error: parsed.data.error } });
      await failPropertyOverviewJob({ jobId: overview.jobId, runId: overview.runId, error: parsed.data.error });
    }
    else await finalize(overviewId);
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, 750));
      await processPropertyOverviewQueue().catch((error) => console.error('[property-overview] queue advance failed', error instanceof Error ? error.message : 'unknown'));
    });
  }
  return NextResponse.json({ ok: true });
}
