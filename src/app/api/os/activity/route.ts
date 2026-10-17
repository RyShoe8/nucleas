import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { listActivity } from '@/lib/activity/activity';

export const dynamic = 'force-dynamic';

/** Everything Nucleas is doing besides jobs (watches, articles, builds, overviews), for the Jobs window. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  return NextResponse.json({ items: await listActivity(viewer) }, { headers: { 'Cache-Control': 'no-store' } });
}
