import { after, NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { isCostLevel } from '@/lib/ai/engine/select';
import { createJob, listJobs, runDesign } from '@/lib/jobs/jobs';

export const dynamic = 'force-dynamic';
// Designing continues after the response (Nucleas investigates, then designs or asks).
export const maxDuration = 300;

/** Jobs across every company the viewer can see. ?all=1 includes rejected and archived; ?companyId= narrows. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const jobs = await listJobs(viewer, {
    includeClosed: request.nextUrl.searchParams.get('all') === '1',
    companyId: request.nextUrl.searchParams.get('companyId') ?? undefined,
  });
  return NextResponse.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } });
}

/** A new job from a request: { companyId, request, level? }. Returns at once; Nucleas designs it in the background. */
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { companyId?: unknown; request?: unknown; level?: unknown };
  if (typeof body.companyId !== 'string' || typeof body.request !== 'string') {
    return NextResponse.json({ error: 'companyId and request are required.' }, { status: 400 });
  }
  const result = await createJob(viewer, { companyId: body.companyId, request: body.request, level: isCostLevel(body.level) ? body.level : undefined, background: true });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  after(() => runDesign(viewer, result.job.id));
  return NextResponse.json({ job: result.job });
}
