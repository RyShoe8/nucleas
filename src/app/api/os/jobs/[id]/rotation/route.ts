import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getJob } from '@/lib/jobs/jobs';
import { Job } from '@/lib/models/Job';
import { rotationView } from '@/lib/publishing/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** An evergreen rotation job's list: pages in posting order, what is posted, what is next, and what could be added. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  if (!(await getJob(viewer, id))) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  const job = await Job.findOne({ _id: new Types.ObjectId(id), organizationId: viewer.organizationId }).select('organizationId companyId createdByUserId publishing').lean();
  const view = job ? await rotationView(job as never) : null;
  return view ? NextResponse.json({ rotation: view }, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: 'This job is not an evergreen rotation.' }, { status: 404 });
}
