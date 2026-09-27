import { NextRequest, NextResponse } from 'next/server';
import { getTodayOverview } from '@/lib/metrics/query';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';

/** Headline metrics across every company the viewer can see. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  return NextResponse.json(await getTodayOverview(viewer));
}
