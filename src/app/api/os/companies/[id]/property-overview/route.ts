import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { PropertyOverview, PropertyPage } from '@/lib/models/PropertyOverview';
import { dispatchPropertyOverview } from '@/lib/propertyOverview/crawler';
import { createPropertyOverviewJob, failPropertyOverviewJob } from '@/lib/propertyOverview/job';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function view(row: Record<string, unknown>) {
  return { id: String(row._id), jobId: row.jobId ? String(row.jobId) : undefined, rootUrl: row.rootUrl, status: row.status, progress: row.progress, error: row.error, pageCount: row.pageCount ?? 0, edgeCount: row.edgeCount ?? 0, issueCount: row.issueCount ?? 0, clusters: row.clusters ?? [], summary: row.summary ?? {}, propertyDescription: row.propertyDescription ?? '', primaryKeywords: row.primaryKeywords ?? [], demographicTarget: row.demographicTarget ?? '', competitors: row.competitors ?? [], analysisSources: row.analysisSources ?? [], analysisModel: row.analysisModel ?? null, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, completedAt: row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const profile = await getCompanyProfile(viewer, id);
  if (!profile) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  const overview = await PropertyOverview.findOne({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(id) }).sort({ createdAt: -1 }).lean<Record<string, unknown>>();
  if (!overview) return NextResponse.json({ overview: null, pages: [] });
  const requestedOffset = Number(new URL(request.url).searchParams.get('offset') ?? 0);
  const offset = Number.isInteger(requestedOffset) ? Math.max(0, Math.min(requestedOffset, 1_000_000)) : 0;
  const pageSize = 200;
  // URL ordering is covered by the { overviewId, url } index, so MongoDB never materializes and
  // sorts the large archived snapshots. Pagination keeps complete-site reports below response limits.
  const [pages, pageTotal] = await Promise.all([
    PropertyPage.find({ overviewId: overview._id })
      .select('-htmlSnapshot -renderedText -organizationId -companyId -__v')
      .sort({ url: 1 })
      .skip(offset)
      .limit(pageSize)
      .lean(),
    PropertyPage.countDocuments({ overviewId: overview._id }),
  ]);
  return NextResponse.json({ overview: view(overview), pageTotal, pages: pages.map((page) => ({ ...page, id: String(page._id), _id: undefined, overviewId: undefined })) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Only Managers and Administrators can run property crawls.' }, { status: 403 });
  const { id } = await params;
  const profile = await getCompanyProfile(viewer, id);
  if (!profile) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  const source = profile.domain || profile.liveUrl || profile.urls[0];
  if (!source) return NextResponse.json({ error: 'Set a production domain before generating a Property Overview.' }, { status: 400 });
  const rootUrl = new URL(source.startsWith('http') ? source : `https://${source}`).origin + '/';
  const active = await PropertyOverview.findOne({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(id), status: { $in: ['queued', 'crawling'] } }).lean();
  if (active) return NextResponse.json({ error: 'A property crawl is already running.' }, { status: 409 });
  const overview = await PropertyOverview.create({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(id), rootUrl, status: 'queued', progress: 'Queued' });
  const linked = await createPropertyOverviewJob({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(id), userId: viewer.userId, companyName: profile.name, overviewId: overview._id, rootUrl });
  await PropertyOverview.updateOne({ _id: overview._id }, { $set: { jobId: linked.jobId, runId: linked.runId } });
  try {
    await dispatchPropertyOverview({ overviewId: String(overview._id), rootUrl });
    await PropertyOverview.updateOne({ _id: overview._id }, { $set: { status: 'crawling', startedAt: new Date(), progress: 'VPS worker is discovering pages…' } });
    const started = await PropertyOverview.findById(overview._id).lean<Record<string, unknown>>();
    return NextResponse.json({ overview: view(started ?? { ...overview.toObject(), jobId: linked.jobId }), jobId: String(linked.jobId), pages: [] }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not start the VPS crawl.';
    await PropertyOverview.updateOne({ _id: overview._id }, { $set: { status: 'failed', completedAt: new Date(), progress: 'Failed to start', error: message } });
    await failPropertyOverviewJob({ jobId: linked.jobId, runId: linked.runId, error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
