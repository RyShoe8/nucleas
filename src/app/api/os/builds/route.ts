import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { listBuilds } from '@/lib/building/builds';

export const dynamic = 'force-dynamic';

/** Builds across every company the viewer can see. ?all=1 includes rejected and discarded ones. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const builds = await listBuilds(viewer, { includeClosed: request.nextUrl.searchParams.get('all') === '1' });
  return NextResponse.json({ builds }, { headers: { 'Cache-Control': 'no-store' } });
}
