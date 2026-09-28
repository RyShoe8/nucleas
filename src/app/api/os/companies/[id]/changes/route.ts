import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { companyTimeline } from '@/lib/companies/activityLog';

export const dynamic = 'force-dynamic';

/** What changed recently for the company (code, builds, actions, integrations), newest first. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 20);
  const items = await companyTimeline(viewer, (await params).id, { limit: Number.isFinite(limit) ? limit : 20 });
  if (!items) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
}
