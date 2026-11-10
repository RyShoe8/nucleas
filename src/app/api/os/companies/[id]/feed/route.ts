import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { companyActivityFeed } from '@/lib/companies/activityFeed';

export const dynamic = 'force-dynamic';

/** One newest-first list of everything that happened for the company: team work, posts, decisions, code and setup. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const days = Number(request.nextUrl.searchParams.get('days') ?? 14);
  if (![7, 14, 30, 90].includes(days)) return NextResponse.json({ error: 'Choose 7, 14, 30 or 90 days.' }, { status: 400 });
  const items = await companyActivityFeed(viewer, (await params).id, { days });
  if (!items) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
}
